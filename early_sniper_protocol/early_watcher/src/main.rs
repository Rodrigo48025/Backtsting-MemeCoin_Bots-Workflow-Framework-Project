use dotenv;
use futures_util::StreamExt;
use std::env;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::{sleep, interval};

async fn run_early_watcher() -> Result<(), Box<dyn std::error::Error>> {
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let client = redis::Client::open(redis_url)?;
    let mut redis_conn = client.get_multiplexed_async_connection().await?;
    
    let http_client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?;
    println!("📡 [EARLY-WATCHER] Backup Price Engine Active.");

    let mut tick_timer = interval(Duration::from_secs(3));

    loop {
        tick_timer.tick().await;

        if let Ok(mints) = redis_conn.smembers::<_, Vec<String>>("active_early_snipes").await {
            for mint in mints {
                let url = format!("https://api.dexscreener.com/tokens/v1/solana/{}", mint);
                if let Ok(resp) = http_client.get(url).send().await {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        if let Some(pairs) = json.as_array() {
                            if let Some(pair) = pairs.first() {
                                if let Some(mc_usd) = pair["marketCap"].as_f64() {
                                    if mc_usd > 0.0 {
                                        // Conversion placeholder (SOL/USD ~150)
                                        let mc_sol = mc_usd / 150.0;
                                        let price_data = serde_json::json!({ "mc": mc_sol, "v_sol": 0.0 });
                                        let _: () = redis_conn.set_ex(format!("price:{}", mint), price_data.to_string(), 60).await.unwrap_or(());
                                    }
                                }
                            }
                        }
                    }
                }
                sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    println!("🚀 [EARLY-WATCHER] Initiating Synchronization...");
    loop {
        if let Err(e) = run_early_watcher().await {
            println!("❌ [EARLY-WATCHER] Error: {}. Reconnecting in 5s...", e);
            sleep(Duration::from_secs(5)).await;
        }
    }
}
