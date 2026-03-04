use dotenv;
use futures_util::StreamExt;
use tokio_tungstenite::connect_async;
use url::Url;
use std::env;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::sleep;

async fn run_watcher() -> Result<(), Box<dyn std::error::Error>> {
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let client = redis::Client::open(redis_url)?;
    let mut redis_conn = client.get_multiplexed_async_connection().await?;
    
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;

    println!("📡 [VOL-WATCHER] Price Sync Engine Active.");

    let mut interval = tokio::time::interval(Duration::from_secs(2));

    loop {
        interval.tick().await;

        // Poll Redis for tokens the Sniper is currently holding
        if let Ok(mints) = redis_conn.smembers::<_, Vec<String>>("active_snipes").await {
            for mint in mints {
                // Poll DexScreener for real-time price/MC
                let url = format!("https://api.dexscreener.com/tokens/v1/solana/{}", mint);
                if let Ok(resp) = http_client.get(url).send().await {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        if let Some(pairs) = json.as_array() {
                            if let Some(pair) = pairs.first() {
                                if let Some(mc_usd) = pair["marketCap"].as_f64() {
                                        /*
                                        let mc_sol = mc_usd / 150.0; 
                                        let price_data = serde_json::json!({
                                            "mc": mc_sol,
                                            "v_sol": 0.0 
                                        });
                                        let _: () = redis_conn.set_ex(
                                            format!("price:{}", mint),
                                            price_data.to_string(),
                                            30
                                        ).await.unwrap_or(());
                                        println!("📊 [VOL-WATCHER] Price Sync (SOL-aligned): {} -> {:.2} SOL MC", &mint[..8], mc_sol);
                                        */
                                        println!("📊 [VOL-WATCHER] Observed {} -> ${:.0} MC (Push Disabled)", &mint[..8], mc_usd);
                                }
                            }
                        }
                    }
                }
                // Small sleep to avoid hitting DexScreener limits too hard if many snipes
                sleep(Duration::from_millis(100)).await;
            }
        }
    }
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    env_logger::init();
    println!("🚀 Starting VOLUME WATCHER...");

    loop {
        if let Err(e) = run_watcher().await {
            println!("❌ Watcher Error: {}. Reconnecting in 5s...", e);
            sleep(Duration::from_secs(5)).await;
        }
    }
}
