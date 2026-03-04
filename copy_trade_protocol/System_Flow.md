# CopyTrade Protocol: System Flow (Redis Watchlist Bridge)

The `copy_trade_protocol` leverages a high-speed Redis bridge to connect asynchronous liveness data (Scout) with real-time trade signals (Watcher).

## 🛰️ The Data Bridge

```mermaid
graph TD
    subgraph "Scout (The Detective)"
        A[Solana Logs] --> B{Source Match?}
        B -- "CEX Hot Wallet" --> C{Fresh Wallet?}
        C -- "Age < 24h" --> D[Redis SET watchlist:addr CEX_ID EX 30m]
    end

    subgraph "Watcher (The Handoff)"
        E[PumpPortal Trade] --> F{Check Redis}
        F -- "EXISTS watchlist:trader" --> G[Get CEX_ID]
        G --> H[PUBLISH copy_trade_triggers TargetPayload]
    end

    subgraph "Sniper (The Assassin)"
        H --> I[Market Buy 1.0 SOL]
        I --> J[Sleep 60s]
        J --> K[Market Sell / Close]
        K --> L[Log to DB: copy_trade_trades]
    end

    Redis[(Redis Watchlist Cache)]
    D -.-> Redis
    Redis -.-> F
```

## 🧠 Core Component Logic

### 1. CopyTrade Scout
- **Detection**: Watches for `Transfer` instructions originating from known Binance, OKX, and Coinbase hot wallets.
- **Filtering**: If the destination wallet has very few transactions or was created recently, it is marked as a "Potential CopyTrade."
- **TTL Cache**: The wallet is stored in Redis for **30 minutes**. CopyTrade trades typically occur very shortly after funding.

### 2. CopyTrade Watcher
- **Throughput**: Watches every single PumpPortal trade.
- **Latency**: Performs an O(1) Redis lookup for every `trader` address.
- **State**: Does not maintain internal state of who is an copy_trade; relies entirely on the distributed Redis cache.

### 3. CopyTrade Sniper
- **Execution**: Receives a payload containing the `mint` and the `copy_trade_wallet`.
- **Transparency**: Every trade recorded in the database is tagged with the `funding_source` (e.g., `BINANCE_HOT_WALLET_4`), allowing us to audit which CEX flows are most profitable.

🏁 house on the moon
