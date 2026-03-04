use dotenv;
use futures_util::{StreamExt, SinkExt}; 
use redis;
use std::env;
use std::collections::{HashSet, HashMap};
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use deadpool_postgres::{Config, Runtime, Pool};
use tokio_postgres::NoTls;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;
use serde::Deserialize;
use tokio::sync::{Mutex, broadcast, RwLock};
use chrono::Utc;
use std::time::Duration;
use tokio::time::sleep;

mod monitor;
use monitor::TokenMonitor;

#[derive(Deserialize, Debug)]
struct TargetMessage {
    mint: String,
    found_at: String,
    pool_address: String,
    #[serde(default)] 
    initial_sol: f64,
    #[serde(default)] 
    holder_avg_buy: f64,
}

#[derive(Deserialize, Debug)]
struct PumpPortalTrade {
    #[serde(rename = "txType")]
    tx_type: String,
    mint: String,
    #[serde(rename = "marketCapSol")]
    market_cap_sol: f64,
}

struct PendingTarget {
    pool_address: String,
    initial_sol: f64,
    found_at: chrono::DateTime<chrono::Utc>,
    tx: tokio::sync::mpsc::UnboundedSender<f64>,
}

#[derive(Clone, Copy, PartialEq)]
enum SystemStatus {
    Operational,
    IdleInsufficientFunds,
}

struct AppState {
    status: SystemStatus,
}

struct PumpPortalWatcher {
    db_pool: Pool,
    pending: Arc<Mutex<HashMap<String, PendingTarget>>>,
    monitoring: Arc<Mutex<HashMap<String, tokio::sync::mpsc::UnboundedSender<f64>>>>,
    sub_rx: tokio::sync::mpsc::UnboundedReceiver<String>,
    state: Arc<RwLock<AppState>>,
}

impl PumpPortalWatcher {
    fn new(pool: Pool, sub_rx: tokio::sync::mpsc::UnboundedReceiver<String>, state: Arc<RwLock<AppState>>) -> Self {
        Self { 
            db_pool: pool,
            pending: Arc::new(Mutex::new(HashMap::new())),
            monitoring: Arc::new(Mutex::new(HashMap::new())),
            sub_rx,
            state
        }
    }

    async fn log_milestone_target(pool: &Pool, mint: &str, pool_address: &str, initial_sol: f64, created_at: chrono::DateTime<chrono::Utc>) {
        let client = match pool.get().await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("❌ Failed to get DB client for milestone log: {}", e);
                return;
            }
        };
        let query = "INSERT INTO target_queue (mint_address, pool_address, initial_liquidity, status, target_mc, created_at) VALUES ($1, $2, $3, 'PENDING', 10.0, $4) ON CONFLICT (mint_address) DO NOTHING";
        let _ = client.execute(query, &[&mint, &pool_address, &initial_sol, &created_at]).await;
    }

    async fn run(mut self) {
        let wss_url = "wss://pumpportal.fun/api/data";
        loop {
            println!("🔌 [WATCHER] Connecting to PumpPortal WSS...");
            if let Ok((ws_stream, _)) = connect_async(Url::parse(wss_url).unwrap()).await {
                let (mut write, mut read) = ws_stream.split();
                println!("✅ [WATCHER] PumpPortal Connected.");

                loop {
                    tokio::select! {
                        Some(mint) = self.sub_rx.recv() => {
                            // CIRCUIT BREAKER CHECK
                            {
                                let s = self.state.read().await;
                                if s.status == SystemStatus::IdleInsufficientFunds {
                                    continue;
                                }
                            }
                            let sub_msg = serde_json::json!({"method": "subscribeTokenTrade", "keys": [mint]});
                            let _ = write.send(Message::Text(sub_msg.to_string())).await;
                        },
                        msg = read.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    // CIRCUIT BREAKER CHECK
                                    {
                                        let s = self.state.read().await;
                                        if s.status == SystemStatus::IdleInsufficientFunds {
                                            continue;
                                        }
                                    }

                                    if let Ok(trade) = serde_json::from_str::<PumpPortalTrade>(&text) {
                                        // 1. Check if we are already monitoring this (PnL Updates)
                                        {
                                            let monitors = self.monitoring.lock().await;
                                            if let Some(tx) = monitors.get(&trade.mint) {
                                                let _ = tx.send(trade.market_cap_sol);
                                            }
                                        }

                                        // 2. Check if it's a pending target hitting milestone
                                        let mut map = self.pending.lock().await;
                                        if let Some(target) = map.get_mut(&trade.mint) {
                                            let age = Utc::now().signed_duration_since(target.found_at);
                                            if age.num_minutes() >= 20 {
                                                println!("💀 [WATCHER] {} Expired (20m). Removing.", &trade.mint[..8]);
                                                map.remove(&trade.mint);
                                                continue;
                                            }
                                            if trade.market_cap_sol >= 10.0 {
                                                println!("🎯 [WATCHER] Milestone hit for {}! Triggering Sniper.", &trade.mint[..8]);
                                                if let Some(target_owned) = map.remove(&trade.mint) {
                                                    // Add to monitoring map before triggering snipe
                                                    self.monitoring.lock().await.insert(trade.mint.clone(), target_owned.tx.clone());
                                                    
                                                    Self::log_milestone_target(&self.db_pool, &trade.mint, &target_owned.pool_address, target_owned.initial_sol, target_owned.found_at).await;
                                                    let _ = target_owned.tx.send(trade.market_cap_sol);
                                                }
                                            }
                                        }
                                    }
                                },
                                Some(Err(_)) | None => break,
                                _ => {}
                            }
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();
    env_logger::init();

    println!("🚀 Starting MILESTONE WATCHER/SNIPER (Circuit Breaker Enabled)...");

    let mut pg_config = Config::new();
    pg_config.host = Some(env::var("POSTGRES_HOST").unwrap_or("localhost".to_string()));
    pg_config.user = Some(env::var("POSTGRES_USER").unwrap_or("ghost_user".to_string()));
    pg_config.password = Some(env::var("POSTGRES_PASSWORD").unwrap_or("ghost_password".to_string()));
    pg_config.dbname = Some(env::var("POSTGRES_DB").unwrap_or("ghost_db".to_string()));
    let pool = pg_config.create_pool(Some(Runtime::Tokio1), NoTls).unwrap();

    // --- ORPHAN CLEANUP: Close stale OPEN trades from previous restarts ---
    {
        let client = pool.get().await.expect("DB connection for orphan cleanup");
        
        // Credit wallet for orphaned positions
        let _ = client.execute(
            "UPDATE paper_wallets SET balance_sol = balance_sol + COALESCE((SELECT SUM(entry_sol_amount) FROM virtual_trades WHERE status = 'OPEN' AND discovery_timestamp < NOW() - INTERVAL '5 minutes'), 0), last_updated = NOW()",
            &[]
        ).await;
        
        // Close orphaned trades
        let orphans = client.execute(
            "UPDATE virtual_trades SET status = 'CLOSED', exit_timestamp = NOW(), pnl_percentage = -1.0, pnl_sol = -1.0 WHERE status = 'OPEN' AND discovery_timestamp < NOW() - INTERVAL '5 minutes'",
            &[]
        ).await.unwrap_or(0);
        
        if orphans > 0 {
            println!("🧹 [STARTUP] Cleaned {} orphan OPEN trades from previous session.", orphans);
        }
    }

    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let state = Arc::new(RwLock::new(AppState { status: SystemStatus::Operational }));

    let (panic_tx, _) = broadcast::channel::<()>(16);
    let (sub_tx, sub_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    
    let watcher_val = PumpPortalWatcher::new(pool.clone(), sub_rx, state.clone());
    let pending_shared = watcher_val.pending.clone();
    let monitoring_shared = watcher_val.monitoring.clone();
    tokio::spawn(async move { watcher_val.run().await });

    // --- CIRCUIT BREAKER TASK ---
    let cb_pool = pool.clone();
    let cb_state = state.clone();
    let cb_pending = pending_shared.clone();
    let cb_redis_client = redis::Client::open(redis_url.clone()).unwrap();
    tokio::spawn(async move {
        let mut redis_conn = cb_redis_client.get_multiplexed_async_connection().await.unwrap();
        loop {
            let client = match cb_pool.get().await {
                Ok(c) => c,
                Err(_) => { sleep(Duration::from_secs(5)).await; continue; }
            };
            if let Ok(r) = client.query_one("SELECT balance_sol FROM paper_wallets LIMIT 1", &[]).await {
                let balance: f64 = r.get(0);
                let mut s = cb_state.write().await;
                if balance < 1.0 {
                    if s.status != SystemStatus::IdleInsufficientFunds {
                        println!("⚠️ [CIRCUIT_BREAKER] Balance low ({:.2} SOL). Evicting queue.", balance);
                        s.status = SystemStatus::IdleInsufficientFunds;
                        cb_pending.lock().await.clear(); // User requirement: clear queue
                        let _: () = redis::AsyncCommands::set(&mut redis_conn, "milestone_system_status", "IDLE: INSUFFICIENT_FUNDS").await.unwrap_or(());
                    }
                } else {
                    if s.status != SystemStatus::Operational {
                        println!("✅ [CIRCUIT_BREAKER] Balance restored ({:.2} SOL).", balance);
                        s.status = SystemStatus::Operational;
                        let _: () = redis::AsyncCommands::set(&mut redis_conn, "milestone_system_status", "FULLY_OPERATIONAL").await.unwrap_or(());
                    }
                }
            }
            println!("💓 [WATCHER] Heartbeat: System active.");
            sleep(Duration::from_secs(60)).await;
        }
    });

    let client = redis::Client::open(redis_url.clone())?;
    let active_mints: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let helius_keys: Vec<String> = env::var("HELIUS_API_KEYS").expect("HELIUS_API_KEYS").split(',').map(|k| k.trim().to_string()).collect();
    let key_index = Arc::new(AtomicUsize::new(0));

    loop {
        println!("🔌 [WATCHER] Connecting to Redis Ingress...");
        match client.get_async_connection().await {
            Ok(conn) => {
                let mut pubsub = conn.into_pubsub();
                if let Err(_) = pubsub.subscribe("discovered_tokens").await { sleep(Duration::from_secs(5)).await; continue; }

                let mut stream = pubsub.on_message();
                loop {
                    match tokio::time::timeout(Duration::from_secs(300), stream.next()).await {
                        Ok(Some(msg)) => {
                            // CIRCUIT BREAKER CHECK
                            {
                                let s = state.read().await;
                                if s.status == SystemStatus::IdleInsufficientFunds { continue; }
                            }

                            if let Ok(payload) = msg.get_payload::<String>() {
                                if let Ok(target) = serde_json::from_str::<TargetMessage>(&payload) {
                                    let mut active = active_mints.lock().await;
                                    if active.contains(&target.mint) { continue; }
                                    active.insert(target.mint.clone());

                                    let _ = sub_tx.send(target.mint.clone());
                                    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<f64>();
                                    let found_time = target.found_at.parse::<chrono::DateTime<chrono::Utc>>().unwrap_or_else(|_| Utc::now());
                                    
                                    pending_shared.lock().await.insert(target.mint.clone(), PendingTarget {
                                        pool_address: target.pool_address.clone(),
                                        initial_sol: target.initial_sol,
                                        found_at: found_time,
                                        tx,
                                    });

                                    let thread_pool = pool.clone();
                                    let thread_active_list = active_mints.clone();
                                    let thread_monitoring_list = monitoring_shared.clone();
                                    let helius_key = helius_keys[key_index.fetch_add(1, Ordering::Relaxed) % helius_keys.len()].clone();
                                    let panic_rx = panic_tx.subscribe();
                                    tokio::spawn(async move {
                                        let mut monitor = TokenMonitor::new(target.mint.clone(), target.pool_address, helius_key, thread_pool, 0.0, found_time, rx, panic_rx);
                                        monitor.run().await;
                                        thread_active_list.lock().await.remove(&target.mint);
                                        thread_monitoring_list.lock().await.remove(&target.mint);
                                    });
                                }
                            }
                        },
                        _ => break,
                    }
                }
            },
            Err(_) => sleep(Duration::from_secs(5)).await,
        }
    }
}
// house on the moon