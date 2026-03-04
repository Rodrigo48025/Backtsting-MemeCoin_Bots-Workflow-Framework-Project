use dotenv;
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;
use serde::{Deserialize, Serialize};
use std::env;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::sleep;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Deserialize)]
struct PumpPortalTrade {
    #[serde(rename = "traderPublicKey")]
    trader: String,
    mint: String,
    #[serde(rename = "vSolInBondingCurve")]
    v_sol: Option<f64>,
    #[serde(rename = "usdMarketCap")]
    usd_market_cap: Option<f64>,
}

#[derive(Serialize)]
struct ForensicRequest {
    mint: String,
    trader: String,
    market_cap: f64,
    v_sol: f64,
}

async fn run_watcher() -> Result<(), Box<dyn std::error::Error>> {
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let client = redis::Client::open(redis_url)?;
    let mut redis_conn = client.get_multiplexed_async_connection().await?;
    
    let wss_url = "wss://pumpportal.fun/api/data";
    println!("🔌 [WATCHER] Connecting to PumpPortal Trade Stream...");
    let (ws_stream, _) = connect_async(Url::parse(wss_url)?).await?;
    let (mut write, mut read) = ws_stream.split();

    // Subscribe to new token creations
    let subscribe_msg2 = serde_json::json!({ "method": "subscribeNewToken" });
    write.send(Message::Text(subscribe_msg2.to_string())).await?;
    println!("📡 [WATCHER] Tracking New Tokens & Dynamic Active Snipes (DexScreener)...");

    let mut slot_counts: HashMap<String, u32> = HashMap::new();
    let mut interval = tokio::time::interval(Duration::from_secs(2));
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;

    loop {
        tokio::select! {
            _ = interval.tick() => {
                // Poll Redis for tokens the Sniper is currently holding
                if let Ok(mints) = redis_conn.smembers::<_, Vec<String>>("active_snipes").await {
                    for mint in mints {
                        // Poll DexScreener for real-time price/MC
                        let url = format!("https://api.dexscreener.com/tokens/v1/solana/{}", mint);
                        if let Ok(resp) = http_client.get(url).send().await {
                            if let Ok(json) = resp.json::<serde_json::Value>().await {
                                if let Some(pairs) = json.as_array() {
                                    if let Some(pair) = pairs.first() {
                                        if let Some(mc) = pair["marketCap"].as_f64() {
                                            if mc > 0.0 {
                                                let price_data = serde_json::json!({
                                                    "mc": mc,
                                                    "v_sol": 0.0 // DexScreener doesn't provide v_sol directly in this endpoint
                                                });
                                                let _: () = redis_conn.set_ex(
                                                    format!("price:{}", mint),
                                                    price_data.to_string(),
                                                    30
                                                ).await.unwrap_or(());
                                                println!("📊 [WATCHER] Price Sync for {}: ${:.2} MC", mint, mc);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            msg = read.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    _ => break,
                };
                if let Message::Text(text) = msg {
                    // First attempt to parse as Trade
                    if let Ok(trade) = serde_json::from_str::<PumpPortalTrade>(&text) {
                        if trade.v_sol.unwrap_or(0.0) < 0.05 {
                            continue;
                        }

                        if slot_counts.len() > 100_000 {
                            println!("🧹 [WATCHER] Clearing state to prevent OOM...");
                            slot_counts.clear();
                        }

                        let count = slot_counts.entry(trade.mint.clone()).or_insert(0);
                        *count += 1;

                        if *count <= 20 {
                            println!("🔎 [WATCHER] Mint {} - Buyer Slot #{}: {}", trade.mint, *count, trade.trader);
                            
                            let req = ForensicRequest {
                                mint: trade.mint.clone(),
                                trader: trade.trader.clone(),
                                market_cap: trade.usd_market_cap.unwrap_or(0.0),
                                v_sol: trade.v_sol.unwrap_or(0.0),
                            };

                            let req_str = serde_json::to_string(&req)?;
                            let _: () = redis_conn.lpush("insider_forensics", req_str).await?;
                        }

                        // Cache latest market cap if seen in the stream (PumpPortal fallback)
                        if let Some(mc) = trade.usd_market_cap {
                            if mc > 0.0 {
                                let price_data = serde_json::json!({
                                    "mc": mc,
                                    "v_sol": trade.v_sol.unwrap_or(0.0)
                                });
                                let _: () = redis_conn.set_ex(
                                    format!("price:{}", trade.mint),
                                    price_data.to_string(),
                                    30 
                                ).await.unwrap_or(());
                            }
                        }
                    }
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
    println!("🚀 Starting INSIDER WATCHER (The Tracker)...");

    let mut backoff = 1;
    let max_backoff = 30;

    loop {
        if let Err(e) = run_watcher().await {
            println!("❌ Watcher Crashed: {}. Reconnecting in {}s...", e, backoff);
            sleep(Duration::from_secs(backoff)).await;
            backoff = (backoff * 2).min(max_backoff);
        } else {
            backoff = 1;
        }
    }
}
