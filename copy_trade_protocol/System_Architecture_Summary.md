# System Architecture Summary: CopyTrade Protocol

## THE FLOW

The transition from a CEX withdrawal to a simulated trade happens via three decoupled Rust services communicating through Redis:

1. **`copy_trade_scout` (The Detective)**:
   - Connects to Solana network via Helius WSS (`logsSubscribe` for system programs).
   - Monitors for `Transfer` instructions originating from a known list of central exchange hot wallets (`CEX_WATCHLIST`).
   - *Heuristic*: Checks if the destination address is a "fresh wallet" (less than 10 total transaction signatures).
   - If fresh, writes the destination address to Redis under the key `watchlist:<address>` with a 30-minute Time-To-Live (TTL).

2. **`copy_trade_watcher` (The Matcher)**:
   - Connects to PumpPortal's WebSocket API (`wss://pumpportal.fun/api/data`) subscribing to all new token trades.
   - For every trade, it queries Redis for `watchlist:<traderPublicKey>`.
   - If a match is found, it confirms an "copy_trade" is trading and publishes a JSON payload (containing `mint`, `copy_trade_address`, `funding_source`) to the Redis Pub/Sub channel `copy_trade_triggers`.

3. **`copy_trade_sniper` (The Assassin)**:
   - Subscribes to the `copy_trade_triggers` Redis channel.
   - Upon receiving a trigger, executes a paper trade by connecting to PostgreSQL (`copy_trade_db`).
   - Deducts exactly 1.0 SOL from `paper_wallets` for the `COPY_TRADE_MAIN_WAREHOUSE`.
   - Logs the position in the `copy_trade_trades` table with an 'OPEN' status and a mock entry price of `0.00000001`.
   - Holds the position for exactly 60 seconds (`sleep`).
   - Closes the position with a mock 10% gain, updating the row to 'CLOSED' and crediting the `paper_wallets` balance.

## THE STATE

**Current Status:** Paralyzed / Offline.

- **Infrastructure**: Analysis of `docker ps` and `docker compose logs` indicates that all corresponding containers (`copy_trade_db`, `copy_trade_redis`, `copy_trade_scout`, `copy_trade_watcher`, `copy_trade_sniper`) cleanly shut down around 16:16 UTC. 
- **Data State**: Redis and PostgreSQL are not running, making the system "Blind" to new events and "Paralyzed" regarding trades. No logs exist for the last 5 minutes as the services have been offline. 

## THE GAPS

A read-only scan reveals the following missing logic, mocked implementations, and systemic gaps:

1. **Trench Parameters Are Mocked / Missing**:
   - **Entry MC (Market Cap)**: `copy_trade_watcher` receives `vSolInBondingCurve` from PumpPortal, but does not use it to filter trades. The sniper buys regardless of market cap.
   - **Exit TTL**: Hardcoded to 60 seconds (`sleep`). It blocks a parallel async thread but lacks dynamic exit logic or market-driven conditions.
   - **TP / SL (Take Profit / Stop Loss)**: Completely absent. Positional exits unconditionally mock a 10% gain (`exit_price = entry_price * 1.1`).
   
2. **CEX-to-Sniper Hop Count Is Fixed at 1**:
   - The system is completely blind to multi-hop wallet laundering. `copy_trade_scout` only identifies wallets that receive funds *directly* from the CEX (`keys[0] = CEX`, `keys[1] = destination`). If the copy_trade uses an intermediary wallet, they bypass detection.

3. **Incomplete Paper Trading Logic**:
   - The sniper relies on absolute mock data (`0.00000001` entry price). Real token prices and actual slippage are never validated or recorded.
   - Only deductive logging occurs; no actual transaction signing or on-chain execution payload format exists.

4. **Missing Deduplication (Sniper)**:
   - If an copy_trade buys the same token twice within a few seconds, the sniper attempts multiple overlapping inserts and deductions.

*No changes have been made to the repository. Awaiting approval to proceed.*
