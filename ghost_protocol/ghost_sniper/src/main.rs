use dotenv;
use futures_util::StreamExt; 
use redis;
use std::env;
use std::collections::HashSet;
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use deadpool_postgres::{Config, Runtime};
use tokio_postgres::NoTls;

// Import the monitor module
mod monitor;
use monitor::TokenMonitor;

#[derive(serde::Deserialize, Debug)]
struct TargetMessage {
    mint: String,
    #[serde(alias = "found_at")]
    _found_at: String,
    #[serde(alias = "initial_sol")]
    _initial_sol: f64,
    pool_address: String,
    #[serde(default)] // Allow null/missing for backwards compat or manual triggers
    holder_avg_buy: f64,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load .env file
    dotenv::dotenv().ok();
    env_logger::init();

    println!("🔫 Starting GHOST SNIPER Service...");

    // 1. Setup Database Connection Pool
    let mut pg_config = Config::new();
    pg_config.host = Some(env::var("POSTGRES_HOST").unwrap_or("localhost".to_string()));
    pg_config.user = Some(env::var("POSTGRES_USER").unwrap_or("ghost_user".to_string()));
    pg_config.password = Some(env::var("POSTGRES_PASSWORD").unwrap_or("ghost_password".to_string()));
    pg_config.dbname = Some(env::var("POSTGRES_DB").unwrap_or("ghost_db".to_string()));
    
    // Create the pool
    let pool = pg_config.create_pool(Some(Runtime::Tokio1), NoTls).unwrap();
    println!("✅ Connected to Postgres (tokio-postgres)");

    // 2. Connect to Redis (The Command Center)
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let client = redis::Client::open(redis_url)?;
    
    // Get connection and convert to pubsub
    let conn = client.get_async_connection().await?;
    let mut pubsub = conn.into_pubsub();
    
    // 3. Subscribe to the 'new_targets' channel
    pubsub.subscribe("new_targets").await?;
    println!("👂 Listening for targets from Scout...");

    // --- P0 FIX 1: DEDUPLICATION ---
    // Track active mints to prevent spawning duplicate monitors
    let active_mints: Arc<tokio::sync::Mutex<HashSet<String>>> = Arc::new(tokio::sync::Mutex::new(HashSet::new()));
    println!("🛡️ Deduplication guard active.");

    // --- P0 FIX 2: ROUND-ROBIN KEY ROTATION ---
    let helius_keys: Vec<String> = env::var("HELIUS_API_KEYS")
        .expect("HELIUS_API_KEYS must be set")
        .split(',')
        .map(|k| k.trim().to_string())
        .collect();
    let key_count = helius_keys.len();
    let key_index = Arc::new(AtomicUsize::new(0));
    println!("🔑 Loaded {} Helius API keys for rotation.", key_count);
    
    // --- P1 FIX 3: STARTUP RECONCILIATION ---
    println!("🔍 Starting Reconciliation: Checking DB for missed targets...");
    let db_recovery = pool.clone();
    let recover_mints = active_mints.clone();
    let recover_keys = helius_keys.clone();
    let recover_key_idx = key_index.clone();
    
    tokio::spawn(async move {
        let client = match db_recovery.get().await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("❌ Reconciliation Error (DB Pool): {}", e);
                return;
            }
        };

        let rows = match client.query("SELECT mint_address, pool_address, holder_avg_buy FROM target_queue WHERE status = 'PENDING'", &[]).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("❌ Reconciliation Error (Query): {}", e);
                return;
            }
        };

        for row in rows {
            let mint: String = row.get(0);
            let pool_addr: String = row.get(1);
            let holder_basis: f64 = row.get::<_, Option<f64>>(2).unwrap_or(0.0);

            let mut active = recover_mints.lock().await;
            if active.contains(&mint) { continue; }
            active.insert(mint.clone());
            
            let thread_pool = db_recovery.clone();
            let thread_active_list = recover_mints.clone();
            let idx = recover_key_idx.fetch_add(1, Ordering::Relaxed) % recover_keys.len();
            let helius_key = recover_keys[idx].clone();

            let mint_for_thread = mint.clone();
            tokio::spawn(async move {
                println!("🩹 [RECONCILED] Recovered {} from DB (key #{})", &mint_for_thread[..8], idx);
                let mut monitor = TokenMonitor::new(mint_for_thread.clone(), pool_addr, helius_key, thread_pool, holder_basis);
                monitor.run().await;
                
                let mut list = thread_active_list.lock().await;
                list.remove(&mint_for_thread);
            });
        }
        println!("✅ Reconciliation Complete.");
    });

    // 4. The Event Loop
    let mut stream = pubsub.on_message();
    
    while let Some(msg) = stream.next().await {
        let payload: String = msg.get_payload()?;
        
        if let Ok(target) = serde_json::from_str::<TargetMessage>(&payload) {
            // --- DEDUP CHECK ---
            let mint_clone = target.mint.clone();
            {
                let mut active = active_mints.lock().await;
                if active.contains(&mint_clone) {
                    // Skip duplicate — monitor already running for this mint
                    continue;
                }
                active.insert(mint_clone.clone());
            }

            println!("🎯 TARGET ACQUIRED: {} (unique)", target.mint);
            println!("   Pool Address: {}", target.pool_address);
            
            // Prepare dependencies for the thread
            let db_pool = pool.clone();
            let active_mints_clone = Arc::clone(&active_mints);
            
            // Round-robin key selection
            let idx = key_index.fetch_add(1, Ordering::Relaxed) % key_count;
            let helius_key = helius_keys[idx].clone();
            
            // Spawn the Real Monitor
            tokio::spawn(async move {
                println!("🔫 Activating Monitor for {} (key #{})", &target.mint[..8], idx);
                
                let mut monitor = TokenMonitor::new(
                    target.mint.clone(),
                    target.pool_address,
                    helius_key,
                    db_pool,
                    target.holder_avg_buy
                );
                
                // This runs the full loop (WSS -> VPC -> Trade -> DB)
                monitor.run().await;

                // Remove from active set when monitor completes
                let count = {
                    let mut active = active_mints_clone.lock().await;
                    active.remove(&target.mint);
                    active.len()
                };
                println!("🔓 Released lock for {}. Active Monitors: {}", &target.mint[..8], count);
            });
        }
    }

    Ok(())
}