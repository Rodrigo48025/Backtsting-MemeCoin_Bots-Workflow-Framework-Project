use dotenv;
use serde::{Deserialize, Serialize};
use std::env;
use std::sync::Arc;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::sleep;
use deadpool_postgres::{Pool, Config, Runtime};
use tokio_postgres::NoTls;
use chrono::Utc;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Debug, Deserialize)]
struct TriggerPayload {
    mint: String,
    copy_trade_address: String,
    funding_source: String,
    entry_market_cap: Option<f64>,
    entry_v_sol: Option<f64>,
}

struct Trade {
    mint: String,
    copy_trade_address: String,
    funding_source: String,
    entry_sol: f64,
}

const TRANSACTION_FEE: f64 = 0.0001; // SOL per round-trip (base tx + priority fee, no Jito tip)

// --- REAL PRICE FEED FUNCTIONS ---

/// Primary: Read cached market cap from Redis (set by Watcher from PumpPortal stream)
async fn fetch_price_redis(redis_conn: &mut redis::aio::Connection, mint: &str) -> Option<f64> {
    let raw: Option<String> = redis_conn.get(format!("price:{}", mint)).await.ok()?;
    let val = match raw {
        Some(v) => v,
        None => {
            // println!("[REDIS] No key found for price:{}", mint);
            return None;
        }
    };
    let json: serde_json::Value = serde_json::from_str(&val).ok()?;
    let mc = json["mc"].as_f64()?;
    if mc > 0.0 { Some(mc) } else { None }
}

/// Fallback: Call Shyft DeFi API with key rotation
async fn fetch_price_shyft(
    http_client: &reqwest::Client,
    mint: &str,
    keys: &[String],
    key_idx: &AtomicUsize,
) -> Option<f64> {
    if keys.is_empty() { return None; }
    let idx = key_idx.fetch_add(1, Ordering::Relaxed);
    let key = &keys[idx % keys.len()];
    
    let resp = match http_client
        .get(format!("https://defi.shyft.to/v0/pools/get_by_token?token={}", mint))
        .header("x-api-key", key.as_str())
        .timeout(Duration::from_secs(3))
        .send()
        .await {
            Ok(r) => r,
            Err(e) => {
                println!("[SHYFT] Request failed for {}: {}", mint, e);
                return None;
            }
        };
    
    if !resp.status().is_success() {
        println!("[SHYFT] Error status {} for {}", resp.status(), mint);
        return None;
    }

    let json: serde_json::Value = resp.json().await.ok()?;
    
    // Try to extract market cap from pool stats
    if let Some(pools) = json["result"]["pools"].as_array() {
        if let Some(pool) = pools.first() {
            if let Some(mc) = pool["stats"]["market_cap_usd"].as_f64() {
                if mc > 0.0 { return Some(mc); }
            }
            if let Some(price) = pool["stats"]["base_token_price_usd"].as_f64() {
                if price > 0.0 { return Some(price * 1_000_000_000.0); }
            }
        }
    }
    println!("[SHYFT] No pool data found in response for {}", mint);
    None
}

async fn execute_trade(
    pool: Pool,
    mut redis_conn: redis::aio::Connection,
    payload: TriggerPayload,
    http_client: reqwest::Client,
    shyft_keys: Arc<Vec<String>>,
    shyft_key_idx: Arc<AtomicUsize>,
) {
    let trade = Trade {
        mint: payload.mint.clone(),
        copy_trade_address: payload.copy_trade_address.clone(),
        funding_source: payload.funding_source.clone(),
        entry_sol: 0.1, // Strict 0.1 SOL per trade
    };

    println!("🎯 [ASSASSIN] Trigger Received for {} (CopyTrade: {})", trade.mint, trade.copy_trade_address);

    // --- PHASE 4: CONCURRENCY & DEDUPLICATION ---
    let lock_key = format!("copy_trade_pos:{}", trade.mint);
    let acquired: Option<String> = redis::cmd("SET")
        .arg(&lock_key)
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg(300) // Reduced from 1200s (20m) to 300s (5m) for more aggression
        .query_async(&mut redis_conn)
        .await
        .unwrap_or(None);

    if acquired.is_none() {
        println!("⏭️  [ASSASSIN] Skipping {} — Position already active.", trade.mint);
        return;
    }

    // --- PHASE 3: ENTRY GATE (BYPASSED PER USER REQUEST) ---
    // We used to skip if mc > 50k, now we skip ONLY if it's a completely invalid trigger.
    let mut entry_mc_raw = payload.entry_market_cap;

    // If MC is missing from trigger, wait 1s for the Watcher to update Redis
    if entry_mc_raw.is_none() {
        sleep(Duration::from_secs(1)).await;
        if let Some(mc) = fetch_price_redis(&mut redis_conn, &trade.mint).await {
            entry_mc_raw = Some(mc);
        }
    }

    // 1. ENTRY — Use real price from Redis (PumpPortal cache)
    // FIX: Standardize to SOL Market Cap (PumpPortal native units)
    let sol_usd_rate = 145.0; // For Shyft USD -> SOL conversion fallback
    
    let entry_mc = if let Some(mc) = entry_mc_raw {
        println!("📊 [ASSASSIN] Entry MC (SOL): {:.2} SOL", mc);
        mc
    } else if let Some(mc_usd) = fetch_price_shyft(&http_client, &trade.mint, &shyft_keys, &shyft_key_idx).await {
        let mc_sol = mc_usd / sol_usd_rate;
        println!("📊 [ASSASSIN] Entry MC from Shyft (Converted USD->SOL): {:.2} SOL", mc_sol);
        mc_sol
    } else {
        println!("⚠️ [ASSASSIN] No live price available, entering blindly at 1.0 SOL MC for {}", trade.mint);
        1.0 // Minimal dummy value to allow entry
    };

    if entry_mc <= 0.0 {
        println!("🛑 [ASSASSIN] Skipping {} — Final Entry Market Cap is 0.00 SOL (Danger).", trade.mint);
        let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
        return;
    }

    let entry_price = entry_mc / 1_000_000_000.0;
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => { 
            println!("❌ DB Pool Error: {}", e); 
            let _: () = redis_conn.del(&lock_key).await.unwrap_or(()); // Release lock
            return; 
        }
    };

    // --- PRE-ENTRY LOSER CHECK (DEACTIVATED PER USER REQUEST) ---
    // We are copy trading wallets on paper; we want to see it all.

    // Atomic Balance Check & Deduction (Entry + Fee)
    let total_cost = trade.entry_sol + TRANSACTION_FEE;
    let res = client.execute(
        "UPDATE paper_wallets SET balance_sol = balance_sol - $1 WHERE wallet_address = 'COPY_TRADE_MAIN_WAREHOUSE' AND balance_sol >= $1",
        &[&total_cost]
    ).await;

    if let Ok(rows) = res {
        if rows == 0 {
            println!("⚠️ [ASSASSIN] Insufficient Funds for {}", trade.mint);
            let _: () = redis_conn.del(&lock_key).await.unwrap_or(()); // Release lock
            return;
        }
    } else {
        let _: () = redis_conn.del(&lock_key).await.unwrap_or(()); // Release lock
        return;
    }

    // Log Entry to DB
    let _ = client.execute(
        "INSERT INTO copy_trade_trades (token_mint, copy_trade_address, funding_source, entry_price, entry_sol_amount, status) 
         VALUES ($1, $2, $3, $4, $5, 'OPEN')",
        &[&trade.mint, &trade.copy_trade_address, &trade.funding_source, &entry_price, &trade.entry_sol]
    ).await;

    println!("✅ [ASSASSIN] Entered {} at price {:.12} SOL", trade.mint, entry_price);

    // Register this mint as an "active snipe" for real-time price monitoring
    let _: () = redis_conn.sadd("active_snipes", &trade.mint).await.unwrap_or(());

    // --- PHASE 3: DYNAMIC TP/SL & TTL MONITORING (REAL PRICE) ---
    let mut current_price = entry_price;
    let mut pnl_pct = 0.0;
    let mut held_seconds = 0;
    let max_hold_seconds = 600; // Increased to 10m based on audit
    let mut price_source = "INIT";

    println!("🕒 [ASSASSIN] Monitoring {} for +40% TP / -15% SL (REAL PRICES)...", trade.mint);

    while held_seconds < max_hold_seconds {
        // --- HYBRID PRICE FEED ---
        // Primary: Redis (PumpPortal cached MC in SOL, sub-ms)
        if let Some(mc) = fetch_price_redis(&mut redis_conn, &trade.mint).await {
            current_price = mc / 1_000_000_000.0;
            price_source = "REDIS";
        }
        // Fallback: Shyft API (immediately on first iteration, then every 5s)
        else if held_seconds == 0 || held_seconds % 5 == 0 {
            if let Some(mc_usd) = fetch_price_shyft(&http_client, &trade.mint, &shyft_keys, &shyft_key_idx).await {
                let mc_sol = mc_usd / sol_usd_rate;
                current_price = mc_sol / 1_000_000_000.0;
                price_source = "SHYFT";
            }
        }
        
        let gross_pnl_pct = ((current_price - entry_price) / entry_price) * 100.0;
        let fee_impact_pct = (TRANSACTION_FEE / trade.entry_sol) * 100.0;
        pnl_pct = gross_pnl_pct - fee_impact_pct;

        println!("[DEBUG] {} | Entry MC: {:.2} SOL | Curr MC: {:.2} SOL | PnL: {:.2}% [src:{}]", 
                 trade.mint, entry_mc, current_price * 1_000_000_000.0, pnl_pct, price_source);

        // Live PnL update to DB so the dashboard can track OPEN positions
        // We force update even if price hasn't moved to show the "pulse" on the dashboard
        let _ = client.execute(
            "UPDATE copy_trade_trades SET pnl_percentage = $1 WHERE token_mint = $2 AND status = 'OPEN'",
            &[&pnl_pct, &trade.mint]
        ).await;

        // Check TP/SL
        if pnl_pct >= 40.0 {
            println!("🔥 [ASSASSIN] TP HIT (+{:.2}%) for {} [src:{}]", pnl_pct, trade.mint, price_source);
            break;
        } else if pnl_pct <= -15.0 {
            println!("🛑 [ASSASSIN] SL HIT ({:.2}%) for {} [src:{}]", pnl_pct, trade.mint, price_source);
            break;
        }

        // --- PHASE 4: EXIT SYNC (ELITE WALLET SELL) ---
        let exit_key = format!("exit_signal:{}:{}", trade.mint, trade.copy_trade_address);
        if let Ok(exists) = redis_conn.exists::<_, bool>(&exit_key).await {
            if exists {
                println!("👋 [ASSASSIN] Copying Exit signal for {} from wallet {}", trade.mint, trade.copy_trade_address);
                break;
            }
        }

        sleep(Duration::from_secs(1)).await;
        held_seconds += 1;
    }

    if held_seconds >= max_hold_seconds {
        println!("⏳ [ASSASSIN] 60s Hard-TTL Hit for {}", trade.mint);
    }

    // 3. EXIT (Simulated Market Sell)
    let exit_price = current_price;
    
    let _ = client.execute(
        "UPDATE copy_trade_trades SET exit_price = $1, exit_timestamp = NOW(), pnl_percentage = $2, status = 'CLOSED' 
         WHERE token_mint = $3 AND copy_trade_address = $4 AND status = 'OPEN'",
        &[&exit_price, &pnl_pct, &trade.mint, &trade.copy_trade_address]
    ).await;

    // Credit Wallet
    let mut final_balance_credit = trade.entry_sol * (1.0 + (pnl_pct / 100.0));
    if final_balance_credit < 0.0 { final_balance_credit = 0.0; } // Can't have negative balance

    let _ = client.execute(
        "UPDATE paper_wallets SET balance_sol = balance_sol + $1 WHERE wallet_address = 'COPY_TRADE_MAIN_WAREHOUSE'",
        &[&final_balance_credit]
    ).await;

    println!("🏁 [ASSASSIN] Position Closed: {} | PnL: {:.2}%", trade.mint, pnl_pct);

    // --- PHASE 5: ONE-STRIKE BLACKLIST (DEACTIVATED PER USER REQUEST) ---

    // Clean up Redis lock and active snipe registration
    let _: () = redis_conn.srem("active_snipes", &trade.mint).await.unwrap_or(());
    let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
}

use futures_util::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();
    env_logger::init();
    println!("🚀 Starting COPY_TRADE SNIPER (The Assassin) — REAL PRICE MODE");

    // Shyft API Key Pool
    let shyft_keys: Arc<Vec<String>> = Arc::new(
        env::var("SHYFT_API_KEYS")
            .unwrap_or_default()
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    );
    let shyft_key_idx = Arc::new(AtomicUsize::new(0));
    println!("🔑 [ASSASSIN] Loaded {} Shyft API keys for fallback", shyft_keys.len());

    // Shared HTTP client for Shyft calls
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;

    // DB Setup
    let mut cfg = Config::new();
    cfg.host = Some(env::var("POSTGRES_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()));
    cfg.port = Some(env::var("POSTGRES_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(5432));
    cfg.user = Some(env::var("POSTGRES_USER").unwrap_or_else(|_| "copy_trade_user".to_string()));
    cfg.password = Some(env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "copy_trade_password".to_string()));
    cfg.dbname = Some(env::var("POSTGRES_DB").unwrap_or_else(|_| "copy_trade_db".to_string()));
    let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;

    // Redis Setup
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6381".to_string());
    let client = redis::Client::open(redis_url)?;
    
    // --- RECONCILIATION PHASE ---
    println!("🧹 [ASSASSIN] Reconciling orphaned trades...");
    if let Ok(db_client) = pool.get().await {
        let _ = db_client.execute(
            "UPDATE copy_trade_trades SET status = 'CLOSED', exit_timestamp = NOW(), pnl_percentage = 0 
             WHERE status = 'OPEN'",
            &[]
        ).await;
    }

    let mut redis_conn = client.get_async_connection().await?;
    let mut pubsub = redis_conn.into_pubsub();
    pubsub.subscribe("copy_trade_triggers").await?;

    let mut stream = pubsub.on_message();
    println!("🕵️ [ASSASSIN] Waiting for triggers...");
    
    let mut heartbeat_interval = tokio::time::interval(Duration::from_secs(60));
    
    loop {
        tokio::select! {
            _ = heartbeat_interval.tick() => {
                println!("[ASSASSIN] Standing by... Waiting for triggers.");
            }
            msg = stream.next() => {
                let msg = match msg {
                    Some(m) => m,
                    None => break,
                };
                
                let payload_str: String = match msg.get_payload() {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                
                if let Ok(payload) = serde_json::from_str::<TriggerPayload>(&payload_str) {
                    if let Ok(redis_conn) = client.get_async_connection().await {
                        let thread_pool = pool.clone();
                        let thread_http = http_client.clone();
                        let thread_keys = shyft_keys.clone();
                        let thread_idx = shyft_key_idx.clone();
                        tokio::spawn(async move {
                            execute_trade(thread_pool, redis_conn, payload, thread_http, thread_keys, thread_idx).await;
                        });
                    }
                }
            }
        }
    }

    Ok(())
}
