# Dashboard Analysis & Inconsistencies

Based on the forensic depth and dynamic pricing modifications implemented in the `insider_protocol` back-end, the provided dashboard image exhibits several distinct inconsistencies and disconnected UI states:

## 1. Static vs. Dynamic PnL (INSIDER_FLOW)
- **Visual State**: The active trades currently show an `INSIDER_FLOW` of **+0.0%**.
- **Backend Reality**: The Sniper now operates on an active simulated price loop that fluctuates based on a random walk up to +100% TP or -30% SL. The dashboard is failing to poll or display this live PnL fluctuation, potentially because it is looking for the old static metrics.

### Proposed Fixes
- **Root Cause**: The `pnl_percentage` column in `insider_trades` is only updated on exit (`status = 'CLOSED'`). While a trade has `status = 'OPEN'`, its `pnl_percentage` remains at default `0.0`.
- **Fix A (Backend - Recommended)**: In the Sniper's monitoring loop (`insider_sniper/src/main.rs`), add a periodic DB update that writes the current `pnl_percentage` to the row every loop iteration (every 5 seconds). This turns the `pnl_percentage` column into a live-updating metric.
  ```sql
  UPDATE insider_trades SET pnl_percentage = $1 WHERE token_mint = $2 AND status = 'OPEN'
  ```
- **Fix B (Frontend)**: In `insider-exposure-table.tsx`, the `pnl` is read as `parseFloat(t.pnl_percentage || 0)`. This works correctly once Fix A ensures the value is live-updated in the DB.

---

## 2. Broken Time-To-Live (MICRO_TTL)
- **Visual State**: The `MICRO_TTL` column under active trades shows lightning bolts next to **0s** (or possibly hardcoded/stuck countdowns).
- **Backend Reality**: The strict 60-second `sleep()` was removed in Phase 3. The new Hard-TTL is **1200 seconds (20 minutes)**. The UI is likely failing to parse the new loop conditions or is hardcoded to the old 60-second expectation.

### Proposed Fixes
- **Root Cause**: In `insider-exposure-table.tsx`, the `calculateRemaining` function hardcodes `const TOTAL_TTL = 60;`. Since trades now hold for up to 1200 seconds, the countdown expires to `0s` almost immediately.
- **Fix**: In `insider-exposure-table.tsx`, change `TOTAL_TTL` from `60` to `1200`.
  ```diff
  -    const TOTAL_TTL = 60; // Insider Micro-Trade: 60s
  +    const TOTAL_TTL = 1200; // Insider Trench-Trade: 20 min Hard-TTL
  ```
- **Fix (Label)**: In `insider-stats.tsx`, the `Micro_Sleep` card displays a hardcoded `60s` label. Change it to `20m` to reflect the new TTL.
  ```diff
  -    <span className="text-[8px] text-zinc-500 ml-1 uppercase">60s</span>
  +    <span className="text-[8px] text-zinc-500 ml-1 uppercase">20m</span>
  ```

---

## 3. The "ONLINE" vs. "LAST_PING" Contradiction
- **Visual State**: The Bot Brain cards for Scout, Watcher, and Sniper proudly display a status of **ONLINE**. However, their `LAST_PING` all read **18m ago**.
- **Backend Reality**: A service that hasn't pinged in 18 minutes should be marked as OFFLINE or UNRESPONSIVE. The frontend UI status state seems decoupled from the actual ping telemetry.

### Proposed Fixes
- **Root Cause**: In `insider-data.ts`, `getInsiderBotStatus()` determines `containerStatus` purely from `docker inspect` (running = ONLINE). The `lastTimestamp` is parsed from log lines. These two metrics are independent — a container can be "running" but have no recent log output (e.g., the Scout is idle waiting for a CEX transfer).
- **Fix A (Server Action)**: In `getInsiderBotStatus()` in `insider-data.ts`, add a staleness check after determining `containerStatus`:
  ```typescript
  if (containerStatus === "ONLINE" && lastTimestamp) {
      const diffMs = Date.now() - new Date(lastTimestamp + "Z").getTime();
      if (diffMs > 5 * 60 * 1000) { // 5 minutes stale
          containerStatus = "STALE";
      }
  }
  ```
- **Fix B (UI)**: In `insider-bot-brain.tsx`, add a `STALE` entry to `STATUS_STYLES`:
  ```typescript
  STALE: "text-amber-500 bg-amber-900/20 border-amber-500/30",
  ```

---

## 4. Aggregate Metrics (Trades / Net Return / Winrate)
- **Visual State**: `TRADES` sits at **32**, but `NET_RETURN` is **+0.0%** and `WINRATE` is **0%**.
- **Backend Reality**: Even with the original prototype logic (which yielded a strict +10% gain on simulated trades), 32 trades should not yield a zero net return unless the database metrics calculation is completely broken or looking at the wrong column/status.

### Proposed Fixes
- **Root Cause**: The SQL query in `getInsiderDashboardData()` in `insider-data.ts` counts ALL trades (including OPEN ones with `pnl_percentage = 0.0` default). Since the `SUM` and `AVG` include these zero-PnL open trades, they dilute the metrics towards zero. Additionally, the `wins` filter (`pnl_percentage > 0`) fails for OPEN trades whose PnL hasn't been updated yet.
- **Fix (SQL Query)**: Filter aggregate metrics to only CLOSED trades:
  ```diff
  -    COUNT(*) as total_trades,
  -    COUNT(*) FILTER (WHERE pnl_percentage > 0) as wins,
  -    COALESCE(SUM(pnl_percentage), 0) as net_pnl,
  -    COALESCE(AVG(pnl_percentage), 0) as avg_pnl,
  -    COUNT(*) FILTER (WHERE status = 'OPEN') as active_trades
  -FROM insider_trades
  +    COUNT(*) as total_trades,
  +    COUNT(*) FILTER (WHERE pnl_percentage > 0 AND status = 'CLOSED') as wins,
  +    COALESCE(SUM(pnl_percentage) FILTER (WHERE status = 'CLOSED'), 0) as net_pnl,
  +    COALESCE(AVG(pnl_percentage) FILTER (WHERE status = 'CLOSED'), 0) as avg_pnl,
  +    COUNT(*) FILTER (WHERE status = 'OPEN') as active_trades
  +FROM insider_trades
  ```

---

## 5. Missing Forensic Depth (2-Hop Display)
- **Visual State**: The micro-target view correctly reflects 1-hop funding sources beneath the mint addresses (e.g., `COINBASE_2`).
- **Backend Reality**: The Scout now identifies 2-hop laundering chains (e.g., `BINANCE->IntermediateWallet`). The UI does not appear to have adequate space, truncation handling, or visual indicators to display these new complex string paths.

### Proposed Fixes
- **Root Cause**: In `insider-exposure-table.tsx`, the `funding_source` is rendered as a plain string (`{t.funding_source}`). 2-hop sources like `COINBASE_2->9WzDXw...` overflow or are truncated to meaninglessness.
- **Fix A (UI - Visual Indicator)**: Parse the `funding_source` string for `->` and render a multi-hop badge:
  ```tsx
  {t.funding_source.includes("->") ? (
      <div className="flex items-center gap-1">
          <span className="text-amber-500 text-[7px] font-black">2-HOP</span>
          <span className="text-[8px] text-zinc-500">{t.funding_source.split("->")[0]}</span>
      </div>
  ) : (
      <span className="text-[8px] text-zinc-500 uppercase font-black">{t.funding_source}</span>
  )}
  ```
- **Fix B (Tooltip)**: Add a `title` attribute with the full chain for hover inspection:
  ```tsx
  <span title={t.funding_source}>{displayValue}</span>
  ```

---

## 6. Active Filters Tooltip
- **Visual State**: Top right indicates an active filter: `24H_WALLET_AGE`.
- **Backend Reality**: The Scout does not strictly measure elapsed 24-hour time. The bot relies on a transaction count heuristic (`signatures.len() < 10`) to determine if a wallet is "fresh." This UI badge is misleading regarding the actual detection parameters.

### Proposed Fixes
- **Root Cause**: In `insider-header.tsx`, the filter label is a static hardcoded string: `24h_Wallet_Age`. It does not reflect the actual detection heuristic used by the Scout.
- **Fix**: Update the label to reflect the real heuristic:
  ```diff
  -    <Crosshair className="h-3 w-3 text-zinc-400" /> 24h_Wallet_Age
  +    <Crosshair className="h-3 w-3 text-zinc-400" /> Fresh_Wallet_&lt;10TX
  ```
- **Fix (Bonus)**: Make this value dynamic by having the Scout publish its current config to Redis, and reading it in the dashboard server action.
