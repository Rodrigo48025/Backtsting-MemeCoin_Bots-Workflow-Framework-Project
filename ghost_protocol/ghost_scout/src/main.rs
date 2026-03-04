mod key_manager;

use dotenv;
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;
use serde::{Deserialize, Serialize};
use key_manager::KeyManager;
use std::env;
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::sleep;
use solana_program::pubkey::Pubkey;
use deadpool_postgres::{Pool, Config, Runtime};
use tokio_postgres::NoTls;
use chrono::{self, Utc};

// --- STRUCTS REMAIN THE SAME ---
// --- STRUCTS ---
#[derive(Debug, Deserialize)]
struct PumpPortalEvent {
    #[serde(rename = "signature")]
    _signature: Option<String>,
    mint: String,
    #[serde(rename = "traderPublicKey")]
    _trader_public_key: Option<String>,
    #[serde(rename = "txType")]
    _tx_type: String,
    #[serde(rename = "initialBuy")]
    initial_buy: Option<f64>, // Now used for filtering
    #[serde(rename = "solAmount")]
    sol_amount: Option<f64>,
    #[serde(rename = "marketCapSol")]
    market_cap_sol: Option<f64>,
    
    // New fields for Metadata Filter
    name: Option<String>,
    symbol: Option<String>,
    uri: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct DelayedToken {
    mint: String,
    uri: Option<String>,
    sol_amount: f64,
    name: Option<String>,
    bonding_curve: Option<String>,
    initial_mc: f64,
}

#[derive(Serialize)]
struct TargetPayload {
    mint: String,
    pool_address: String, 
    found_at: String,
    initial_sol: f64,
    holder_avg_buy: f64,
}

// --- HELPER FUNCTIONS ---

async fn check_metadata(mint: &str, uri: Option<&String>) -> bool {
    // LAYER 2: METADATA CHECK (Socials)
    let uri_str = match uri {
        Some(u) if !u.is_empty() => u,
        _ => {
            println!("❌ [METADATA] {} has NO URI.", mint);
            return false;
        }
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    match client.get(uri_str).send().await {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                // HELPER: Validate link is not a placeholder
                let is_valid = |url: &str| -> bool {
                    let u = url.to_lowercase();
                    !u.is_empty() && 
                    u != "https://t.me/" && u != "http://t.me/" && 
                    u != "https://x.com/" && u != "http://x.com/" &&
                    u != "https://twitter.com/" && u != "http://twitter.com/" &&
                    !u.ends_with(".com") && !u.ends_with(".me") && !u.ends_with("/")
                };

                let tw = json.get("twitter").and_then(|t| t.as_str()).map(is_valid).unwrap_or(false);
                let tg = json.get("telegram").and_then(|t| t.as_str()).map(is_valid).unwrap_or(false);
                let web = json.get("website").and_then(|t| t.as_str()).map(is_valid).unwrap_or(false);

                if tw || tg || web {
                    println!("✅ [METADATA] {} has valid socials (Tw: {}, Tg: {}, Web: {})", mint, tw, tg, web);
                    return true;
                }
            }
        },
        Err(e) => eprintln!("⚠️ Metadata Fetch Error ({}): {}", mint, e),
    }

    println!("⚠️ [METADATA] {} has NO valid socials (Filtered placeholders).", mint);
    false
}

async fn analyze_token(
    mint: &str,
    shyft_manager: &KeyManager,
    _alchemy_manager: &KeyManager,
    dist_threshold: f64
) -> Result<(), String> {
    let client = reqwest::Client::new();

    // 1. RUGCHECK.XYZ (LAYER 2.5)
    let rugcheck_url = format!("https://api.rugcheck.xyz/v1/tokens/{}/report", mint);
    match client.get(&rugcheck_url).send().await {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let risk_score = json.get("score").and_then(|s| s.as_f64()).unwrap_or(0.0);
                if risk_score > 5000.0 {
                    return Err(format!("[RUGCHECK] High Risk Score: {}", risk_score));
                }
                
                // Check for critical risks in "risks" array
                if let Some(risks) = json.get("risks").and_then(|r| r.as_array()) {
                    for risk in risks {
                        let name = risk.get("name").and_then(|n| n.as_str()).unwrap_or("");
                        let level = risk.get("level").and_then(|l| l.as_str()).unwrap_or("");
                        if level == "danger" || name.contains("Large Amount of Supply") {
                             return Err(format!("[RUGCHECK] Critical Risk: {}", name));
                        }
                    }
                }
            }
        },
        Err(_) => println!("⚠️ RugCheck Timeout/Offline for {} - Skipping Layer", mint),
    }

    // 2. SHYFT.TO (Deep Holder Check) - LAYER 3
    let api_key = shyft_manager.get_next_key();
    let shyft_url = format!("https://api.shyft.to/sol/v1/token/get_holders?network=mainnet-beta&token_address={}", mint);
    
    match client.get(&shyft_url).header("x-api-key", api_key).send().await {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                // SUPER FILTER: Check top 20 holders
                if let Some(holders) = json.get("result").and_then(|r| r.as_array()) {
                    let system_wallets = vec![
                        "5Q544fKrEe6iySxeaHkkRxMOT6en2KcFAm5Rk87438Z", // Raydium Authority
                        "39azUYFWPz3VHgKCf3VChUwbpURdZ1SvE47f1Sqi75Q", // Pump.fun
                    ];

                    let mut top_20_sum: f64 = 0.0;
                    let mut count = 0;
                    
                    for holder in holders {
                        if count >= 20 { break; }
                        let address = holder.get("owner").and_then(|a| a.as_str()).unwrap_or("");
                        if system_wallets.contains(&address) { continue; }

                        top_20_sum += holder.get("percentage").and_then(|p| p.as_f64()).unwrap_or(0.0);
                        count += 1;
                    }

                    if top_20_sum > dist_threshold {
                        return Err(format!("[DISTR] Top 20 non-system hold {:.1}% (Limit: {:.1}%)", top_20_sum, dist_threshold));
                    }
                }
            }
        },
        Err(e) => eprintln!("⚠️ Shyft API Error: {}", e),
    }

    Ok(())
}

async fn fetch_raydium_pool(_mint: &str, _helius_keys: &KeyManager) -> Option<String> {
   // For new tokens on Pump.fun, the "pool" IS the bonding curve.
   // We can return the bonding curve address if we have it, or just "pump_fun_bonding_curve".
   // Since the Sniper expects a pool address, and for Pump tokens we might need to swap on Pump...
   // For now, let's return a placeholder or the mint itself as the "target".
   // NOTE: This function was used for Raydium migrations. 
   // For New Token Mode, we might skip Helius pool check entirely or use it later.
   // Let's return "PUMP_BONDING_CURVE" for now to indicate it's pre-migration.
   Some("PUMP_BONDING_CURVE".to_string())
}

async fn log_target(pool: &Pool, mint: &str, pool_address: &str, initial_sol: f64, holder_avg_buy: f64) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("❌ Failed to get DB client from pool: {}", e);
            return;
        }
    };

    let query = "INSERT INTO target_queue (mint_address, pool_address, initial_liquidity, status, found_at, source, holder_avg_buy) 
                 VALUES ($1, $2, $3, 'PENDING', NOW(), 'PUMP_FUN', $4) 
                 ON CONFLICT (mint_address) DO UPDATE SET holder_avg_buy = $4";
    
    if let Err(e) = client.execute(query, &[&mint, &pool_address, &initial_sol, &holder_avg_buy]).await {
        eprintln!("❌ Failed to log target to DB: {}", e);
    } else {
        println!("💾 [DB SYNC] Saved {} to target_queue (Basis: {:.6})", &mint[..8], holder_avg_buy);
    }
}

async fn log_rejection(pool: &Pool, mint: &str, reason: &str, _initial_sol: f64) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("❌ Failed to get DB client for rejection: {}", e);
            return;
        }
    };

    let query = "INSERT INTO rejected_targets (mint_address, rejection_reason, initial_price, current_status, rejected_at) VALUES ($1, $2, 0.0, 'PENDING', NOW()) ON CONFLICT (mint_address) DO NOTHING";
    
    if let Err(e) = client.execute(query, &[&mint, &reason]).await {
        eprintln!("❌ Failed to log rejection to DB: {}", e);
    } else {
        println!("💾 Logged rejection to DB: {}", reason);
    }
}

async fn log_incubation(pool: &Pool, token: &DelayedToken, score: f64) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("❌ Failed to get DB client for incubation: {}", e);
            return;
        }
    };

    let now_ts = Utc::now().timestamp() as f64;
    let seconds_to_mature = (score - now_ts).max(0.0) as i64;
    let mature_at = Utc::now() + chrono::Duration::seconds(seconds_to_mature);
    
    let query = "INSERT INTO incubating_targets (mint_address, name, symbol, uri, initial_buy_sol, bonding_curve, mature_at, status, initial_market_cap) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'WAITING', $8) 
                 ON CONFLICT (mint_address) DO UPDATE SET status = 'WAITING', mature_at = $7, initial_market_cap = $8";
    
    if let Err(e) = client.execute(query, &[
        &token.mint, 
        &token.name, 
        &None::<String>, // symbol not available in event yet
        &token.uri, 
        &token.sol_amount, 
        &token.bonding_curve,
        &mature_at,
        &token.initial_mc,
    ]).await {
        eprintln!("❌ Failed to log incubation to DB: {}", e);
    } else {
        println!("💾 [INCUBATION] {} logged to DB", &token.mint[..8]);
    }
}

async fn update_incubation_status(pool: &Pool, mint: &str, status: &str, reason: Option<&str>) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("❌ Failed to get DB client for status update: {}", e);
            return;
        }
    };

    let query = "UPDATE incubating_targets SET status = $1, rejection_reason = $2 WHERE mint_address = $3";
    
    if let Err(e) = client.execute(query, &[&status, &reason, &mint]).await {
        eprintln!("❌ Failed to update incubation status: {}", e);
    }
}

// --- NEW IMMORTAL LOGIC ---

use std::sync::Arc;

// --- IMMORTAL LOGIC WITH CONCURRENCY ---

async fn run_scout_logic(db_pool: Pool) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Shared Managers & Connections
    let shyft_keys = Arc::new(KeyManager::new("SHYFT_API_KEYS", "Shyft"));
    let alchemy_keys = Arc::new(KeyManager::new("ALCHEMY_API_KEYS", "Alchemy"));
    let helius_keys = Arc::new(KeyManager::new("HELIUS_API_KEYS", "Helius"));

    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let client = redis::Client::open(redis_url)?;
    let redis_conn = client.get_multiplexed_async_connection().await?;
    
    // 2. WebSocket Connection
    let wss_url = "wss://pumpportal.fun/api/data";
    println!("🔌 Connecting to PumpPortal WSS...");
    let (ws_stream, _) = connect_async(Url::parse(wss_url).unwrap()).await?;
    println!("✅ Connected to PumpPortal");

    let (mut write, mut read) = ws_stream.split();
    
    // NEW TOKEN MODE
    let subscribe_msg = serde_json::json!({ "method": "subscribeNewToken" });
    write.send(Message::Text(subscribe_msg.to_string())).await?;
    println!("📡 Subscribed to NEW TOKEN Events (Firehose Mode)");

    // 2.5 SPAWN THE DELAYED WORKER
    let worker_db = db_pool.clone();
    let worker_shyft = Arc::clone(&shyft_keys);
    let worker_alchemy = Arc::clone(&alchemy_keys);
    let _worker_helius = Arc::clone(&helius_keys);
    let mut worker_redis = redis_conn.clone();
    
    tokio::spawn(async move {
        println!("🕰️ [DELAYED WORKER] Started. Monitoring queue...");
        loop {
            let now = chrono::Utc::now().timestamp() as f64;
            
            // 1. Get mature tokens from Redis ZSET
            let mature_mints: Vec<String> = match worker_redis.zrangebyscore("delayed_analysis_queue", f64::MIN, now).await {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("❌ [DELAYED WORKER] Redis Error: {}", e);
                    sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };

            let mut unique_tokens: std::collections::HashMap<String, (DelayedToken, Vec<String>)> = std::collections::HashMap::new();
            for mint_json in mature_mints {
                if let Ok(token) = serde_json::from_str::<DelayedToken>(&mint_json) {
                    unique_tokens.entry(token.mint.clone())
                        .and_modify(|(_, jsons)| jsons.push(mint_json.clone()))
                        .or_insert((token, vec![mint_json]));
                }
            }

            for (_, (token, jsons)) in unique_tokens {
                println!("🚀 [DELAYED WORKER] Mature Target: {} (20 min up). Analyzing...", &token.mint[..8]);
                
                let is_whale_dev = token.sol_amount >= 2.5;
                let has_socials = check_metadata(&token.mint, token.uri.as_ref()).await;
                
                if !is_whale_dev && !has_socials {
                    println!("⛔ [REJECTED] {} | Reason: NO_SOCIALS_LOW_BUY (Buy: {} SOL)", &token.mint[..8], token.sol_amount);
                    log_rejection(&worker_db, &token.mint, "NO_SOCIALS_LOW_BUY", token.sol_amount).await;
                    update_incubation_status(&worker_db, &token.mint, "REJECTED", Some("NO_SOCIALS_LOW_BUY")).await;
                } else {
                    if is_whale_dev && !has_socials {
                            println!("⚠️ [WHALE ALERT] {} has NO socials but Buy is {} SOL. Allowing (DEGEN_MODE).", &token.mint[..8], token.sol_amount);
                    }

                    // --- LAUNCH FLOOR FILTER (NO_GROWTH) ---
                    let mut current_mc_sol = 0.0;
                    let client = reqwest::Client::new();
                    let url = format!("https://api.dexscreener.com/latest/dex/tokens/{}", token.mint);
                    if let Ok(resp) = client.get(&url).send().await {
                        if let Ok(data) = resp.json::<serde_json::Value>().await {
                            if let Some(pairs) = data.get("pairs").and_then(|p| p.as_array()) {
                                if let Some(pair) = pairs.first() {
                                    // DexScreener 'priceNative' is SOL price.
                                    // Pump.fun tokens have a fixed 1B supply.
                                    let price_native = pair.get("priceNative").and_then(|v| v.as_str()).unwrap_or("0");
                                    let price_sol = price_native.parse::<f64>().unwrap_or(0.0);
                                    current_mc_sol = price_sol * 1_000_000_000.0;
                                }
                            }
                        }
                    }

                    // Strict Floor Check: current_mc must be > initial_mc (launch_mc)
                    if current_mc_sol > 0.0 && current_mc_sol <= token.initial_mc {
                         println!("⛔ [REJECTED] {} | Reason: NO_GROWTH (MC: {:.2} SOL / Launch: {:.2} SOL)", &token.mint[..8], current_mc_sol, token.initial_mc);
                         log_rejection(&worker_db, &token.mint, "NO_GROWTH", token.sol_amount).await;
                         update_incubation_status(&worker_db, &token.mint, "REJECTED", Some("NO_GROWTH")).await;
                         continue; // Skip further analysis
                    } else if current_mc_sol == 0.0 {
                         println!("⚠️ [DELAYED WORKER] {} not indexed on DexScreener yet or MC check failed. Skipping Launch Floor for now.", &token.mint[..8]);
                    }

                    let dist_threshold = if is_whale_dev { 30.0 } else { 20.0 };

                    let mut pool_address = "PUMP_BONDING_CURVE".to_string();
                    if let Some(bc) = &token.bonding_curve {
                        pool_address = bc.clone();
                    }

                    match analyze_token(&token.mint, &worker_shyft, &worker_alchemy, dist_threshold).await {
                        Ok(_) => {
                            println!("✅ [PASSED ALL LAYERS] {} | Adding to DB...", &token.mint[..8]);
                            log_target(&worker_db, &token.mint, &pool_address, token.sol_amount, token.initial_mc).await;
                            update_incubation_status(&worker_db, &token.mint, "PASSED", None).await;

                            let payload = TargetPayload {
                                mint: token.mint.clone(),
                                pool_address: pool_address,
                                found_at: chrono::Utc::now().to_rfc3339(),
                                initial_sol: token.sol_amount,
                                holder_avg_buy: token.initial_mc,
                            };
                            let payload_str = serde_json::to_string(&payload).unwrap();
                            
                            if let Err(e) = worker_redis.publish::<&str, &str, ()>("new_targets", &payload_str).await {
                                eprintln!("❌ [REDIS ERROR] Failed to publish {}: {}", &token.mint[..8], e);
                            } else {
                                println!("📡 [SIGNAL SENT] {} -> Sniper", &token.mint[..8]);
                            }
                        },
                        Err(reason) => {
                            println!("⛔ [REJECTED] {} | Reason: {}", &token.mint[..8], reason);
                            log_rejection(&worker_db, &token.mint, &reason, token.sol_amount).await;
                            update_incubation_status(&worker_db, &token.mint, "REJECTED", Some(&reason)).await;
                        }
                    }
                }
                // Remove from queue regardless of outcome
                for mint_json in jsons {
                    let _: () = worker_redis.zrem("delayed_analysis_queue", &mint_json).await.unwrap_or_default();
                }
            }
            
            sleep(Duration::from_secs(5)).await;
        }
    });

    // 3. The Parallel Loop
    while let Some(msg) = read.next().await {
        let message = msg?; 
        
        if let Message::Text(text) = message {
            // DEBUG: Log first 100 chars of raw message
            println!("📡 RAW: {}", if text.len() > 100 { &text[..100] } else { &text });
            
            if let Ok(event) = serde_json::from_str::<PumpPortalEvent>(&text) {
                
                // --- LAYER 1: LOCAL HEURISTIC FILTER ---
                let init_buy = event.sol_amount.unwrap_or(0.0);
                
                // 1. Initial Buy < 0.5 SOL -> IGNORE
                if init_buy < 0.5 {
                    // println!("🗑️ SKIP: {} (Buy: {} SOL)", event.mint, init_buy); // Too noisy?
                    continue; 
                }

                // 2. Name Filter (Spam check)
                if let Some(name) = &event.name {
                    if name.to_lowercase().contains("test") || name.len() < 3 {
                         println!("🗑️ SKIP: {} (Name: {})", event.mint, name);
                         continue;
                    }
                }

                println!("🔎 NEW TARGET: {} | Buy: {} SOL | Name: {:?}", event.mint, init_buy, event.name);

                // --- DERIVE BONDING CURVE ---
                let bonding_curve = if let Ok(mint_pubkey) = event.mint.parse::<Pubkey>() {
                    let pump_program = "6EF8rrecthR5DkZJ4NsuA5EBxc69m6tshv77pudCpump".parse::<Pubkey>().unwrap();
                    let (bc, _) = Pubkey::find_program_address(
                        &[b"bonding-curve", mint_pubkey.as_ref()],
                        &pump_program
                    );
                    let bc_str: String = bc.to_string();
                    println!("🧬 [PDA DERIVATION] {} -> {}", &event.mint[..8], &bc_str[..8]);
                    Some(bc_str)
                } else {
                    println!("❌ [PDA ERROR] Failed to parse mint: {}", event.mint);
                    None
                };

                // --- OPTION 1: BUFFER IN REDIS ---
                let delayed_token = DelayedToken {
                    mint: event.mint.clone(),
                    uri: event.uri.clone(),
                    sol_amount: init_buy,
                    name: event.name.clone(),
                    bonding_curve,
                    initial_mc: event.market_cap_sol.unwrap_or(0.0),
                };
                let token_json = serde_json::to_string(&delayed_token).unwrap();
                let score = (chrono::Utc::now().timestamp() + 1200) as f64; // Meta-Aware: Give devs 20 mins
                
                let mut redis = redis_conn.clone();
                let worker_db_discovery = db_pool.clone();
                let delayed_token_copy = DelayedToken {
                    mint: delayed_token.mint.clone(),
                    uri: delayed_token.uri.clone(),
                    sol_amount: delayed_token.sol_amount,
                    name: delayed_token.name.clone(),
                    bonding_curve: delayed_token.bonding_curve.clone(),
                    initial_mc: delayed_token.initial_mc,
                };

                tokio::spawn(async move {
                    // Log to DB first for visibility
                    log_incubation(&worker_db_discovery, &delayed_token_copy, score).await;

                    if let Err(e) = redis.zadd::<&str, f64, &str, ()>("delayed_analysis_queue", &token_json, score).await {
                        eprintln!("❌ [REDIS ERROR] Failed to buffer {}: {}", &delayed_token_copy.mint[..8], e);
                    } else {
                        println!("🕰️ [BUFFERED] {} will be analyzed in 20 minutes.", &delayed_token_copy.mint[..8]);
                    }
                });
            }
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    env_logger::init();

    println!("🚀 Starting GHOST SCOUT Service (Immortal Concurrency Mode)...");

    let host = env::var("POSTGRES_HOST").unwrap_or_else(|_| "postgres".to_string());
    let user = env::var("POSTGRES_USER").unwrap_or_else(|_| "ghost_user".to_string());
    let pass = env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "ghost_password".to_string());
    let db = env::var("POSTGRES_DB").unwrap_or_else(|_| "ghost_db".to_string());
    
    let _db_url = format!("postgres://{}:{}@{}:5432/{}", user, pass, host, db);
    println!("🔗 Connecting to DB at {}:5432", host);

    let mut cfg = Config::new();
    cfg.host = Some(host);
    cfg.user = Some(user);
    cfg.password = Some(pass);
    cfg.dbname = Some(db);
    cfg.port = Some(5432);

    let db_pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)
        .expect("Failed to create DB pool");

    println!("✅ Database Pool Created");

    loop {
        // Pass db_pool by value (Clone is done inside the function loop if needed, but it's fine here)
        match run_scout_logic(db_pool.clone()).await {
            Ok(_) => println!("⚠️ Scout stream ended normally. Restarting..."),
            Err(e) => println!("❌ Scout crashed: {}. Restarting in 5s...", e),
        }
        sleep(Duration::from_secs(5)).await;
    }
}