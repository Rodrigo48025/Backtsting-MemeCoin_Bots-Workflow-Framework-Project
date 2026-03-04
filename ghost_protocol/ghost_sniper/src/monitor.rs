use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use serde::Deserialize;
use std::time::{Duration, Instant};
use deadpool_postgres::Pool;
use chrono::Utc;
// NEW: Import the new base64 engine types for v0.21+
use base64::{Engine as _, engine::general_purpose};

// Raydium Liquidity Pool V4 Program ID
const RAYDIUM_V4: &str = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
// Pump.fun Program ID
const PUMP_FUN_PROGRAM: &str = "6EF8rrecthR5DkZJ4NsuA5EBxc69m6tshv77pudCpump";

#[derive(Debug, Clone)]
pub struct PricePoint {
    // We prefix unused fields with _ so Rust knows we are intentionally ignoring them for now
    pub _slot: u64,
    pub _sol_reserve: f64,
    pub _token_reserve: f64,
    pub price: f64, // SOL per token
    pub timestamp: Instant,
}

pub struct TokenMonitor {
    mint: String,
    pool_address: String,
    helius_key: String,
    db_pool: Pool,
    price_history: Vec<PricePoint>,
    entry_price: Option<f64>,
    initial_discovery_price: Option<f64>,
    position_size_sol: f64,
    // Momentum Guard fields
    recovery_watch_started: Option<Instant>,
    accumulated_buy_sol: f64,
    accumulated_sell_sol: f64,
    // Eviction Tracking
    monitoring_start: Instant,
    last_meaningful_change: Instant,
    holder_avg_buy: f64,
}

impl TokenMonitor {
    pub fn new(mint: String, pool_address: String, helius_key: String, db_pool: Pool, holder_avg_buy: f64) -> Self {
        Self {
            mint,
            pool_address,
            helius_key,
            db_pool,
            price_history: Vec::with_capacity(1000),
            entry_price: None,
            initial_discovery_price: None,
            position_size_sol: 1.0,
            recovery_watch_started: None,
            accumulated_buy_sol: 0.0,
            accumulated_sell_sol: 0.0,
            monitoring_start: Instant::now(),
            last_meaningful_change: Instant::now(),
            holder_avg_buy,
        }
    }

    /// Calculate price from Raydium pool reserves
    fn calculate_price(sol_reserve: f64, token_reserve: f64) -> f64 {
        if token_reserve == 0.0 {
            return 0.0;
        }
        sol_reserve / token_reserve
    }

    /// Calculate VPC: Velocity of Price Change (% drop per second)
    fn calculate_vpc(&self, current_price: f64, current_time: Instant) -> Option<f64> {
        let lookback = Duration::from_secs(2);
        
        for point in self.price_history.iter().rev() {
            if current_time.duration_since(point.timestamp) >= lookback {
                let price_change = (current_price - point.price) / point.price;
                let time_delta = current_time.duration_since(point.timestamp).as_secs_f64();
                
                if time_delta == 0.0 { return Some(0.0); }

                let velocity = price_change / time_delta; // % per second
                return Some(velocity * 100.0); // Convert to percentage
            }
        }
        None
    }

    /// Check if we should enter (Dump detected)
    // We use _current_price to tell Rust we aren't using this arg yet
    fn check_entry_signal(&self, _current_price: f64, vpc: f64) -> bool {
        // Aggressive Entry: > 0.15% drop per second
    if vpc > -0.15 {
            return false; 
        }
        self.entry_price.is_none()
    }

    /// Check if we should exit
    fn check_exit_signal(&self, current_price: f64) -> Option<String> {
        let Some(entry) = self.entry_price else {
            return None;
        };

        let pnl_pct = (current_price - entry) / entry * 100.0;

        if pnl_pct >= 5.0 {
            return Some("TAKE_PROFIT".to_string());
        }
        if pnl_pct <= -10.0 {
            return Some("STOP_LOSS".to_string());
        }
        None
    }

    fn simulate_buy(&self, sol_in: f64, sol_reserve: f64, token_reserve: f64) -> f64 {
        let k = sol_reserve * token_reserve;
        let new_sol_reserve = sol_reserve + sol_in;
        let new_token_reserve = k / new_sol_reserve;
        let tokens_out = token_reserve - new_token_reserve;
        tokens_out * 0.9975
    }

    fn simulate_sell(&self, tokens_in: f64, sol_reserve: f64, token_reserve: f64) -> f64 {
        let k = sol_reserve * token_reserve;
        let new_token_reserve = token_reserve + tokens_in;
        let new_sol_reserve = k / new_token_reserve;
        let sol_out = sol_reserve - new_sol_reserve;
        sol_out * 0.9975
    }

    async fn log_trade(&self, direction: &str, price: f64, sol_amount: f64, _token_amount: f64, pnl_pct: Option<f64>) {
        let client = match self.db_pool.get().await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("❌ DB Connection Error: {}", e);
                return;
            }
        };

        let status = if direction == "BUY" { "OPEN" } else { "CLOSED" };
        let now = Utc::now();
        
        // We unwrap or default to 0.0 to satisfy the database constraint
        let pnl = pnl_pct.unwrap_or(0.0);

        let query = "
            INSERT INTO virtual_trades 
            (token_mint, direction, entry_timestamp, entry_price, entry_sol_amount, pnl_percentage, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        ";

        let result = client.execute(
            query,
            &[
                &self.mint,
                &direction,
                &now,
                &price,
                &sol_amount,
                &pnl, 
                &status,
            ],
        ).await;

        if let Err(e) = result {
            eprintln!("❌ Failed to log trade: {}", e);
        } else {
            println!("📝 DB LOG: {} {} @ {}", direction, self.mint, price);
        }
    }

    async fn abort_monitoring(&self, reason: &str, status: &str, price: f64) {
        let client = match self.db_pool.get().await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("❌ Failed to get DB client for abort: {}", e);
                return;
            }
        };

        // 1. DELETE from target_queue
        let _ = client.execute("DELETE FROM target_queue WHERE mint_address = $1", &[&self.mint]).await;

        // 2. INSERT into rejected_targets
        let query = format!(
            "INSERT INTO rejected_targets (mint_address, rejection_reason, initial_price, current_status, rejected_at) 
             VALUES ($1, $2, $3, '{}', NOW()) 
             ON CONFLICT (mint_address) DO UPDATE SET rejection_reason = $2, current_status = '{}'",
             status, status
        );
        
        if let Err(e) = client.execute(&query, &[&self.mint, &reason, &price]).await {
            eprintln!("❌ Failed to log abort to DB: {}", e);
        } else {
            println!("💀 [{}] Monitor terminated ({}): {}", &self.mint[..8], status, reason);
        }
    }

    async fn log_momentum_rejection(&self, price: f64, buy_vol: f64, sell_vol: f64) {
        let client = match self.db_pool.get().await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("❌ DB Error: {}", e);
                return;
            }
        };

        let reason = format!("REJECTED_NO_MOMENTUM (Buy: {:.2} SOL / Sell: {:.2} SOL)", buy_vol, sell_vol);

        // 1. DELETE from target_queue
        let _ = client.execute("DELETE FROM target_queue WHERE mint_address = $1", &[&self.mint]).await;

        // 2. INSERT into rejected_targets with the new status
        let query = "
            INSERT INTO rejected_targets (mint_address, rejection_reason, initial_price, current_status, rejected_at) 
            VALUES ($1, $2, $3, 'REJECTED_NO_MOMENTUM', NOW()) 
            ON CONFLICT (mint_address) DO UPDATE SET rejection_reason = $2, current_status = 'REJECTED_NO_MOMENTUM'
        ";
        
        if let Err(e) = client.execute(query, &[&self.mint, &reason, &price]).await {
            eprintln!("❌ Failed to log momentum rejection: {}", e);
        } else {
            println!("🛑 [{}] MOMENTUM GUARD: Rejected Zombie Trade. Ratio: {:.2}x", &self.mint[..8], buy_vol / (sell_vol + 0.0001));
        }
    }

    pub async fn run(&mut self) {
        let mut msg_count: u64 = 0;
        let mut retry_count = 0;
        let max_retries = 3;
        let hard_ttl = Duration::from_secs(3600); // 60 Minutes

        while self.monitoring_start.elapsed() < hard_ttl && retry_count < max_retries {
            let wss_url = format!(
                "wss://mainnet.helius-rpc.com/?api-key={}",
                self.helius_key
            );

            if retry_count > 0 {
                println!("🔄 [{}] Reconnecting (Attempt {}/{})...", &self.mint[..8], retry_count, max_retries);
                tokio::time::sleep(Duration::from_secs(2u64.pow(retry_count))).await;
            }

            match connect_async(&wss_url).await {
                Ok((ws_stream, _)) => {
                    let (mut write, mut read) = ws_stream.split();

                    let subscribe_msg = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "accountSubscribe",
                        "params": [
                            self.pool_address,
                            {"encoding": "base64", "commitment": "processed"}
                        ]
                    });

                    if let Err(e) = write.send(Message::Text(subscribe_msg.to_string())).await {
                        eprintln!("❌ Failed to send subscription for {}: {}", &self.mint[..8], e);
                        retry_count += 1;
                        continue;
                    }

                    println!("✅ [{}] Monitoring active. (Connection #{})", &self.mint[..8], retry_count + 1);

                    while let Some(msg) = read.next().await {
                        if self.monitoring_start.elapsed() > hard_ttl { 
                            if self.entry_price.is_none() {
                                self.abort_monitoring("5m TTL Expired", "EVICTED_TTL", 0.0).await;
                                return;
                            }
                            break; 
                        }

                        let text = match msg {
                            Ok(Message::Text(t)) => t,
                            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => continue,
                            Ok(other) => {
                                if msg_count < 3 { println!("⚠️ [{}] Non-text: {:?}", &self.mint[..8], other); }
                                continue;
                            }
                            Err(e) => {
                                eprintln!("❌ [{}] WSS loop error: {}", &self.mint[..8], e);
                                break; // Break WSS loop to trigger reconnect
                            }
                        };

                        msg_count += 1;

                        if text.contains("\"result\"") && text.contains("\"id\"") && !text.contains("\"method\"") {
                            println!("📡 [{}] Subscription confirmed.", &self.mint[..8]);
                            continue;
                        }

                        let update: HeliusAccountUpdate = match serde_json::from_str(&text) {
                            Ok(u) => u,
                            Err(e) => {
                                if msg_count <= 5 {
                                    let preview = if text.len() > 100 { &text[..100] } else { &text };
                                    eprintln!("⚠️ [{}] Parse fail: {} | Preview: {}", &self.mint[..8], e, preview);
                                }
                                continue;
                            }
                        };

                        let reserves = if update.params.result.value.owner == PUMP_FUN_PROGRAM {
                            decode_pump_reserves(&update)
                        } else if update.params.result.value.owner == RAYDIUM_V4 {
                            decode_pool_reserves(&update)
                        } else {
                            if msg_count <= 5 { println!("⚠️ [{}] Unknown owner: {}", &self.mint[..8], update.params.result.value.owner); }
                            None
                        };

                        let Some((sol_reserve, token_reserve)) = reserves else {
                            if msg_count <= 5 {
                                let data_len = update.params.result.value.data.get(0).map(|d| d.len()).unwrap_or(0);
                                eprintln!("⚠️ [{}] Reserve decode fail (msg #{}). Data length: {} bytes, owner: {}", 
                                    &self.mint[..8], msg_count, data_len, update.params.result.value.owner);
                            }
                            continue;
                        };

                        let price = Self::calculate_price(sol_reserve, token_reserve);
                        let now = Instant::now();

                        if self.initial_discovery_price.is_none() {
                            self.initial_discovery_price = Some(price);
                            println!("🏁 [DISCOVERY] {} baseline: {:.10} SOL", &self.mint[..8], price);
                        }

                        // --- MOMENTUM ACCUMULATION ---
                        if self.recovery_watch_started.is_some() {
                            if let Some(prev) = self.price_history.last() {
                                let sol_delta = sol_reserve - prev._sol_reserve;
                                if sol_delta > 0.0 {
                                    self.accumulated_buy_sol += sol_delta;
                                } else if sol_delta < 0.0 {
                                    self.accumulated_sell_sol += sol_delta.abs();
                                }
                            }
                        }

                        if let Some(initial) = self.initial_discovery_price {
                            if price < (initial * 0.1) && self.entry_price.is_none() {
                                self.abort_monitoring("[POST_FILTER_RUG] Price Crash > 90%", "RUGGED", price).await;
                                return; 
                            }

                            // --- EVICTION 1: STAGNATION GUARD ---
                            // If price hasn't moved +/- 0.5% in 60s
                            let price_change = (price - initial).abs() / initial;
                            if price_change > 0.005 {
                                self.last_meaningful_change = now;
                            } else if now.duration_since(self.last_meaningful_change) > Duration::from_secs(60) && self.entry_price.is_none() {
                                self.abort_monitoring("Stagnant Price (+/- 0.5% for 60s)", "EVICTED_STAGNANT", price).await;
                                return;
                            }

                            // --- EVICTION 2: GHOST TOWN FILTER ---
                            // If total volume (Buys + Sells) < 3 SOL after 5m scan
                            let total_volume = self.accumulated_buy_sol + self.accumulated_sell_sol;
                            if self.monitoring_start.elapsed() > Duration::from_secs(240) && total_volume < 3.0 && self.entry_price.is_none() {
                                self.abort_monitoring("Low Volume Cluster (< 3 SOL)", "EVICTED_LOW_VOLUME", price).await;
                                return;
                            }

                            // --- EVICTION 3: SWEPT GATE ---
                            // If price (as MC) falls below 85% of holder_avg_buy
                            let current_mc = price * 1_000_000_000.0;
                            if current_mc < (self.holder_avg_buy * 0.85) && self.entry_price.is_none() {
                                self.abort_monitoring("Price below 85% Holder Avg (SWEPT)", "EVICTED_SWEPT", price).await;
                                return;
                            }
                        }

                        let point = PricePoint {
                            _slot: update.params.result.context.slot,
                            _sol_reserve: sol_reserve,
                            _token_reserve: token_reserve,
                            price,
                            timestamp: now,
                        };

                        let vpc = self.calculate_vpc(price, now).unwrap_or(0.0);
                        self.price_history.push(point);
                        if self.price_history.len() > 300 { self.price_history.remove(0); }

                        if self.price_history.len() % 20 == 0 {
                            println!("[{}] Price: {:.10} SOL | VPC: {:.4}%/s", &self.mint[..8], price, vpc);
                        }

                        // --- PHASE 1: SCANNING -> RECOVERY WATCH ---
                        if self.entry_price.is_none() && self.recovery_watch_started.is_none() && self.check_entry_signal(price, vpc) {
                            println!("🚨 [{}] DUMP DETECTED (VPC: {:.4}%/s). Entering 10s MOMENTUM WATCH...", &self.mint[..8], vpc);
                            self.recovery_watch_started = Some(Instant::now());
                            self.accumulated_buy_sol = 0.0;
                            self.accumulated_sell_sol = 0.0;
                        }

                        // --- PHASE 2: RECOVERY WATCH -> EVALUATION ---
                        if let Some(trigger_time) = self.recovery_watch_started {
                            let elapsed = trigger_time.elapsed();
                            
                            if elapsed >= Duration::from_secs(10) {
                                let ratio = self.accumulated_buy_sol / (self.accumulated_sell_sol + 0.000001);
                                
                                if ratio >= 1.5 {
                                    println!("⚡ [{}] MOMENTUM VALIDATED (Ratio: {:.2}x). Executing BUY...", &self.mint[..8], ratio);
                                    let tokens_received = self.simulate_buy(self.position_size_sol, sol_reserve, token_reserve);
                                    let actual_price = self.position_size_sol / tokens_received;
                                    self.log_trade("BUY", actual_price, self.position_size_sol, tokens_received, None).await;
                                    self.entry_price = Some(actual_price);
                                    self.recovery_watch_started = None; // Transition to Holding
                                } else {
                                    self.log_momentum_rejection(price, self.accumulated_buy_sol, self.accumulated_sell_sol).await;
                                    return; // Reject and stop monitoring
                                }
                            }
                        }

                        // --- PHASE 3: HOLDING -> EXIT ---
                        if let Some(entry) = self.entry_price {
                            if let Some(exit_reason) = self.check_exit_signal(price) {
                                let tokens_held = self.position_size_sol / entry;
                                let sol_received = self.simulate_sell(tokens_held, sol_reserve, token_reserve);
                                let pnl_pct = (sol_received - self.position_size_sol) / self.position_size_sol * 100.0;
                                self.log_trade("SELL", price, sol_received, tokens_held, Some(pnl_pct)).await;
                                println!("🏁 [{}] GHOST SELL ({}): {:.4} SOL | PnL: {:.2}%", &self.mint[..8], exit_reason, sol_received, pnl_pct);
                                return; // Complete monitoring after sell
                            }
                        }
                    }
                    
                    // If we get here, the loop ended (likely error or max_duration)
                    // Reset retry_count if we were connected for a significant time
                    if self.monitoring_start.elapsed() > Duration::from_secs(30) {
                        retry_count = 0;
                    } else {
                        retry_count += 1;
                    }
                },
                Err(e) => {
                    eprintln!("❌ Failed to connect to Helius for {}: {}", &self.mint[..8], e);
                    retry_count += 1;
                }
            }
        }
        println!("🔚 [{}] Monitor ended. {} total msgs.", &self.mint[..8], msg_count);
    }
}

// --- Data Structures for Helius ---
// #[allow(dead_code)] silences warnings for fields we parse but don't read yet

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct HeliusAccountUpdate {
    jsonrpc: String,
    method: String,
    params: HeliusParams,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct HeliusParams {
    result: HeliusResult,
    subscription: u64,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct HeliusResult {
    context: HeliusContext,
    value: HeliusValue,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct HeliusContext {
    slot: u64,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct HeliusValue {
    data: Vec<String>,
    lamports: u64,
    owner: String,
}

fn decode_pool_reserves(update: &HeliusAccountUpdate) -> Option<(f64, f64)> {
    if update.params.result.value.owner != RAYDIUM_V4 { return None; }

    let base64_data = update.params.result.value.data.get(0)?;
    
    // CORRECTED BASE64 DECODE FOR v0.21+
    let bytes = general_purpose::STANDARD.decode(base64_data).ok()?;

    if bytes.len() < 160 { return None; }

    let sol_reserve = u64::from_le_bytes([
        bytes[144], bytes[145], bytes[146], bytes[147],
        bytes[148], bytes[149], bytes[150], bytes[151],
    ]) as f64 / 1_000_000_000.0; 

    let token_reserve = u64::from_le_bytes([
        bytes[152], bytes[153], bytes[154], bytes[155],
        bytes[156], bytes[157], bytes[158], bytes[159],
    ]) as f64 / 1_000_000.0;

    Some((sol_reserve, token_reserve))
}
fn decode_pump_reserves(update: &HeliusAccountUpdate) -> Option<(f64, f64)> {
    if update.params.result.value.owner != PUMP_FUN_PROGRAM { return None; }

    let base64_data = update.params.result.value.data.get(0)?;
    let bytes = general_purpose::STANDARD.decode(base64_data).ok()?;

    if bytes.len() < 40 { return None; }

    // Pump.fun layout:
    // 8: virtualTokenReserves (u64)
    // 16: virtualSolReserves (u64)
    
    let token_reserve = u64::from_le_bytes([
        bytes[8], bytes[9], bytes[10], bytes[11],
        bytes[12], bytes[13], bytes[14], bytes[15],
    ]) as f64 / 1_000_000.0;

    let sol_reserve = u64::from_le_bytes([
        bytes[16], bytes[17], bytes[18], bytes[19],
        bytes[20], bytes[21], bytes[22], bytes[23],
    ]) as f64 / 1_000_000_000.0;

    Some((sol_reserve, token_reserve))
}
