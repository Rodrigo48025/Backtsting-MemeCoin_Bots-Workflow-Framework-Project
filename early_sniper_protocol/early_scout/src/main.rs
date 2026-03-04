use dotenv;
use std::env;
use std::collections::HashMap;
use std::sync::Arc;
use redis::AsyncCommands;
use std::time::{Duration, Instant};
use tokio::time::sleep;
use tokio::sync::Mutex;
use serde::Serialize;
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;

#[derive(Serialize)]
struct EarlyTrigger {
    mint: String,
    mc_sol: f64,
}

#[derive(Debug, Clone)]
struct PendingToken {
    mint: String,
    initial_mc: f64,
    current_mc: f64,
    buy_count: u32,
    created_at: Instant,
}

// ═══════════════════════════════════════════════════════════
// FILTER CONFIGURATION — Tune these to adjust selectivity
// ═══════════════════════════════════════════════════════════
const OBSERVATION_WINDOW_SECS: u64 = 15;   // Watch for 15s after creation
const MIN_BUY_COUNT: u32 = 3;              // At least 3 buy transactions
const MIN_MC_GROWTH_PCT: f64 = 30.0;       // MC must grow at least 30%

async fn run_early_scout() -> Result<(), Box<dyn std::error::Error>> {
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let redis_client = redis::Client::open(redis_url)?;
    let _redis_conn = redis_client.get_multiplexed_async_connection().await?;

    let wss_url = "wss://pumpportal.fun/api/data";
    println!("🔌 [EARLY-SCOUT] Connecting to PumpPortal WSS...");
    let (ws_stream, _) = connect_async(Url::parse(wss_url).unwrap()).await?;
    let (write, mut read) = ws_stream.split();
    let write = Arc::new(Mutex::new(write));

    // Subscribe to new token creation events
    let sub_new = serde_json::json!({ "method": "subscribeNewToken" });
    write.lock().await.send(Message::Text(sub_new.to_string())).await?;
    println!("📡 [EARLY-SCOUT] Subscribed to Token Creation Feed.");
    println!("🔬 [EARLY-SCOUT] Bonding Curve Filter ACTIVE: {}s window | {}+ buys | {}%+ MC growth",
        OBSERVATION_WINDOW_SECS, MIN_BUY_COUNT, MIN_MC_GROWTH_PCT);

    // Track pending tokens being observed
    let pending: Arc<Mutex<HashMap<String, PendingToken>>> = Arc::new(Mutex::new(HashMap::new()));

    // Spawn the evaluation loop (checks pending tokens every second)
    let eval_pending = pending.clone();
    let eval_redis = redis_client.get_multiplexed_async_connection().await?;
    tokio::spawn(async move {
        evaluate_pending_tokens(eval_pending, eval_redis).await;
    });

    // Main websocket message loop
    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    let tx_type = value["txType"].as_str().unwrap_or("");

                    // ── CREATE EVENT: Add to watchlist ──
                    if tx_type == "create" {
                        if let (Some(mint), Some(mc)) = (value["mint"].as_str(), value["marketCapSol"].as_f64()) {
                            let short_mint = if mint.len() >= 8 { &mint[..8] } else { mint };
                            println!("👀 [EARLY-SCOUT] New token: {} | MC: {:.2} SOL → Observing {}s...",
                                short_mint, mc, OBSERVATION_WINDOW_SECS);

                            let token = PendingToken {
                                mint: mint.to_string(),
                                initial_mc: mc,
                                current_mc: mc,
                                buy_count: 0,
                                created_at: Instant::now(),
                            };

                            pending.lock().await.insert(mint.to_string(), token);

                            // Subscribe to trade events for this specific token
                            let sub_trades = serde_json::json!({
                                "method": "subscribeTokenTrade",
                                "keys": [mint]
                            });
                            let _ = write.lock().await.send(Message::Text(sub_trades.to_string())).await;
                        }
                    }
                    // ── BUY EVENT: Update pending token stats ──
                    else if tx_type == "buy" {
                        if let Some(mint) = value["mint"].as_str() {
                            let mut map = pending.lock().await;
                            if let Some(token) = map.get_mut(mint) {
                                token.buy_count += 1;
                                if let Some(mc) = value["marketCapSol"].as_f64() {
                                    token.current_mc = mc;
                                }
                            }
                        }
                    }
                }
            }
            Ok(Message::Ping(p)) => {
                let _ = write.lock().await.send(Message::Pong(p)).await;
            }
            Err(e) => return Err(e.into()),
            _ => {}
        }
    }
    Ok(())
}

async fn evaluate_pending_tokens(
    pending: Arc<Mutex<HashMap<String, PendingToken>>>,
    mut redis_conn: redis::aio::MultiplexedConnection,
) {
    let mut passed_count: u64 = 0;
    let mut filtered_count: u64 = 0;

    loop {
        sleep(Duration::from_secs(1)).await;

        let now = Instant::now();
        let mut to_trigger: Vec<PendingToken> = Vec::new();
        let mut to_remove: Vec<String> = Vec::new();

        {
            let map = pending.lock().await;
            for (mint, token) in map.iter() {
                let elapsed = now.duration_since(token.created_at).as_secs();

                if elapsed >= OBSERVATION_WINDOW_SECS {
                    let mc_growth = if token.initial_mc > 0.0 {
                        ((token.current_mc - token.initial_mc) / token.initial_mc) * 100.0
                    } else {
                        0.0
                    };

                    let short_mint = if mint.len() >= 8 { &mint[..8] } else { mint };

                    if token.buy_count >= MIN_BUY_COUNT && mc_growth >= MIN_MC_GROWTH_PCT {
                        println!("✅ [EARLY-SCOUT] FILTER PASSED: {} | Buys: {} | MC: {:.2} → {:.2} SOL (+{:.1}%)",
                            short_mint, token.buy_count, token.initial_mc, token.current_mc, mc_growth);
                        to_trigger.push(token.clone());
                    } else {
                        println!("❌ [EARLY-SCOUT] FILTERED OUT: {} | Buys: {} | MC Growth: {:.1}%",
                            short_mint, token.buy_count, mc_growth);
                    }

                    to_remove.push(mint.clone());
                }
            }
        }

        // Remove evaluated tokens from the watchlist
        if !to_remove.is_empty() {
            let mut map = pending.lock().await;
            for mint in &to_remove {
                map.remove(mint);
            }
        }

        let triggered_count = to_trigger.len() as u64;

        // Trigger the Sniper for approved tokens
        for token in to_trigger {
            let trigger = EarlyTrigger {
                mint: token.mint.clone(),
                mc_sol: token.current_mc,
            };
            let payload = serde_json::to_string(&trigger).unwrap_or_default();

            // 1. Trigger the Sniper via pub/sub
            let _: () = redis_conn.publish("early_triggers", &payload).await.unwrap_or(());

            // 2. Cache for Dashboard display
            let _: () = redis_conn.lpush("early_recent_triggers", &payload).await.unwrap_or(());
            let _: () = redis_conn.ltrim("early_recent_triggers", 0, 19).await.unwrap_or(());

            // 3. Set initial price for PnL tracking
            let price_data = serde_json::json!({ "mc": token.current_mc, "v_sol": 0.0 });
            let _: () = redis_conn.set_ex(
                format!("price:{}", token.mint),
                price_data.to_string(),
                600
            ).await.unwrap_or(());

            passed_count += 1;
        }

        filtered_count += to_remove.len() as u64 - triggered_count;

        // Periodic stats (every 50 evaluations)
        let total = passed_count + filtered_count;
        if total > 0 && total % 50 == 0 {
            let pass_rate = (passed_count as f64 / total as f64) * 100.0;
            println!("📊 [EARLY-SCOUT] Filter Stats: {}/{} passed ({:.1}% pass rate)",
                passed_count, total, pass_rate);
        }
    }
}


#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    println!("🚀 [EARLY-SCOUT] Bot 6 Trenches Monitor Online");
    println!("🔬 [EARLY-SCOUT] Bonding Curve Filter v1.0");
    loop {
        if let Err(e) = run_early_scout().await {
            println!("❌ [EARLY-SCOUT] Error: {}. Reconnecting in 5s...", e);
            sleep(Duration::from_secs(5)).await;
        }
    }
}
