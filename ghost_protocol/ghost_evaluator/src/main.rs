use dotenv;
use sqlx::postgres::PgPoolOptions;
use std::env;
use std::time::Duration;
use tokio::time::sleep;
use chrono::Utc;

#[derive(Debug, sqlx::FromRow)]
struct RejectedTarget {
    mint_address: String,
    rejected_at: chrono::DateTime<Utc>,
    #[allow(dead_code)] // Silence warning: we fetch it but don't read it yet
    check_count: i32,
    #[allow(dead_code)] // Silence warning: we fetch it but don't read it yet
    current_status: String, 
}

#[derive(serde::Deserialize, Debug)]
struct DexScreenerResponse {
    pairs: Option<Vec<DexPair>>,
}

#[derive(serde::Deserialize, Debug)]
struct DexPair {
    #[serde(rename = "priceUsd")]
    price_usd: String,
    #[serde(rename = "priceChange")]
    price_change: Option<PriceChange>,
    liquidity: Option<Liquidity>,
    volume: Option<Volume>,
}

#[derive(serde::Deserialize, Debug)]
struct Liquidity {
    usd: Option<f64>,
}

#[derive(serde::Deserialize, Debug)]
struct Volume {
    m5: f64,
}

#[derive(serde::Deserialize, Debug)]
struct PriceChange {
    m5: f64,  // 5 minute change
    #[allow(dead_code)] 
    h1: f64,  
}

use futures::stream::{FuturesUnordered, StreamExt};

async fn process_target(
    target: RejectedTarget,
    pool: sqlx::PgPool,
    client: reqwest::Client,
) {
    let age_mins = (Utc::now() - target.rejected_at).num_minutes();
    let mut new_status: Option<&str> = None;

    if let Some((_price, change_5m, liquidity, volume_5m)) = check_token_status(&target.mint_address, &client).await {
        
        // --- MAXIMUM PERMISSIVENESS MODE ---
        // We log "bad" stats but DO NOT mark as RUGGED.
        // We only mark as DEAD if it's truly ancient and empty.

        // 1. LOGGING (No Action)
        if liquidity < 1000.0 {
            println!("⚠️ LOW LIQUIDITY: {} (Liq: ${}) - Keeping ALIVE", target.mint_address, liquidity);
        } 
        
        if change_5m < -30.0 {
             println!("📉 DUMP/VOLATILITY: {} dropped {}% - Keeping ALIVE", target.mint_address, change_5m);
        }

        // 2. MOON DETECTION (Keep this, it's useful info)
        if change_5m > 30.0 && volume_5m > 5000.0 {
            new_status = Some("MISSED_OPPORTUNITY");
            println!("🚀 MOON: {} pumped {}% with Vol ${}", target.mint_address, change_5m, volume_5m);
        }
        
        // 3. DEAD DETECTION (Extremely Conservative)
        // Only dead if > 24 HOURS old and almost no volume
        else if age_mins > 1440 && volume_5m < 10.0 {
            new_status = Some("DEAD");
            println!("⚰️  TRULY DEAD: {} (Age: {}m, Vol: ${})", target.mint_address, age_mins, volume_5m);
        }
        
        // 4. STAY ALIVE (Default)
        else {
            new_status = Some("BARELY_ALIVE");
            println!("💓 ALIVE: {} (Age: {}m, Liq: ${}, Vol: ${})", target.mint_address, age_mins, liquidity, volume_5m);
        }

    } else {
        // NO DATA CASE
        if age_mins > 1440 { // 24 hours
            new_status = Some("DEAD");
            println!("👻 GHOST: {} (No data for 24h)", target.mint_address);
        } else {
             println!("⏳ NO DATA: {} (Age: {}m) - Waiting...", target.mint_address, age_mins);
        }
    }

    if let Some(status) = new_status {
        let _ = sqlx::query(
            "UPDATE rejected_targets 
             SET current_status = $1::evaluation_status, 
                 last_check_at = NOW(), 
                 check_count = check_count + 1 
             WHERE mint_address = $2"
        )
        .bind(status)
        .bind(&target.mint_address)
        .execute(&pool)
        .await;
    }
}

async fn check_token_status(mint: &str, client: &reqwest::Client) -> Option<(f64, f64, f64, f64)> {
    let url = format!("https://api.dexscreener.com/latest/dex/tokens/{}", mint);

    match client.get(&url).send().await {
        Ok(resp) => {
            if let Ok(data) = resp.json::<DexScreenerResponse>().await {
                if let Some(pairs) = data.pairs {
                    if let Some(pair) = pairs.first() {
                        let price = pair.price_usd.parse::<f64>().unwrap_or(0.0);
                        let change = pair.price_change.as_ref().map(|pc| pc.m5).unwrap_or(0.0);
                        let liquidity = pair.liquidity.as_ref().and_then(|l| l.usd).unwrap_or(0.0);
                        let volume = pair.volume.as_ref().map(|v| v.m5).unwrap_or(0.0);
                        
                        return Some((price, change, liquidity, volume));
                    }
                }
            }
        }
        Err(e) => eprintln!("❌ DexScreener Error: {}", e),
    }
    None
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();
    env_logger::init();

    println!("⚖️ Starting GHOST EVALUATOR Service (Parallel Evaluation)...");

    let host = env::var("POSTGRES_HOST").unwrap_or_else(|_| "postgres".to_string());
    let user = env::var("POSTGRES_USER").unwrap_or_else(|_| "ghost_user".to_string());
    let pass = env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "ghost_password".to_string());
    let db = env::var("POSTGRES_DB").unwrap_or_else(|_| "ghost_db".to_string());
    
    let db_url = format!("postgres://{}:{}@{}:5432/{}", user, pass, host, db);
    println!("🔗 Connecting to DB at {}:5432", host);

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&db_url)
        .await?;

    println!("✅ Connected to Database");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    loop {
        let targets = sqlx::query_as::<_, RejectedTarget>(
            "SELECT mint_address, rejected_at, check_count, current_status::TEXT 
             FROM rejected_targets 
             WHERE current_status IN ('PENDING', 'BARELY_ALIVE', 'REJECTED_NO_MOMENTUM', 'NO_GROWTH')"
        )
        .fetch_all(&pool)
        .await?;

        if targets.is_empty() {
            sleep(Duration::from_secs(30)).await;
            continue;
        }

        println!("🔍 Batch evaluating {} targets...", targets.len());

        let mut workers = FuturesUnordered::new();
        
        for target in targets {
            workers.push(process_target(target, pool.clone(), client.clone()));
        }

        while let Some(_) = workers.next().await {}
        
        println!("✅ Batch complete. Resting before next cycle...");
        sleep(Duration::from_secs(60)).await;
    }
}