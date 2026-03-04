// Milestone Protocol Scout - TRENCH MODE (Ingress Tier)
// Optimized for RAW SPEED. No socials, no metadata requirements.
// Refactored for 3-tier pipeline: Scouts EVERYTHING.
// Added Global Circuit Breaker: Pauses ingress if balance < 1.0 SOL.

use dotenv;
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;
use serde::{Deserialize, Serialize};
use key_manager::KeyManager;
use std::env;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::sleep;
use solana_program::pubkey::Pubkey;
use deadpool_postgres::{Pool, Config, Runtime};
use tokio_postgres::NoTls;
use chrono;
use std::sync::Arc;
use tokio::sync::RwLock;

mod key_manager;

#[derive(Debug, Deserialize)]
struct PumpPortalEvent {
    mint: String,
    #[serde(rename = "solAmount")]
    sol_amount: Option<f64>,
    #[serde(rename = "marketCapSol")]
    market_cap_sol: Option<f64>,
}

#[derive(Serialize)]
struct TargetPayload {
    mint: String,
    pool_address: String, 
    found_at: String,
    initial_sol: f64,
    holder_avg_buy: f64,
}

#[derive(Clone, Copy, PartialEq)]
enum SystemStatus {
    Operational,
    IdleInsufficientFunds,
}

struct AppState {
    status: SystemStatus,
}

async fn run_scout_logic(db_pool: Pool, state: Arc<RwLock<AppState>>) -> Result<(), Box<dyn std::error::Error>> {
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let client = redis::Client::open(redis_url)?;
    let mut redis_conn = client.get_multiplexed_async_connection().await?;
    
    let wss_url = "wss://pumpportal.fun/api/data";
    println!("🔌 [INGRESS] Connecting to PumpPortal WSS...");
    let (ws_stream, _) = connect_async(Url::parse(wss_url).unwrap()).await?;
    println!("✅ [INGRESS] Connected to PumpPortal");

    let (mut write, mut read) = ws_stream.split();
    
    let subscribe_msg = serde_json::json!({ "method": "subscribeNewToken" });
    write.send(Message::Text(subscribe_msg.to_string())).await?;
    println!("📡 [INGRESS] Tracking RAW MINT STREAM (No Filters)");
    let mut last_heartbeat = std::time::Instant::now();

    while let Some(msg) = read.next().await {
        let message = msg?; 
        
        // CIRCUIT BREAKER CHECK
        {
            let s = state.read().await;
            if s.status == SystemStatus::IdleInsufficientFunds {
                continue; // Skip processing ingress if underfunded
            }
        }

        if let Message::Text(text) = message {
            if let Ok(event) = serde_json::from_str::<PumpPortalEvent>(&text) {
                let init_buy = event.sol_amount.unwrap_or(0.0);
                
                // --- PDA DERIVATION ---
                let bonding_curve = if let Ok(mint_pubkey) = event.mint.parse::<Pubkey>() {
                    let pump_program = "6EF8rrecthR5DkZJ4NsuA5EBxc69m6tshv77pudCpump".parse::<Pubkey>().unwrap();
                    let (bc, _) = Pubkey::find_program_address(
                        &[b"bonding-curve", mint_pubkey.as_ref()],
                        &pump_program
                    );
                    bc.to_string()
                } else {
                    continue;
                };

                let payload = TargetPayload {
                    mint: event.mint.clone(),
                    pool_address: bonding_curve,
                    found_at: chrono::Utc::now().to_rfc3339(),
                    initial_sol: init_buy,
                    holder_avg_buy: event.market_cap_sol.unwrap_or(0.0),
                };
                
                let payload_str = serde_json::to_string(&payload).unwrap();
                let _: () = redis_conn.publish("discovered_tokens", &payload_str).await?;
            }
        }
        
        if last_heartbeat.elapsed() >= Duration::from_secs(60) {
            println!("💓 [INGRESS] Heartbeat: Stream active.");
            last_heartbeat = std::time::Instant::now();
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    env_logger::init();

    println!("🚀 Starting MILESTONE INGRESS SCOUT...");

    let host = env::var("POSTGRES_HOST").unwrap_or_else(|_| "postgres".to_string());
    let user = env::var("POSTGRES_USER").unwrap_or_else(|_| "ghost_user".to_string());
    let pass = env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "ghost_password".to_string());
    let db = env::var("POSTGRES_DB").unwrap_or_else(|_| "ghost_db".to_string());
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://redis:6379".to_string());
    
    let mut cfg = Config::new();
    cfg.host = Some(host);
    cfg.user = Some(user);
    cfg.password = Some(pass);
    cfg.dbname = Some(db);
    cfg.port = Some(5432);

    let db_pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)
        .expect("Failed to create DB pool");

    let state = Arc::new(RwLock::new(AppState {
        status: SystemStatus::Operational,
    }));

    // --- CIRCUIT BREAKER BACKGROUND TASK (30s) ---
    let cb_pool = db_pool.clone();
    let cb_state = state.clone();
    let cb_redis_client = redis::Client::open(redis_url).unwrap();
    tokio::spawn(async move {
        let mut redis_conn = cb_redis_client.get_multiplexed_async_connection().await.unwrap();
        loop {
            let client = match cb_pool.get().await {
                Ok(c) => c,
                Err(_) => { sleep(Duration::from_secs(5)).await; continue; }
            };
            
            let row = client.query_one("SELECT balance_sol FROM paper_wallets LIMIT 1", &[]).await;
            if let Ok(r) = row {
                let balance: f64 = r.get(0);
                let mut s = cb_state.write().await;
                if balance < 1.0 {
                    if s.status != SystemStatus::IdleInsufficientFunds {
                        println!("⚠️ [CIRCUIT_BREAKER] Balance low ({:.2} SOL). Entering IDLE state.", balance);
                        s.status = SystemStatus::IdleInsufficientFunds;
                        let _: () = redis_conn.set("milestone_system_status", "IDLE: INSUFFICIENT_FUNDS").await.unwrap_or(());
                    }
                } else {
                    if s.status != SystemStatus::Operational {
                        println!("✅ [CIRCUIT_BREAKER] Balance restored ({:.2} SOL). Resuming operations.", balance);
                        s.status = SystemStatus::Operational;
                        let _: () = redis_conn.set("milestone_system_status", "FULLY_OPERATIONAL").await.unwrap_or(());
                    }
                }
            }
            sleep(Duration::from_secs(30)).await;
        }
    });

    loop {
        match run_scout_logic(db_pool.clone(), state.clone()).await {
            Ok(_) => println!("⚠️ Scout stream ended. Restarting..."),
            Err(e) => println!("❌ Scout crashed: {}. Restarting in 2s...", e),
        }
        sleep(Duration::from_secs(2)).await;
    }
}
// house on the moon