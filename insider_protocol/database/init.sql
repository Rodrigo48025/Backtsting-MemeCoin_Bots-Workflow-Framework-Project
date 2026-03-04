-- Initialize Insider Protocol Database

-- 1. PAPER WALLETS (Simulated Funds)
CREATE TABLE IF NOT EXISTS paper_wallets (
    wallet_address TEXT PRIMARY KEY,
    balance_sol DOUBLE PRECISION DEFAULT 10.0,
    total_contributed_sol DOUBLE PRECISION DEFAULT 10.0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Initial Wallet
INSERT INTO paper_wallets (wallet_address, balance_sol, total_contributed_sol)
VALUES ('INSIDER_MAIN_WAREHOUSE', 10.0, 10.0)
ON CONFLICT DO NOTHING;

-- 2. INSIDER TRADES (Assisted Follows)
CREATE TABLE IF NOT EXISTS insider_trades (
    id SERIAL PRIMARY KEY,
    token_mint TEXT NOT NULL,
    insider_address TEXT NOT NULL, -- The wallet that triggered the trade
    funding_source TEXT NOT NULL,  -- The CEX address (Binance, OKX, etc.)
    entry_price DOUBLE PRECISION,
    exit_price DOUBLE PRECISION,
    entry_sol_amount DOUBLE PRECISION,
    pnl_percentage DOUBLE PRECISION DEFAULT 0.0,
    status TEXT DEFAULT 'OPEN',     -- OPEN, CLOSED
    entry_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    exit_timestamp TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT unique_insider_mint UNIQUE(token_mint, insider_address)
);

-- 3. WATCHLIST AUDIT (Optional for debugging)
CREATE TABLE IF NOT EXISTS watchlist_log (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source_cex TEXT NOT NULL,
    reason TEXT
);
