use dotenv;
use serde::{Deserialize, Serialize};
use std::env;
use std::sync::Arc;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::sleep;
use deadpool_postgres::{Pool, Config, Runtime};
use tokio_postgres::NoTls;
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;

#[derive(Debug, Deserialize)]
struct TriggerPayload {
    mint: String,
    pool_address: String,
    found_at: String,
    trigger_market_cap: f64,
}

#[derive(Deserialize, Debug)]
#[allow(non_snake_case)]
struct PumpPortalTrade {
    txType: Option<String>,
    mint: Option<String>,
    marketCapSol: Option<f64>,
}

const TRANSACTION_FEE: f64 = 0.0001; 
const TARGET_BUY_SOL: f64 = 0.5; // Configurable buy size

async fn execute_trade(
    pool: Pool,
    mut redis_conn: redis::aio::Connection,
    payload: TriggerPayload,
    http_client: reqwest::Client,
) {
    let mint = payload.mint.clone();
    println!("🎯 [GRADUATION SNIPER] Trigger Received! Sniping 80% Curve for {}", mint);

    let lock_key = format!("graduation_pos:{}", mint);
    let acquired: Option<String> = redis::cmd("SET")
        .arg(&lock_key)
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg(1200)
        .query_async(&mut redis_conn)
        .await
        .unwrap_or(None);

    if acquired.is_none() {
        println!("⏭️  [GRADUATION SNIPER] Skipping {} — Position already active.", mint);
        return;
    }

    let entry_mc = payload.trigger_market_cap;
    let entry_price = entry_mc / 1_000_000_000.0;
    
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => { 
            println!("❌ DB Pool Error: {}", e); 
            let _: () = redis_conn.del(&lock_key).await.unwrap_or(()); 
            return; 
        }
    };

    let total_cost = TARGET_BUY_SOL + TRANSACTION_FEE;
    let res = client.execute(
        "UPDATE paper_wallets SET balance_sol = balance_sol - $1 WHERE wallet_address = 'GRADUATION_MAIN_WAREHOUSE' AND balance_sol >= $1",
        &[&total_cost]
    ).await;

    if let Ok(rows) = res {
        if rows == 0 {
            println!("⚠️ [GRADUATION SNIPER] Insufficient Funds for {}", mint);
            let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
            return;
        }
    } else {
        let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
        return;
    }

    // Creating table if doesn't exist just in case user didn't update init.sql properly
    let _ = client.execute(
        "CREATE TABLE IF NOT EXISTS graduation_trades (
            id SERIAL PRIMARY KEY,
            token_mint TEXT NOT NULL,
            pool_address TEXT NOT NULL,
            entry_price DOUBLE PRECISION,
            exit_price DOUBLE PRECISION,
            entry_sol_amount DOUBLE PRECISION,
            pnl_percentage DOUBLE PRECISION DEFAULT 0.0,
            status TEXT DEFAULT 'OPEN',
            entry_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            exit_timestamp TIMESTAMP WITH TIME ZONE
        )",
        &[]
    ).await;

    let _ = client.execute(
        "INSERT INTO graduation_trades (token_mint, pool_address, entry_price, entry_sol_amount, status) 
         VALUES ($1, $2, $3, $4, 'OPEN')",
        &[&mint, &payload.pool_address, &entry_price, &TARGET_BUY_SOL]
    ).await;

    println!("✅ [GRADUATION SNIPER] Entered {} at price {:.8}", mint, entry_price);

    // --- REAL-TIME PNL TRACKING VIA PUMPPORTAL WS (WITH RETRY) ---
    let mut current_price = entry_price;
    let mut pnl_pct = 0.0;
    let timeout_duration = Duration::from_secs(120); // 2 min max hold
    let start_time = std::time::Instant::now();
    let mut ws_connected = false;

    // --- WS CONNECTION WITH 3 RETRIES + EXPONENTIAL BACKOFF ---
    let max_ws_retries = 3;
    for attempt in 1..=max_ws_retries {
        if start_time.elapsed() > timeout_duration { break; }

        match connect_async(Url::parse("wss://pumpportal.fun/api/data").unwrap()).await {
            Ok((ws_stream, _)) => {
                let (mut write, mut read) = ws_stream.split();
                let sub_msg = serde_json::json!({"method": "subscribeTokenTrade", "keys": [&mint]});
                if write.send(Message::Text(sub_msg.to_string())).await.is_err() {
                    println!("⚠️ [GRADUATION SNIPER] WS send failed for {} (attempt {}/{})", mint, attempt, max_ws_retries);
                    sleep(Duration::from_secs(1 << attempt)).await;
                    continue;
                }

                println!("📈 [GRADUATION SNIPER] Subscribed to live trades for {} (attempt {}/{}). Monitoring TP/SL...", mint, attempt, max_ws_retries);
                ws_connected = true;
                let mut consecutive_timeouts = 0;

                loop {
                    if start_time.elapsed() > timeout_duration {
                        println!("⏳ [GRADUATION SNIPER] Hard TTL (120s) reached for {}", mint);
                        break;
                    }

                    match tokio::time::timeout(Duration::from_secs(5), read.next()).await {
                        Ok(Some(Ok(Message::Text(text)))) => {
                            consecutive_timeouts = 0;
                            if let Ok(trade) = serde_json::from_str::<PumpPortalTrade>(&text) {
                                if let Some(mc) = trade.marketCapSol {
                                    current_price = mc / 1_000_000_000.0;
                                    let gross_pnl_pct = ((current_price - entry_price) / entry_price) * 100.0;
                                    let fee_impact_pct = (TRANSACTION_FEE / TARGET_BUY_SOL) * 100.0;
                                    pnl_pct = gross_pnl_pct - fee_impact_pct;

                                    let _ = client.execute(
                                        "UPDATE graduation_trades SET pnl_percentage = $1 WHERE token_mint = $2 AND status = 'OPEN'",
                                        &[&pnl_pct, &mint]
                                    ).await;

                                    if pnl_pct >= 40.0 {
                                        println!("🔥 [GRADUATION SNIPER] TP HIT (+{:.2}%) for {}! Exiting.", pnl_pct, mint);
                                        break;
                                    } else if pnl_pct <= -15.0 {
                                        println!("🛑 [GRADUATION SNIPER] SL HIT ({:.2}%) for {}! Exiting.", pnl_pct, mint);
                                        break;
                                    }
                                }
                            }
                        }
                        Ok(Some(Err(_))) | Ok(None) => {
                            // WS stream closed mid-session — break inner loop to trigger reconnect
                            println!("🔌 [GRADUATION SNIPER] WS stream dropped for {}. Will retry...", mint);
                            ws_connected = false;
                            break;
                        }
                        Err(_) => {
                            // Timeout — no trades in 5s, this is normal for low-volume tokens
                            consecutive_timeouts += 1;
                            if consecutive_timeouts >= 12 {
                                // 60s of silence — break to attempt reconnect
                                println!("📡 [GRADUATION SNIPER] 60s silence on WS for {}. Reconnecting...", mint);
                                ws_connected = false;
                                break;
                            }
                        }
                        _ => {
                            // Binary, Ping, Pong, Close — ignore and continue
                        }
                    }
                }

                // If we exited cleanly (TP/SL/TTL), stop retrying
                if ws_connected || start_time.elapsed() > timeout_duration || pnl_pct >= 40.0 || pnl_pct <= -15.0 {
                    break;
                }
                // Otherwise, fall through to retry the WS connection
            }
            Err(e) => {
                println!("⚠️ [GRADUATION SNIPER] WS connect failed for {} (attempt {}/{}): {}", mint, attempt, max_ws_retries, e);
                if attempt < max_ws_retries {
                    let backoff = Duration::from_secs(1 << attempt); // 2s, 4s, 8s
                    println!("⏳ [GRADUATION SNIPER] Retrying in {:?}...", backoff);
                    sleep(backoff).await;
                }
            }
        }
    }

    // --- FALLBACK: If all WS attempts failed, poll Shyft for a final price snapshot ---
    if !ws_connected && pnl_pct == 0.0 && start_time.elapsed() < timeout_duration {
        println!("🔄 [GRADUATION SNIPER] All WS attempts failed for {}. Polling Shyft for final price...", mint);
        let shyft_keys_str = env::var("SHYFT_API_KEYS").unwrap_or_default();
        let shyft_keys: Vec<&str> = shyft_keys_str.split(',').filter(|k| !k.is_empty()).collect();
        if let Some(key) = shyft_keys.first() {
            let url = format!("https://defi.shyft.to/v0/pools/get_by_token?token={}", mint);
            if let Ok(resp) = http_client.get(&url).header("x-api-key", *key).send().await {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(pools) = json["result"]["pools"].as_array() {
                        if let Some(pool) = pools.first() {
                            if let Some(mc) = pool["stats"]["market_cap_usd"].as_f64() {
                                if mc > 0.0 {
                                    current_price = mc / 1_000_000_000.0;
                                    let gross_pnl_pct = ((current_price - entry_price) / entry_price) * 100.0;
                                    let fee_impact_pct = (TRANSACTION_FEE / TARGET_BUY_SOL) * 100.0;
                                    pnl_pct = gross_pnl_pct - fee_impact_pct;
                                    println!("📊 [GRADUATION SNIPER] Shyft fallback price for {}: MC={:.2}, PnL={:.2}%", mint, mc, pnl_pct);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = client.execute(
        "UPDATE graduation_trades SET exit_price = $1, exit_timestamp = NOW(), pnl_percentage = $2, status = 'CLOSED' 
         WHERE token_mint = $3 AND status = 'OPEN'",
        &[&current_price, &pnl_pct, &mint]
    ).await;

    let mut final_balance_credit = TARGET_BUY_SOL * (1.0 + (pnl_pct / 100.0));
    if final_balance_credit < 0.0 { final_balance_credit = 0.0; } 

    let _ = client.execute(
        "UPDATE paper_wallets SET balance_sol = balance_sol + $1 WHERE wallet_address = 'GRADUATION_MAIN_WAREHOUSE'",
        &[&final_balance_credit]
    ).await;

    println!("🏁 [GRADUATION SNIPER] Position Closed: {} | Final PnL: {:.2}%", mint, pnl_pct);
    let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();
    env_logger::init();
    println!("🚀 Starting GRADUATION SNIPER (The Accelerator)...");

    let http_client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?;

    let mut cfg = Config::new();
    cfg.host = Some(env::var("POSTGRES_HOST").unwrap_or_else(|_| "localhost".to_string()));
    cfg.user = Some(env::var("POSTGRES_USER").unwrap_or_else(|_| "graduation_user".to_string()));
    cfg.password = Some(env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "graduation_password".to_string()));
    cfg.dbname = Some(env::var("POSTGRES_DB").unwrap_or_else(|_| "graduation_db".to_string()));
    let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;

    // Orphan Cleanup
    println!("🧹 [GRADUATION SNIPER] Reconciling orphaned trades...");
    if let Ok(db_client) = pool.get().await {
        let _ = db_client.execute(
            "UPDATE graduation_trades SET status = 'CLOSED', exit_timestamp = NOW(), pnl_percentage = 0 
             WHERE status = 'OPEN'",
            &[]
        ).await;
        let _ = db_client.execute(
            "INSERT INTO paper_wallets (wallet_address, balance_sol, total_contributed_sol)
             VALUES ('GRADUATION_MAIN_WAREHOUSE', 10.0, 10.0)
             ON CONFLICT DO NOTHING",
            &[]
        ).await;
    }

    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let client = redis::Client::open(redis_url)?;
    
    let mut redis_conn = client.get_async_connection().await?;
    let mut pubsub = redis_conn.into_pubsub();
    pubsub.subscribe("graduation_triggers").await?;

    let mut stream = pubsub.on_message();
    println!("🕵️ [GRADUATION SNIPER] Waiting for 80% Curve Triggers...");
    
    while let Some(msg) = stream.next().await {
        let payload_str: String = match msg.get_payload() {
            Ok(s) => s,
            Err(_) => continue,
        };
        
        if let Ok(payload) = serde_json::from_str::<TriggerPayload>(&payload_str) {
            if let Ok(redis_conn) = client.get_async_connection().await {
                let thread_pool = pool.clone();
                let thread_http = http_client.clone();
                tokio::spawn(async move {
                    execute_trade(thread_pool, redis_conn, payload, thread_http).await;
                });
            }
        }
    }

    Ok(())
}