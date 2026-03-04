use dotenv;
use std::env;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::sleep;
use solana_client::rpc_client::RpcClient;
use solana_client::rpc_client::GetConfirmedSignaturesForAddress2Config;
use solana_sdk::pubkey::Pubkey;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct ForensicRequest {
    mint: String,
    trader: String,
    market_cap: f64,
    v_sol: f64,
}

#[derive(Serialize)]
struct TriggerPayload {
    mint: String,
    insider_address: String,
    funding_source: String,
    entry_market_cap: Option<f64>,
    entry_v_sol: Option<f64>,
}

const MAX_BURNER_TX_COUNT: usize = 5;

async fn is_burner_wallet(rpc: &RpcClient, address: &str) -> bool {
    if let Ok(pubkey) = address.parse::<Pubkey>() {
        // Fetch up to max_tx + 1 to see if we exceed the limit
        let config = GetConfirmedSignaturesForAddress2Config {
            limit: Some(MAX_BURNER_TX_COUNT + 1),
            ..Default::default()
        };
        
        // This RPC call is rate limited, handle carefully
        if let Ok(signatures) = rpc.get_signatures_for_address_with_config(&pubkey, config) {
            return signatures.len() < MAX_BURNER_TX_COUNT;
        }
    }
    false
}

async fn run_scout() -> Result<(), Box<dyn std::error::Error>> {
    let rpc_url = env::var("HELIUS_RPC_URL").expect("HELIUS_RPC_URL must be set");
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    
    let rpc_client = RpcClient::new(&rpc_url);
    let redis_client = redis::Client::open(redis_url)?;
    let mut redis_conn = redis_client.get_multiplexed_async_connection().await?;

    println!("🕵️ [SCOUT] Connected to Redis queue 'insider_forensics'...");
    
    loop {
        // Block until a new request is pushed
        let result: redis::RedisResult<(String, String)> = redis_conn.brpop("insider_forensics", 0.0).await;
        
        match result {
            Ok((_, req_str)) => {
                if let Ok(req) = serde_json::from_str::<ForensicRequest>(&req_str) {
                    // --- Blacklist Check ---
                    let is_blacklisted: Option<String> = redis_conn.get(format!("blacklist:{}", req.trader)).await.unwrap_or(None);
                    if is_blacklisted.is_some() {
                        println!("🚫 [FORENSIC] Skipping blacklisted trader: {}", req.trader);
                        continue;
                    }

                    println!("🔎 [FORENSIC] Analyzing early trader: {}", req.trader);
                    
                    // Is this a fresh Burner Wallet?
                    let is_burner = is_burner_wallet(&rpc_client, &req.trader).await;
                    
                    if is_burner {
                        println!("🔥 [INSIDER DETECTED] {} is a Burner Wallet (<5 historical TXs) sniping {} early!", req.trader, req.mint);
                        
                        let payload = TriggerPayload {
                            mint: req.mint.clone(),
                            insider_address: req.trader.clone(),
                            funding_source: "BURNER_WALLET".to_string(),
                            entry_market_cap: Some(req.market_cap),
                            entry_v_sol: Some(req.v_sol),
                        };
                        
                        let payload_str = serde_json::to_string(&payload)?;
                        // 1. Trigger the Sniper
                        let _: () = redis_conn.publish("insider_triggers", &payload_str).await?;
                        // 2. Add to Dashboard Watchlist (2 hour TTL)
                        let _: () = redis_conn.set_ex(format!("watchlist:{}", req.trader), "BURNER_WALLET", 600).await?;
                    } else {
                        println!("⏭️ [FORENSIC] Trader {} is an established wallet. Skipping.", req.trader);
                    }
                    
                    // Sleep to respect general RPC limits (depending on your plan, adapt if needed)
                    sleep(Duration::from_millis(50)).await;
                }
            }
            Err(e) => {
                println!("❌ [FORENSIC] Redis Error: {}", e);
                sleep(Duration::from_secs(2)).await;
            }
        }
    }
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    env_logger::init();
    println!("🚀 Starting INSIDER SCOUT (The Detective)...");

    let mut backoff = 1;
    let max_backoff = 30;

    loop {
        match run_scout().await {
            Ok(_) => {
                println!("SYSTEM_HALT: Detective exited cleanly. Restarting...");
                backoff = 1;
            }
            Err(e) => {
                println!("SYSTEM_ERROR: Detective Crashed: {}. Reconnecting in {}s...", e, backoff);
                sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(max_backoff);
            }
        }
    }
}
