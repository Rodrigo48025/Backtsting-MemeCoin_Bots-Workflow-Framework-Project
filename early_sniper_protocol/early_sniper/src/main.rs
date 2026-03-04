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
use futures_util::StreamExt;

#[derive(Debug, Deserialize)]
struct EarlyTrigger {
    mint: String,
    mc_sol: f64,
}

const TRANSACTION_FEE: f64 = 0.0001;
const ENTRY_AMOUNT: f64 = 0.1;
const TAKE_PROFIT: f64 = 50.0;
const STOP_LOSS: f64 = -25.0;
const TIME_STOP_SECONDS: i64 = 600; // 10 minutes

async fn fetch_price_redis(redis_conn: &mut redis::aio::Connection, mint: &str) -> Option<f64> {
    let raw: Option<String> = redis_conn.get(format!("price:{}", mint)).await.ok()?;
    let val = raw?;
    let json: serde_json::Value = serde_json::from_str(&val).ok()?;
    let mc = json["mc"].as_f64()?;
    if mc > 0.0 { Some(mc) } else { None }
}

async fn execute_early_snipe(pool: Pool, mut redis_conn: redis::aio::Connection, trigger: EarlyTrigger) {
    let mint = trigger.mint.clone();
    let lock_key = format!("early_pos:{}", mint);
    
    let acquired: Option<String> = redis::cmd("SET").arg(&lock_key).arg("1").arg("NX").arg("EX").arg(1200).query_async(&mut redis_conn).await.unwrap_or(None);
    if acquired.is_none() { return; }

    println!("🎯 [EARLY-SNIPER] Entry Triggered for {}", &mint[..8]);

    let entry_mc = trigger.mc_sol;
    let entry_price = entry_mc / 1_000_000_000.0;
    
    let client = match pool.get().await { Ok(c) => c, Err(_) => { let _: () = redis_conn.del(&lock_key).await.unwrap_or(()); return; } };

    // Atomic Balance Check
    let total_cost = ENTRY_AMOUNT + TRANSACTION_FEE;
    let res = client.execute("UPDATE paper_wallets SET balance_sol = balance_sol - $1 WHERE wallet_address = 'EARLY_MAIN_WAREHOUSE' AND balance_sol >= $1", &[&total_cost]).await;

    if let Ok(rows) = res { if rows == 0 { println!("⚠️ [EARLY-SNIPER] No Funds for {}", &mint[..8]); let _: () = redis_conn.del(&lock_key).await.unwrap_or(()); return; }
    } else { let _: () = redis_conn.del(&lock_key).await.unwrap_or(()); return; }

    // Log Entry
    let _ = client.execute(
        "INSERT INTO insider_trades (token_mint, insider_address, funding_source, entry_price, entry_sol_amount, status, entry_timestamp) 
         VALUES ($1, 'EARLY_SNIPER', 'BOT_6', $2, $3, 'OPEN', NOW())
         ON CONFLICT (token_mint, insider_address) DO UPDATE SET status = 'OPEN', entry_price = $2, entry_sol_amount = $3, entry_timestamp = NOW(), pnl_percentage = 0.0",
        &[&mint, &entry_price, &ENTRY_AMOUNT]
    ).await;

    println!("✅ [EARLY-SNIPER] Entered {} at price {:.10}", &mint[..8], entry_price);
    let _: () = redis_conn.sadd("active_early_snipes", &mint).await.unwrap_or(());

    // MONITORING
    let start_time = Utc::now();
    let mut current_price = entry_price;
    let mut pnl_pct = 0.0;

    loop {
        sleep(Duration::from_secs(5)).await;
        
        if let Some(mc) = fetch_price_redis(&mut redis_conn, &mint).await {
            current_price = mc / 1_000_000_000.0;
        }

        pnl_pct = ((current_price - entry_price) / entry_price) * 100.0 - ((TRANSACTION_FEE / ENTRY_AMOUNT) * 100.0);

        let _ = client.execute("UPDATE insider_trades SET pnl_percentage = $1 WHERE token_mint = $2 AND status = 'OPEN'", &[&pnl_pct, &mint]).await;

        let elapsed = Utc::now().signed_duration_since(start_time).num_seconds();

        if pnl_pct >= TAKE_PROFIT {
            println!("🔥 [EARLY-SNIPER] TP HIT (+{:.2}%) for {}", pnl_pct, &mint[..8]);
            break;
        } else if pnl_pct <= STOP_LOSS {
            println!("🛑 [EARLY-SNIPER] SL HIT ({:.2}%) for {}", pnl_pct, &mint[..8]);
            break;
        } else if elapsed >= TIME_STOP_SECONDS {
            println!("⏰ [EARLY-SNIPER] TIME-STOP HIT ({:.2}%) for {}", pnl_pct, &mint[..8]);
            break;
        }
    }

    // EXIT
    let _ = client.execute("UPDATE insider_trades SET exit_price = $1, exit_timestamp = NOW(), pnl_percentage = $2, status = 'CLOSED' WHERE token_mint = $3 AND status = 'OPEN'", &[&current_price, &pnl_pct, &mint]).await;
    
    let mut credit = ENTRY_AMOUNT * (1.0 + (pnl_pct / 100.0));
    if credit < 0.0 { credit = 0.0; }
    let _ = client.execute("UPDATE paper_wallets SET balance_sol = balance_sol + $1 WHERE wallet_address = 'EARLY_MAIN_WAREHOUSE'", &[&credit]).await;

    println!("🏁 [EARLY-SNIPER] Closed {}: PnL {:.2}%", &mint[..8], pnl_pct);
    let _: () = redis_conn.srem("active_early_snipes", &mint).await.unwrap_or(());
    let _: () = redis_conn.del(&lock_key).await.unwrap_or(());
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();
    println!("🚀 [EARLY-SNIPER] Execution Engine Online");

    let mut cfg = Config::new();
    cfg.host = Some(env::var("POSTGRES_HOST").unwrap_or_else(|_| "early_db".to_string()));
    cfg.user = Some(env::var("POSTGRES_USER").unwrap_or_else(|_| "early_user".to_string()));
    cfg.password = Some(env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "early_password".to_string()));
    cfg.dbname = Some(env::var("POSTGRES_DB").unwrap_or_else(|_| "early_db".to_string()));
    let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;

    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let client = redis::Client::open(redis_url)?;
    let mut redis_conn = client.get_async_connection().await?;
    let mut pubsub = redis_conn.into_pubsub();
    pubsub.subscribe("early_triggers").await?;

    let mut stream = pubsub.on_message();
    while let Some(msg) = stream.next().await {
        let payload: String = msg.get_payload().unwrap_or_default();
        if let Ok(trigger) = serde_json::from_str::<EarlyTrigger>(&payload) {
            let thread_pool = pool.clone();
            let thread_conn = client.get_async_connection().await?;
            tokio::spawn(async move { execute_early_snipe(thread_pool, thread_conn, trigger).await; });
        }
    }
    Ok(())
}
