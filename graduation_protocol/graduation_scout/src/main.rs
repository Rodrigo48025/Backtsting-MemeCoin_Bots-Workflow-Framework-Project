// Graduation Protocol Scout - "Point of No Return" Sensor
// Trigger exactly when Market Cap crosses 68 SOL (80% Curve)

use dotenv;
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;
use serde::{Deserialize, Serialize};
use std::env;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::sleep;
use chrono;
use std::sync::Arc;
use tokio::sync::Mutex;
use solana_program::pubkey::Pubkey;
use deadpool_postgres::{Pool, Config, Runtime};
use tokio_postgres::NoTls;
use std::collections::HashSet;

#[derive(Debug, Deserialize)]
struct PumpPortalEvent {
    mint: Option<String>,
    #[serde(rename = "txType")]
    tx_type: Option<String>,
    #[serde(rename = "marketCapSol")]
    market_cap_sol: Option<f64>,
}

#[derive(Serialize)]
struct TriggerPayload {
    mint: String,
    pool_address: String, 
    found_at: String,
    trigger_market_cap: f64,
}

async fn run_scout_logic(db_pool: Pool) -> Result<(), Box<dyn std::error::Error>> {
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let client = redis::Client::open(redis_url)?;
    let mut redis_conn = client.get_multiplexed_async_connection().await?;
    
    let wss_url = "wss://pumpportal.fun/api/data";
    println!("🔌 [GRADUATION SCOUT] Connecting to PumpPortal WSS...");
    let (ws_stream, _) = connect_async(Url::parse(wss_url).unwrap()).await?;
    println!("✅ [GRADUATION SCOUT] Connected to PumpPortal");

    let (write, mut read) = ws_stream.split();
    let write = Arc::new(Mutex::new(write));
    
    let subscribe_msg = serde_json::json!({ "method": "subscribeNewToken" });
    write.lock().await.send(Message::Text(subscribe_msg.to_string())).await?;
    println!("📡 [GRADUATION SCOUT] Subscribed to New Token Stream. Preparing to track launches to 68 SOL...");

    let mut triggered_mints = HashSet::new();
    let mut msg_count = 0;
    let mut last_msg_time = std::time::Instant::now();

    loop {
        tokio::select! {
            msg = read.next() => {
                match msg {
                    Some(Ok(message)) => {
                        last_msg_time = std::time::Instant::now();
                        msg_count += 1;
                        if msg_count % 500 == 0 {
                            println!("💓 [GRADUATION SCOUT] Heartbeat: Processed {} messages...", msg_count);
                        }

                        if let Message::Text(text) = message {
                            match serde_json::from_str::<PumpPortalEvent>(&text) {
                                Ok(event) => {
                                    if let Some(mint) = &event.mint {
                                        let mut skip_reason = "NONE";
                                        let mut is_triggered = false;

                                        if event.tx_type.as_deref() == Some("create") {
                                            println!("🌱 [GRADUATION SCOUT] New Token Detected: {}", mint);
                                            // Subscribe to trades for this specific newly minted token
                                            let sub_trades = serde_json::json!({
                                                "method": "subscribeTokenTrade",
                                                "keys": [mint]
                                            });
                                            let _ = write.lock().await.send(Message::Text(sub_trades.to_string())).await;
                                            skip_reason = "TRACKING_STARTED";
                                        } 
                                        else if event.tx_type.as_deref() == Some("buy") {
                                            if let Some(mc) = event.market_cap_sol {
                                                // Check for "Point of No Return" threshold (80% curve ~ 68 SOL)
                                                if mc >= 68.0 && mc <= 85.0 {
                                                    println!("🔥 [GRADUATION DETECTED] Token {} crossed 68 SOL (Current MC: {:.2})! Triggering Sniper...", mint, mc);

                                                    triggered_mints.insert(mint.clone());
                                                    is_triggered = true;

                                                    let bonding_curve = if let Ok(mint_pubkey) = mint.parse::<Pubkey>() {
                                                        let pump_program = "6EF8rrecthR5DkZJ4NsuA5EBxc69m6tshv77pudCpump".parse::<Pubkey>().unwrap();
                                                        let (bc, _) = Pubkey::find_program_address(
                                                            &[b"bonding-curve", mint_pubkey.as_ref()],
                                                            &pump_program
                                                        );
                                                        bc.to_string()
                                                    } else {
                                                        "UNKNOWN".to_string()
                                                    };

                                                    let payload = TriggerPayload {
                                                        mint: mint.clone(),
                                                        pool_address: bonding_curve,
                                                        found_at: chrono::Utc::now().to_rfc3339(),
                                                        trigger_market_cap: mc,
                                                    };
                                                    
                                                    let payload_str = serde_json::to_string(&payload).unwrap();
                                                    let _: () = redis_conn.publish("graduation_triggers", &payload_str).await?;
                                                    
                                                    // Unsubscribe from this token to save bandwidth since it's already fired
                                                    let unsub_trades = serde_json::json!({
                                                        "method": "unsubscribeTokenTrade",
                                                        "keys": [mint]
                                                    });
                                                    let _ = write.lock().await.send(Message::Text(unsub_trades.to_string())).await;
                                                } else {
                                                    skip_reason = "BELOW_THRESHOLD";
                                                }
                                            }
                                        } else {
                                            skip_reason = "NOT_A_BUY";
                                        }

                                        // Always log signal to Redis for Dashboard Visibility (Last 50)
                                        let log_entry = serde_json::json!({
                                            "raw": text,
                                            "mint": mint,
                                            "market_cap": event.market_cap_sol,
                                            "tx_type": event.tx_type,
                                            "skip_reason": skip_reason,
                                            "is_triggered": is_triggered,
                                            "timestamp": chrono::Utc::now().to_rfc3339()
                                        });
                                        let _: () = redis_conn.lpush("graduation_signals_log", log_entry.to_string()).await?;
                                        let _: () = redis_conn.ltrim("graduation_signals_log", 0, 49).await?;
                                    }
                                }
                                Err(e) => {
                                    // Only log if it's not a subscription success/error message
                                    if !text.contains("Successfully subscribed") && !text.contains("error") {
                                        println!("⚠️ [GRADUATION SCOUT] JSON Parse Error: {} | Data: {}", e, text);
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(e.into()),
                    None => return Ok(()),
                }
            }
            _ = sleep(Duration::from_secs(60)) => {
                if last_msg_time.elapsed() > Duration::from_secs(60) {
                    println!("📡 [GRADUATION SCOUT] 60s Idle Timeout. Reconnecting...");
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    env_logger::init();

    println!("🚀 Starting GRADUATION SCOUT (The 68 SOL Sensor)...");

    let host = env::var("POSTGRES_HOST").unwrap_or_else(|_| "postgres".to_string());
    let user = env::var("POSTGRES_USER").unwrap_or_else(|_| "graduation_user".to_string());
    let pass = env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "graduation_password".to_string());
    let db = env::var("POSTGRES_DB").unwrap_or_else(|_| "graduation_db".to_string());
    
    let mut cfg = Config::new();
    cfg.host = Some(host);
    cfg.user = Some(user);
    cfg.password = Some(pass);
    cfg.dbname = Some(db);
    cfg.port = Some(5432);

    let db_pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)
        .expect("Failed to create DB pool");

    let mut backoff = 1;
    let max_backoff = 30;

    loop {
        match run_scout_logic(db_pool.clone()).await {
            Ok(_) => println!("⚠️ Scout stream ended. Restarting..."),
            Err(e) => {
                println!("❌ Scout crashed: {}. Restarting in {}s...", e, backoff);
                sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(max_backoff);
            }
        }
    }
}