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
struct VolTrigger {
    mint: String,
    ratio: f64,
    current_vol: f64,
    prev_vol: f64,
    mc_sol: f64,
}

struct Trade {
    mint: String,
    entry_sol: f64,
}

const TRANSACTION_FEE: f64 = 0.0001; 

// --- REAL PRICE FEED FUNCTIONS ---

async fn fetch_price_redis(redis_conn: &mut redis::aio::Connection, mint: &str) -> Option<f64> {
    let raw: Option<String> = redis_conn.get(format!("price:{}", mint)).await.ok()?;
    let val = raw?;
    let json: serde_json::Value = serde_json::from_str(&val).ok()?;
    let mc = json["mc"].as_f64()?;
    if mc > 0.0 { Some(mc) } else { None }
}

async fn fetch_price_shyft(
    http_client: &reqwest::Client,
    mint: &str,
    keys: &[String],
    key_idx: &AtomicUsize,
) -> Option<f64> {
    if keys.is_empty() { return None; }
    let idx = key_idx.fetch_add(1, Ordering::Relaxed);
    let key = &keys[idx % keys.len()];
    
    let resp = http_client
        .get(format!("https://defi.shyft.to/v0/pools/get_by_token?token={}", mint))
        .header("x-api-key", key.as_str())
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .ok()?;
    
    let json: serde_json::Value = resp.json().await.ok()?;
    
    if let Some(pools) = json["result"]["pools"].as_array() {
        if let Some(pool) = pools.first() {
            if let Some(mc) = pool["stats"]["market_cap_usd"].as_f64() {
                if mc > 0.0 { return Some(mc); }
            }
            if let Some(price) = pool["stats"]["base_token_price_usd"].as_f64() {
                if price > 0.0 {
                    return Some(price * 1_000_000_000.0);
                }
            }
        }
    }
    None
}

async fn execute_trade(
    pool: Pool,
    mut redis_conn: redis::aio::Connection,
    trigger: VolTrigger,
    http_client: reqwest::Client,
    shyft_keys: Arc<Vec<String>>,
    shyft_key_idx: Arc<AtomicUsize>,
) {
    let trade = Trade {
        mint: trigger.mint.clone(),
        entry_sol: 0.1, 
    };

    println!("🎯 [VOL-SNIPER] Trigger Received for {} (Ratio: {:.2}x)", trade.mint, trigger.ratio);

    // DEDUPLICATION
    let lock_key = format!("vol_pos:{}", trade.mint);
    let acquired: Option<String> = redis::cmd("SET")
        .arg(&lock_key)
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg(1800)
        .query_async(&mut redis_conn)
        .await
        .unwrap_or(None);

    if acquired.is_none() {
        println!("⏭️  [VOL-SNIPER] Skipping {} — Position already active.", trade.mint);
        return;
    }

    // 1. ENTRY
    let from_redis = fetch_price_redis(&mut redis_conn, &trade.mint).await;
    let entry_mc = if let Some(mc) = from_redis {
        println!("DEBUG-PRICE: Found {} in Redis: {}", trade.mint, mc);
        mc
    } else {
        println!("DEBUG-PRICE: Using Trigger MC for {}: {}", trade.mint, trigger.mc_sol);
        trigger.mc_sol
    };

    if entry_mc <= 0.0 {
        let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
        return;
    }

    let entry_price = entry_mc / 1_000_000_000.0;
    println!("DEBUG-PRICE: Calculated Entry Price for {}: {:.10}", trade.mint, entry_price);
    let client = match pool.get().await {
        Ok(c) => c,
        Err(_) => { 
            let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
            return; 
        }
    };

    // Atomic Balance Check
    let total_cost = trade.entry_sol + TRANSACTION_FEE;
    let res = client.execute(
        "UPDATE paper_wallets SET balance_sol = balance_sol - $1 WHERE wallet_address = 'VOLUME_MAIN_WAREHOUSE' AND balance_sol >= $1",
        &[&total_cost]
    ).await;

    if let Ok(rows) = res {
        if rows == 0 {
            println!("⚠️ [VOL-SNIPER] Insufficient Funds for {}", trade.mint);
            let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
            return;
        }
    } else {
        let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
        return;
    }

    // Log Entry - Use ON CONFLICT to allow re-entries or updates to existing dashboard records
    let insert_res = client.execute(
        "INSERT INTO insider_trades (token_mint, insider_address, funding_source, entry_price, entry_sol_amount, status, entry_timestamp) 
         VALUES ($1, 'VOLUME_PROTOCOL', 'VOL_ACCEL', $2, $3, 'OPEN', NOW())
         ON CONFLICT (token_mint, insider_address) DO UPDATE 
         SET status = 'OPEN', entry_price = $2, entry_sol_amount = $3, entry_timestamp = NOW(), pnl_percentage = 0.0, exit_price = NULL, exit_timestamp = NULL",
        &[&trade.mint, &entry_price, &trade.entry_sol]
    ).await;

    if let Err(e) = insert_res {
        println!("❌ [VOL-SNIPER] Database Insert Error for {}: {}", trade.mint, e);
        // Refund if insert fails
        let _ = client.execute(
            "UPDATE paper_wallets SET balance_sol = balance_sol + $1 WHERE wallet_address = 'VOLUME_MAIN_WAREHOUSE'",
            &[&total_cost]
        ).await;
        let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
        return;
    }

    println!("✅ [VOL-SNIPER] Entered {} at price {:.8}", trade.mint, entry_price);
    let _: () = redis_conn.sadd("active_snipes", &trade.mint).await.unwrap_or(());

    // MONITORING
    let mut current_price = entry_price;
    let mut pnl_pct = 0.0;
    let mut held_seconds = 0;
    let max_hold_seconds = 900; // 15 min Max-TTL

    while held_seconds < max_hold_seconds {
        sleep(Duration::from_secs(5)).await;
        held_seconds += 5;

        if let Some(mc) = fetch_price_redis(&mut redis_conn, &trade.mint).await {
            current_price = mc / 1_000_000_000.0;
        }
        
        let gross_pnl_pct = ((current_price - entry_price) / entry_price) * 100.0;
        let fee_impact_pct = (TRANSACTION_FEE / trade.entry_sol) * 100.0;
        pnl_pct = gross_pnl_pct - fee_impact_pct;

        let _ = client.execute(
            "UPDATE insider_trades SET pnl_percentage = $1 WHERE token_mint = $2 AND status = 'OPEN'",
            &[&pnl_pct, &trade.mint]
        ).await;

        if pnl_pct >= 60.0 {
            println!("🔥 [VOL-SNIPER] TP HIT (+{:.2}%) for {}", pnl_pct, trade.mint);
            break;
        } else if pnl_pct <= -25.0 {
            println!("🛑 [VOL-SNIPER] SL HIT ({:.2}%) for {}", pnl_pct, trade.mint);
            break;
        }
    }

    // EXIT
    let exit_price = current_price;
    let _ = client.execute(
        "UPDATE insider_trades SET exit_price = $1, exit_timestamp = NOW(), pnl_percentage = $2, status = 'CLOSED' 
         WHERE token_mint = $3 AND status = 'OPEN'",
        &[&exit_price, &pnl_pct, &trade.mint]
    ).await;

    let mut final_balance_credit = trade.entry_sol * (1.0 + (pnl_pct / 100.0));
    if final_balance_credit < 0.0 { final_balance_credit = 0.0; }

    let _ = client.execute(
        "UPDATE paper_wallets SET balance_sol = balance_sol + $1 WHERE wallet_address = 'VOLUME_MAIN_WAREHOUSE'",
        &[&final_balance_credit]
    ).await;

    println!("🏁 [VOL-SNIPER] Position Closed: {} | PnL: {:.2}%", trade.mint, pnl_pct);
    let _: () = redis_conn.srem("active_snipes", &trade.mint).await.unwrap_or(());
    let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
}

use futures_util::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();
    env_logger::init();
    println!("🚀 [VOLUME-SNIPER] Momentum Assassin Online");

    let shyft_keys: Arc<Vec<String>> = Arc::new(
        env::var("SHYFT_API_KEYS").unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect()
    );
    let shyft_key_idx = Arc::new(AtomicUsize::new(0));
    let http_client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?;

    let mut cfg = Config::new();
    cfg.host = Some(env::var("POSTGRES_HOST").unwrap_or_else(|_| "localhost".to_string()));
    cfg.user = Some(env::var("POSTGRES_USER").unwrap_or_else(|_| "insider_user".to_string()));
    cfg.password = Some(env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "insider_password".to_string()));
    cfg.dbname = Some(env::var("POSTGRES_DB").unwrap_or_else(|_| "insider_db".to_string()));
    let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;

    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let client = redis::Client::open(redis_url)?;

    let mut redis_conn = client.get_async_connection().await?;
    let mut pubsub = redis_conn.into_pubsub();
    pubsub.subscribe("volume_triggers").await?;

    let mut stream = pubsub.on_message();
    println!("🕵️ [VOL-SNIPER] Waiting for volume bursts...");
    
    while let Some(msg) = stream.next().await {
        let payload_str: String = match msg.get_payload() {
            Ok(s) => s,
            Err(_) => continue,
        };
        
        if let Ok(trigger) = serde_json::from_str::<VolTrigger>(&payload_str) {
            if let Ok(redis_conn) = client.get_async_connection().await {
                let thread_pool = pool.clone();
                let thread_http = http_client.clone();
                let thread_keys = shyft_keys.clone();
                let thread_idx = shyft_key_idx.clone();
                tokio::spawn(async move {
                    execute_trade(thread_pool, redis_conn, trigger, thread_http, thread_keys, thread_idx).await;
                });
            }
        }
    }

    Ok(())
}
