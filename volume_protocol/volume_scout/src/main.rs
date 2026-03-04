use dotenv;
use std::env;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::{sleep, interval};
use serde::{Deserialize, Serialize};
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;
use std::collections::HashMap;
use chrono::Utc;

#[derive(Debug, Deserialize)]
struct PumpPortalTrade {
    mint: String,
    #[serde(rename = "solAmount")]
    sol_amount: f64,
    #[serde(rename = "marketCapSol")]
    market_cap_sol: Option<f64>,
}

#[derive(Serialize)]
struct VolTrigger {
    mint: String,
    ratio: f64,
    current_vol: f64,
    prev_vol: f64,
    mc_sol: f64,
}

async fn run_volume_scout() -> Result<(), Box<dyn std::error::Error>> {
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let redis_client = redis::Client::open(redis_url)?;
    let mut redis_conn = redis_client.get_multiplexed_async_connection().await?;

    // 1. Connect to PumpPortal Firehose
    let wss_url = "wss://pumpportal.fun/api/data";
    println!("🔌 [VOL-SCOUT] Connecting to PumpPortal WSS...");
    let (ws_stream, _) = connect_async(Url::parse(wss_url).unwrap()).await?;
    let (mut write, mut read) = ws_stream.split();

    // Subscribe to New Token Creation (Discovery channel)
    let sub_new = serde_json::json!({ 
        "method": "subscribeNewToken"
    });
    write.send(Message::Text(sub_new.to_string())).await?;
    println!("📡 [VOL-SCOUT] Subscribed to Token Creation Feed.");

    // 2. Track Volume Candles
    let mut current_minute_vol: HashMap<String, f64> = HashMap::new();
    let mut previous_minute_vol: HashMap<String, f64> = HashMap::new();
    let mut last_mc: HashMap<String, f64> = HashMap::new();
    let mut monitored_mints: HashMap<String, std::time::Instant> = HashMap::new();
    
    let mut candle_timer = interval(Duration::from_secs(60));
    candle_timer.tick().await; // Initial tick

    loop {
        tokio::select! {
            // Roll the candles every 60s
            _ = candle_timer.tick() => {
                println!("🕰️ [VOL-SCOUT] Rolling 1m Candle. Tokens active: {} | Total Monitored: {}", current_minute_vol.len(), monitored_mints.len());
                
                for (mint, vol) in &current_minute_vol {
                    let prev_vol = *previous_minute_vol.get(mint).unwrap_or(&0.0);
                    
                    // ACCELERATION TRIGGER (bot4)
                    // Logic: Current Vol >= 2.5x Previous Vol AND Current Vol >= 0.3 SOL
                    if prev_vol > 0.01 && *vol >= 2.5 * prev_vol && *vol >= 0.3 {
                        let ratio = *vol / prev_vol;
                        let mc = *last_mc.get(mint).unwrap_or(&0.0);
                        
                        let trigger = VolTrigger {
                            mint: mint.clone(),
                            ratio,
                            current_vol: *vol,
                            prev_vol,
                            mc_sol: mc,
                        };

                        let payload = serde_json::to_string(&trigger).unwrap_or_default();
                        let _: () = redis_conn.publish("volume_triggers", &payload).await?;
                        
                        // Cache for Dashboard
                        let _: () = redis_conn.lpush("volume_recent_triggers", &payload).await?;
                        let _: () = redis_conn.ltrim("volume_recent_triggers", 0, 19).await?;
                        
                        println!("🚀 [VOL-TRIGGER] {} | Ratio: {:.2}x | Vol: {:.3} SOL | MC: {:.1} SOL", 
                            &mint[..8], ratio, vol, mc);
                    }
                }

                previous_minute_vol = current_minute_vol.clone();
                current_minute_vol.clear();

                // Cleanup monitored_mints older than 1 hour (keep memory light)
                monitored_mints.retain(|_, start| start.elapsed() < Duration::from_secs(3600));
            }

            // Process incoming messages
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        println!("DEBUG-RAW: {}", text);
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                            // A. Handle New Tokens (Discovery)
                            if value["txType"] == "create" {
                                if let Some(mint) = value["mint"].as_str() {
                                    if !monitored_mints.contains_key(mint) {
                                        println!("🔍 [VOL-SCOUT] New Token: {} - Subscribing to trades.", &mint[..8]);
                                        // Subscribe to trades for this specific token
                                        let sub_trade = serde_json::json!({
                                            "method": "subscribeTokenTrade",
                                            "keys": [mint]
                                        });
                                        let _ = write.send(Message::Text(sub_trade.to_string())).await;
                                        monitored_mints.insert(mint.to_string(), std::time::Instant::now());
                                    }

                                    // Record volume & Push Price
                                    if let Some(sol) = value["solAmount"].as_f64() {
                                        let entry = current_minute_vol.entry(mint.to_string()).or_insert(0.0);
                                        *entry += sol;
                                    }
                                    if let Some(mc) = value["marketCapSol"].as_f64() {
                                        last_mc.insert(mint.to_string(), mc);
                                        // Push real-time SOL price to Redis
                                        let price_data = serde_json::json!({ "mc": mc, "v_sol": 0.0 });
                                        let _: () = redis_conn.set_ex(format!("price:{}", mint), price_data.to_string(), 60).await.unwrap_or(());
                                    }
                                }
                            }
                            // B. Handle Trades (Execution)
                            else if value["txType"] == "buy" || value["txType"] == "sell" {
                                if let Some(mint) = value["mint"].as_str() {
                                    if let Some(sol) = value["solAmount"].as_f64() {
                                        let entry = current_minute_vol.entry(mint.to_string()).or_insert(0.0);
                                        *entry += sol;
                                    }
                                    if let Some(mc) = value["marketCapSol"].as_f64() {
                                        last_mc.insert(mint.to_string(), mc);
                                        // Push real-time SOL price to Redis
                                        let price_data = serde_json::json!({ "mc": mc, "v_sol": 0.0 });
                                        let _: () = redis_conn.set_ex(format!("price:{}", mint), price_data.to_string(), 60).await.unwrap_or(());
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        println!("DEBUG: Received Ping");
                        let _ = write.send(Message::Pong(p)).await;
                    }
                    Some(Err(e)) => {
                        println!("❌ [VOL-SCOUT] WSS Error: {}", e);
                        return Err(e.into());
                    }
                    None => {
                        println!("❌ [VOL-SCOUT] WSS Closed (None)");
                        return Err("WSS Stream Closed".into());
                    }
                    _ => {}
                }
            }
        }
    }
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    env_logger::init();
    println!("🚀 [VOLUME-SCOUT] Initiating Momentum Tracking...");

    loop {
        if let Err(e) = run_volume_scout().await {
            println!("❌ [VOL-SCOUT] Error: {}. Reconnecting in 5s...", e);
            sleep(Duration::from_secs(5)).await;
        }
    }
}
