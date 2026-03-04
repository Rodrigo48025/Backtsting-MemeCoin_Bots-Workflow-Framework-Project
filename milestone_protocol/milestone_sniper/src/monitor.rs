use futures_util::{SinkExt, StreamExt, self};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use serde::Deserialize;
use std::time::{Duration, Instant};
use deadpool_postgres::Pool;
use chrono::Utc;
use base64::{Engine as _, engine::general_purpose};
use futures_util::stream::{SplitSink, SplitStream};
use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

#[derive(Debug, Clone)]
pub struct PricePoint {
    pub _slot: u64,
    pub price: f64,
    pub timestamp: Instant,
}

pub struct TokenMonitor {
    mint: String,
    pool_address: String,
    helius_key: String,
    db_pool: Pool,
    price_history: Vec<PricePoint>,
    entry_price: Option<f64>,
    last_known_price: Option<f64>,
    position_size_sol: f64,
    monitoring_start: Instant,
    launch_time: chrono::DateTime<chrono::Utc>,
    trigger_rx: tokio::sync::mpsc::UnboundedReceiver<f64>,
    panic_rx: tokio::sync::broadcast::Receiver<()>,
}

impl TokenMonitor {
    pub fn new(
        mint: String, 
        pool_address: String, 
        helius_key: String, 
        db_pool: Pool, 
        _holder_avg_buy: f64, 
        launch_time: chrono::DateTime<chrono::Utc>,
        trigger_rx: tokio::sync::mpsc::UnboundedReceiver<f64>,
        panic_rx: tokio::sync::broadcast::Receiver<()>,
    ) -> Self {
        Self {
            mint,
            pool_address,
            helius_key,
            db_pool,
            price_history: Vec::with_capacity(100),
            entry_price: None,
            last_known_price: None,
            position_size_sol: 0.1, // 3-TIER: 0.1 SOL Entry
            monitoring_start: Instant::now(),
            launch_time,
            trigger_rx,
            panic_rx,
        }
    }

    async fn execute_buy_transaction(&self, price: f64) -> bool {
        let mut client = match self.db_pool.get().await {
            Ok(c) => c,
            Err(_) => return false,
        };

        let tx = match client.transaction().await {
            Ok(t) => t,
            Err(e) => { eprintln!("❌ TX Start Error: {}", e); return false; }
        };

        // 1. Atomic Deduction
        let deduct_query = "UPDATE paper_wallets SET balance_sol = balance_sol - $1 WHERE balance_sol >= $1 RETURNING balance_sol";
        let deduction: f64 = match tx.query_opt(deduct_query, &[&self.position_size_sol]).await {
            Ok(Some(row)) => row.get(0),
            Ok(None) => { println!("⚠️ [SNIPER] Insufficient balance for {} ", &self.mint[..8]); return false; },
            Err(e) => { eprintln!("❌ Deduction Error: {}", e); return false; }
        };

        // 2. Log Trade
        let log_query = "INSERT INTO virtual_trades (token_mint, direction, entry_timestamp, entry_price, entry_sol_amount, pnl_percentage, status, wallet_impact_sol, discovery_timestamp) 
                         VALUES ($1, 'BUY', NOW(), $2, $3, 0.0, 'OPEN', $4, $5)";
        let wallet_impact = -self.position_size_sol;
        let _ = tx.execute(log_query, &[&self.mint, &price, &self.position_size_sol, &wallet_impact, &self.launch_time]).await;

        if let Err(e) = tx.commit().await {
            eprintln!("❌ TX Commit Error: {}", e);
            return false;
        }

        println!("🎯 [SNIPED] {} @ {} | Balance: {:.2} SOL", &self.mint[..8], price, deduction);
        true
    }

    async fn execute_sell_transaction(&self, price: f64, sol_received: f64, pnl_pct: f64) -> bool {
        let mut client = match self.db_pool.get().await {
            Ok(c) => c,
            Err(_) => return false,
        };

        let tx = match client.transaction().await {
            Ok(t) => t,
            Err(e) => { eprintln!("❌ TX Start Error: {}", e); return false; }
        };

        let log_query = "UPDATE virtual_trades 
                         SET exit_price = $1, 
                             exit_timestamp = NOW(), 
                             pnl_percentage = $2, 
                             pnl_sol = $3, 
                             status = 'CLOSED',
                             wallet_impact_sol = $4
                         WHERE token_mint = $5 AND status = 'OPEN'";
        let pnl_sol = sol_received - self.position_size_sol;
        let _ = tx.execute(log_query, &[&price, &pnl_pct, &pnl_sol, &sol_received, &self.mint]).await;

        let credit_query = "UPDATE paper_wallets SET balance_sol = balance_sol + $1, last_updated = NOW()";
        let _ = tx.execute(credit_query, &[&sol_received]).await;

        if let Err(e) = tx.commit().await {
            eprintln!("❌ TX Commit Error: {}", e);
            return false;
        }

        println!("🏁 [EXIT] {} | Credited: {:.2} SOL | PnL: {:.1}%", &self.mint[..8], sol_received, pnl_pct);
        true
    }

    async fn abort_monitoring(&self, reason: &str, status: &str) {
        let client = match self.db_pool.get().await {
            Ok(c) => c,
            Err(_) => return,
        };
        let _ = client.execute("DELETE FROM target_queue WHERE mint_address = $1", &[&self.mint]).await;
        println!("💀 [{}] Monitor closed ({}): {}", &self.mint[..8], status, reason);
    }

    fn simulate_sell(&self, tokens_in: f64, sol_reserve: f64, token_reserve: f64) -> f64 {
        let k = sol_reserve * token_reserve;
        let new_token_reserve = token_reserve + tokens_in;
        let new_sol_reserve = k / new_token_reserve;
        let sol_out = sol_reserve - new_sol_reserve;
        sol_out * 0.9975
    }

    async fn update_pnl_in_db(&self, current_price: f64, last_pnl_update: &mut Instant) {
        if let Some(entry) = self.entry_price {
            let pnl_pct = (current_price - entry) / entry * 100.0;
            
            // 📊 LIVE PNL UPDATE (Throttled 10s)
            if last_pnl_update.elapsed() >= Duration::from_secs(10) {
                if let Ok(client) = self.db_pool.get().await {
                    let _ = client.execute(
                        "UPDATE virtual_trades SET pnl_percentage = $1 WHERE token_mint = $2 AND status = 'OPEN'",
                        &[&pnl_pct, &self.mint]
                    ).await;
                    *last_pnl_update = Instant::now();
                }
            }
        }
    }

    pub async fn run(&mut self) {
        // 3-TIER: 5-minute Lifecycle Timer (from Scout discovery)
        let total_ttl = Duration::from_secs(300); 
        let current_age = Utc::now().signed_duration_since(self.launch_time).to_std().unwrap_or(Duration::from_secs(0));
        
        if current_age >= total_ttl {
            println!("🚫 [SNIPER] Skipping {}. Already expired ({}s old).", &self.mint[..8], current_age.as_secs());
            return;
        }

        let remaining_ttl = total_ttl - current_age;
        let mut wss_active = false;

        println!("⚡ [SNIPER] [{}] Monitoring for Entry Milestone (TTL: {}s)...", &self.mint[..8], remaining_ttl.as_secs());
        
        let wss_url = format!("wss://mainnet.helius-rpc.com/?api-key={}", self.helius_key);
        let mut write: Option<SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>> = None;
        let mut read: Option<SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>> = None;

        if let Ok((ws_stream, _)) = connect_async(&wss_url).await {
            wss_active = true;
            let (w, r) = ws_stream.split();
            write = Some(w);
            read = Some(r);
            // Subscribe
            if let Some(ref mut w) = write {
                let sub = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"accountSubscribe","params":[self.pool_address,{"encoding":"base64","commitment":"processed"}]});
                let _ = w.send(Message::Text(sub.to_string())).await;
            }
        }

        // PHASE 1: WAIT FOR WATCHER TRIGGER
        let mut trigger_mc = 0.0;
        tokio::select! {
            _ = self.panic_rx.recv() => {
                self.abort_monitoring("User Panic Sell", "PANIC_ABORT").await;
                return;
            },
            res = self.trigger_rx.recv() => {
                match res {
                    Some(mc) => trigger_mc = mc,
                    None => return,
                }
            },
            _ = tokio::time::sleep(remaining_ttl) => {
                self.abort_monitoring("5m TTL Expired in Watch", "EVICTED_TTL").await;
                return;
            }
        }

        // PHASE 2: EXECUTE 1 SOL SNIPE
        // Simple price derivation: MC (SOL) / 1B tokens
        let fallback_price = trigger_mc / 1_000_000_000.0;
        if self.execute_buy_transaction(fallback_price).await {
            self.entry_price = Some(fallback_price);
        } else {
            return;
        }

        // PHASE 3: MONITOR FOR EXIT (TP/SL/TTL)
        let snipe_time = Instant::now();
        let mut last_pnl_update = Instant::now();

        while snipe_time.elapsed() < remaining_ttl {
            let msg = tokio::select! {
                p = self.trigger_rx.recv() => {
                    if let Some(mc) = p {
                        let current_price = mc / 1_000_000_000.0;
                        self.last_known_price = Some(current_price);
                        self.update_pnl_in_db(current_price, &mut last_pnl_update).await;

                        // TP/SL CHECK on PumpPortal feed
                        if let Some(entry) = self.entry_price {
                            let pnl_pct = (current_price - entry) / entry * 100.0;
                        if pnl_pct >= 40.0 {
                            println!("🚀 [TP_HIT] {} | PnL: {:.1}% | Selling NOW", &self.mint[..8], pnl_pct);
                            let tokens_held = self.position_size_sol / entry;
                            let sol_received = tokens_held * current_price * 0.99; // 1% slippage
                            let final_pnl = (sol_received - self.position_size_sol) / self.position_size_sol * 100.0;
                            self.execute_sell_transaction(current_price, sol_received, final_pnl).await;
                            return;
                        } else if pnl_pct <= -20.0 {
                            println!("🛑 [SL_HIT] {} | PnL: {:.1}% | Cutting loss", &self.mint[..8], pnl_pct);
                            let tokens_held = self.position_size_sol / entry;
                            let sol_received = tokens_held * current_price * 0.99;
                            let final_pnl = (sol_received - self.position_size_sol) / self.position_size_sol * 100.0;
                            self.execute_sell_transaction(current_price, sol_received, final_pnl).await;
                            return;
                        }
                        }
                    }
                    None
                },
                m = async {
                    if let Some(ref mut r) = read { r.next().await } else { std::future::pending().await }
                } => m,
                _ = self.panic_rx.recv() => break, // Panic exit
                _ = tokio::time::sleep(Duration::from_secs(10)) => None,
            };

            if let Some(Ok(Message::Text(text))) = msg {
                // Skip subscription confirmation messages (contain "result" but no "params")
                if text.contains("\"result\"") && !text.contains("\"params\"") { continue; }

                let update: HeliusAccountUpdate = match serde_json::from_str(&text) {
                    Ok(u) => u,
                    Err(_) => continue,
                };

                let reserves = if update.params.result.value.owner == "6EF8rrecthR5DkZJ4NsuA5EBxc69m6tshv77pudCpump" {
                    decode_pump_reserves(&update)
                } else { None };

                if let Some((sol_reserve, token_reserve)) = reserves {
                    let current_price = sol_reserve / token_reserve;
                    self.last_known_price = Some(current_price);
                    self.update_pnl_in_db(current_price, &mut last_pnl_update).await;

                    // EXIT CONDITIONS
                    if let Some(entry) = self.entry_price {
                        let pnl_pct = (current_price - entry) / entry * 100.0;
                        if pnl_pct >= 40.0 || pnl_pct <= -20.0 {
                            let tokens_held = self.position_size_sol / entry;
                            let sol_received = self.simulate_sell(tokens_held, sol_reserve, token_reserve);
                            let final_pnl = (sol_received - self.position_size_sol) / self.position_size_sol * 100.0;
                            
                            if self.execute_sell_transaction(current_price, sol_received, final_pnl).await {
                                return;
                            }
                        }
                    }
                }
            }
        }

        // FINAL TTL EXIT
        if let Some(entry) = self.entry_price {
            let sell_price = self.last_known_price.unwrap_or(entry);
            let tokens_held = self.position_size_sol / entry;
            let sol_received = tokens_held * sell_price * 0.99;
            let final_pnl = (sol_received - self.position_size_sol) / self.position_size_sol * 100.0;
            println!("🏁 [TTL_EXIT] {} | Last Price: {} | PnL: {:.1}%", &self.mint[..8], sell_price, final_pnl);
            self.execute_sell_transaction(sell_price, sol_received, final_pnl).await;
        }
    }
}

#[derive(Debug, Deserialize)]
struct HeliusAccountUpdate {
    params: HeliusParams,
}
#[derive(Debug, Deserialize)]
struct HeliusParams {
    result: HeliusResult,
}
#[derive(Debug, Deserialize)]
struct HeliusResult {
    value: HeliusValue,
}
#[derive(Debug, Deserialize)]
struct HeliusValue {
    data: Vec<String>,
    owner: String,
}

fn decode_pump_reserves(update: &HeliusAccountUpdate) -> Option<(f64, f64)> {
    let base64_data = update.params.result.value.data.get(0)?;
    let bytes = general_purpose::STANDARD.decode(base64_data).ok()?;
    if bytes.len() < 40 { return None; }
    let token = u64::from_le_bytes([bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]]) as f64 / 1_000_000.0;
    let sol = u64::from_le_bytes([bytes[16],bytes[17],bytes[18],bytes[19],bytes[20],bytes[21],bytes[22],bytes[23]]) as f64 / 1_000_000_000.0;
    Some((sol, token))
}
// house on the moon
