use dotenv;
use std::env;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::sleep;
use serde::{Deserialize, Serialize};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;
use tokio_postgres::NoTls;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Serialize)]
struct TriggerPayload {
    mint: String,
    copy_trade_address: String,
    funding_source: String,
    entry_market_cap: Option<f64>,
    entry_v_sol: Option<f64>,
}

#[derive(Serialize)]
struct SubscribeRequest {
    method: String,
    keys: Vec<String>,
}

#[derive(Serialize)]
struct UnsubscribeRequest {
    method: String,
    keys: Vec<String>,
}

#[derive(Deserialize, Debug, Serialize, Clone)]
#[allow(non_snake_case)]
struct TradeMessage {
    signature: Option<String>,
    mint: Option<String>,
    traderPublicKey: Option<String>,
    txType: Option<String>,
    vSolInBondingCurve: Option<f64>,
    marketCapSol: Option<f64>,
    solAmount: Option<f64>,
}

/// Load ACTIVE wallet addresses from the database
async fn load_wallets_from_db() -> Vec<String> {
    let db_host = env::var("POSTGRES_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let db_port = env::var("POSTGRES_PORT").unwrap_or_else(|_| "5435".to_string());
    let db_user = env::var("POSTGRES_USER").unwrap_or_else(|_| "copy_trade_user".to_string());
    let db_pass = env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "copy_trade_password".to_string());
    let db_name = env::var("POSTGRES_DB").unwrap_or_else(|_| "copy_trade_db".to_string());

    let conn_str = format!(
        "host={} port={} user={} password={} dbname={}",
        db_host, db_port, db_user, db_pass, db_name
    );

    match tokio_postgres::connect(&conn_str, NoTls).await {
        Ok((client, connection)) => {
            // Spawn the connection handler
            tokio::spawn(async move {
                if let Err(e) = connection.await {
                    println!("❌ [SCOUT] DB connection error: {}", e);
                }
            });

            match client.query(
                "SELECT wallet_address FROM tracked_wallets WHERE status = 'ACTIVE'",
                &[]
            ).await {
                Ok(rows) => {
                    let wallets: Vec<String> = rows.iter()
                        .map(|row| row.get::<_, String>(0))
                        .collect();
                    println!("📋 [SCOUT] Loaded {} ACTIVE wallets from DB", wallets.len());
                    wallets
                }
                Err(e) => {
                    println!("❌ [SCOUT] DB query error: {}", e);
                    vec![]
                }
            }
        }
        Err(e) => {
            println!("❌ [SCOUT] DB connect error: {}", e);
            // Fallback to env var if DB is unavailable
            let fallback = env::var("COPY_TRADE_TARGET_WALLETS").unwrap_or_default();
            let wallets: Vec<String> = fallback.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !wallets.is_empty() {
                println!("⚠️ [SCOUT] Using {} wallets from env fallback", wallets.len());
            }
            wallets
        }
    }
}

async fn run_scout() -> Result<(), Box<dyn std::error::Error>> {
    let ws_url = "wss://pumpportal.fun/api/data";
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6381".to_string());

    // Load wallets from DB
    let target_wallets = load_wallets_from_db().await;

    if target_wallets.is_empty() {
        println!("❌ [SCOUT] No ACTIVE wallets found in DB. Waiting 30s before retry...");
        sleep(Duration::from_secs(30)).await;
        return Ok(());
    }

    let redis_client = redis::Client::open(redis_url)?;
    let mut redis_conn = redis_client.get_multiplexed_async_connection().await?;

    println!("🕵️ [SCOUT] Connecting to PumpPortal WSS...");
    let url = Url::parse(ws_url)?;
    let (ws_stream, _) = connect_async(url).await?;
    let (mut write, mut read) = ws_stream.split();

    println!("✅ [SCOUT] Connected! Subscribing to {} elite wallets...", target_wallets.len());
    
    // Share current wallet list for hot-reload
    let current_wallets = Arc::new(RwLock::new(target_wallets.clone()));
    
    let sub_req = SubscribeRequest {
        method: "subscribeAccountTrade".to_string(),
        keys: target_wallets.clone(),
    };
    
    write.send(Message::Text(serde_json::to_string(&sub_req)?)).await?;
    sleep(Duration::from_millis(500)).await; // Stabilization delay

    let mut heartbeat_interval = tokio::time::interval(Duration::from_secs(60));
    let max_trades = 5; // System cap to prevent API exhaustion
    
    loop {
        tokio::select! {
            _ = heartbeat_interval.tick() => {
                // Hot-reload: check DB for wallet changes every 60s
                let new_wallets = load_wallets_from_db().await;
                let old_wallets = current_wallets.read().await.clone();
                
                if new_wallets != old_wallets {
                    // Find added and removed wallets
                    let added: Vec<String> = new_wallets.iter()
                        .filter(|w| !old_wallets.contains(w))
                        .cloned()
                        .collect();
                    let removed: Vec<String> = old_wallets.iter()
                        .filter(|w| !new_wallets.contains(w))
                        .cloned()
                        .collect();

                    // Unsubscribe from removed wallets
                    if !removed.is_empty() {
                        println!("🔄 [SCOUT] Unsubscribing from {} retired wallets", removed.len());
                        let unsub = UnsubscribeRequest {
                            method: "unsubscribeAccountTrade".to_string(),
                            keys: removed,
                        };
                        let _ = write.send(Message::Text(serde_json::to_string(&unsub)?)).await;
                    }

                    // Subscribe to new wallets (with throttling)
                    if !added.is_empty() {
                        println!("🔄 [SCOUT] Subscribing to {} new wallets...", added.len());
                        for chunk in added.chunks(10) {
                            let sub = SubscribeRequest {
                                method: "subscribeAccountTrade".to_string(),
                                keys: chunk.to_vec(),
                            };
                            let _ = write.send(Message::Text(serde_json::to_string(&sub)?)).await;
                            sleep(Duration::from_millis(200)).await; // Throttling
                        }
                    }

                    *current_wallets.write().await = new_wallets.clone();
                    println!("✅ [SCOUT] Wallet list updated: {} active wallets", new_wallets.len());
                } else {
                    println!("[SCOUT] Standing by... Monitoring {} elite wallets.", new_wallets.len());
                }
            }
            msg = read.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    _ => break,
                };
                
                if let Message::Text(text) = msg {
                    let mut skip_reason = "NONE";
                    let mut is_valid_buy = false;
                    let mut detected_trade: Option<TradeMessage> = None;

                    if let Ok(trade) = serde_json::from_str::<TradeMessage>(&text) {
                        detected_trade = Some(trade.clone());
                        let tx_type = trade.txType.as_deref().unwrap_or("unknown");
                        
                        if tx_type.eq_ignore_ascii_case("buy") || tx_type.eq_ignore_ascii_case("create") {
                            if let Some(mint) = &trade.mint {
                                // --- CAPACITY CHECK ---
                                let db_host = env::var("POSTGRES_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
                                let db_port = env::var("POSTGRES_PORT").unwrap_or_else(|_| "5435".to_string());
                                let db_user = env::var("POSTGRES_USER").unwrap_or_else(|_| "copy_trade_user".to_string());
                                let db_pass = env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "copy_trade_password".to_string());
                                let db_name = env::var("POSTGRES_DB").unwrap_or_else(|_| "copy_trade_db".to_string());
                                let conn_str = format!("host={} port={} user={} password={} dbname={}", db_host, db_port, db_user, db_pass, db_name);
                                
                                let mut has_capacity = true;
                                if let Ok((client, connection)) = tokio_postgres::connect(&conn_str, NoTls).await {
                                    tokio::spawn(async move { if let Err(e) = connection.await { println!("❌ [SCOUT] DB Error: {}", e); } });
                                    if let Ok(row) = client.query_one("SELECT COUNT(*) FROM copy_trade_trades WHERE status = 'OPEN'", &[]).await {
                                        let count: i64 = row.get(0);
                                        if count >= max_trades {
                                            println!("🛑 [SCOUT] Capacity limit reached ({} positions). Skipping {}.", count, mint);
                                            has_capacity = false;
                                            skip_reason = "CAPACITY_LIMIT";
                                        }
                                    }
                                }

                                if has_capacity {
                                    is_valid_buy = true;
                                    let label = if tx_type.eq_ignore_ascii_case("create") { "CREATE+BUY" } else { "BUY" };
                                    println!("🚨 [COPY_TRADE {}] Elite Wallet {:?} is entering {}!", 
                                             label, trade.traderPublicKey, mint);
                                    
                                    let payload = TriggerPayload {
                                        mint: mint.clone(),
                                        copy_trade_address: trade.traderPublicKey.clone().unwrap_or_default(),
                                        funding_source: "SOLANA_ELITE".to_string(),
                                        entry_market_cap: trade.marketCapSol,
                                        entry_v_sol: trade.vSolInBondingCurve,
                                    };
                                    
                                    let payload_str = serde_json::to_string(&payload)?;
                                    let _: () = redis_conn.publish("copy_trade_triggers", &payload_str).await?;
                                }
                            } else {
                                skip_reason = "MISSING_MINT";
                            }
                        }

                        // --- CORE FIX: Sync Price to Redis for Sniper PnL Accuracy ---
                        if let Some(mint) = &trade.mint {
                            if let Some(mc) = trade.marketCapSol {
                                let price_data = serde_json::json!({
                                    "mc": mc,
                                    "timestamp": chrono::Utc::now().to_rfc3339()
                                });
                                let _: () = redis_conn.set_ex(format!("price:{}", mint), price_data.to_string(), 300).await?;
                            }
                        }

                        if tx_type.eq_ignore_ascii_case("sell") {
                            if let Some(mint) = &trade.mint {
                                println!("📤 [COPY_TRADE SELL] Elite Wallet {:?} is selling {}!", 
                                         trade.traderPublicKey, mint);
                                
                                // Signal the Sniper to exit this specific mint for this specific wallet
                                let wallet = trade.traderPublicKey.clone().unwrap_or_default();
                                let exit_key = format!("exit_signal:{}:{}", mint, wallet);
                                let _: () = redis_conn.set_ex(&exit_key, "TRUE", 60).await?;
                                
                                // Broad notification for any watchers
                                let exit_payload = serde_json::json!({
                                    "mint": mint,
                                    "wallet": wallet,
                                    "timestamp": chrono::Utc::now().to_rfc3339()
                                });
                                let _: () = redis_conn.publish("copy_trade_exit_triggers", exit_payload.to_string()).await?;
                                is_valid_buy = true; // Mark as "triggered" for log visibility
                            }
                        } else {
                            skip_reason = "NOT_A_BUY_OR_SELL";
                        }
                    } else {
                        skip_reason = "JSON_PARSE_ERROR";
                    }

                    // Always log signal to Redis for Dashboard Visibility (Last 50)
                    let log_entry = serde_json::json!({
                        "raw": text,
                        "parsed": detected_trade,
                        "skip_reason": skip_reason,
                        "is_triggered": is_valid_buy,
                        "timestamp": chrono::Utc::now().to_rfc3339()
                    });
                    let _: () = redis_conn.lpush("copy_trade_signals_log", log_entry.to_string()).await?;
                    let _: () = redis_conn.ltrim("copy_trade_signals_log", 0, 49).await?;
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
    println!("🚀 Starting COPY_TRADE SCOUT (Elite Wallet Tracker) — DB MODE");

    let mut backoff = 1;
    let max_backoff = 30;

    loop {
        match run_scout().await {
            Ok(_) => {
                println!("SYSTEM_HALT: Scout WSS disconnected. Restarting...");
                backoff = 1;
                sleep(Duration::from_secs(1)).await;
            }
            Err(e) => {
                println!("SYSTEM_ERROR: Scout Crashed: {}. Reconnecting in {}s...", e, backoff);
                sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(max_backoff);
            }
        }
    }
}
