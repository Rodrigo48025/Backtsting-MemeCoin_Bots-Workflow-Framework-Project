-- Graduation Protocol Database Schema

CREATE TYPE evaluation_status AS ENUM (
    'PENDING',
    'MOON',
    'DEAD',
    'BARELY_ALIVE',
    'RUGGED',
    'MISSED_OPPORTUNITY',
    'REJECTED_NO_MOMENTUM',
    'NO_GROWTH',
    'EVICTED_SWEPT',
    'EVICTED_TTL',
    'STAGNANT'
);

-- Target queue (active hunting list)
CREATE TABLE IF NOT EXISTS target_queue (
    mint_address TEXT PRIMARY KEY,
    found_at TIMESTAMPTZ DEFAULT NOW(),
    pool_address TEXT NOT NULL,
    source TEXT,
    initial_liquidity DOUBLE PRECISION,
    status TEXT DEFAULT 'PENDING',
    holder_avg_buy DOUBLE PRECISION DEFAULT 0.0
);

-- Rejected targets (for evaluation)
CREATE TABLE IF NOT EXISTS rejected_targets (
    mint_address TEXT PRIMARY KEY,
    rejected_at TIMESTAMPTZ DEFAULT NOW(),
    rejection_reason TEXT,
    initial_price DOUBLE PRECISION,
    current_status TEXT DEFAULT 'PENDING',
    last_check_at TIMESTAMPTZ,
    check_count INT DEFAULT 0,
    holder_avg_buy DOUBLE PRECISION DEFAULT 0.0
);

-- Virtual trades (the simulation ledger)
CREATE TABLE IF NOT EXISTS virtual_trades (
    id SERIAL PRIMARY KEY,
    strategy_id INT DEFAULT 8,  -- Bot 8: Graduation
    token_mint TEXT,
    direction TEXT CHECK (direction IN ('BUY', 'SELL')),
    entry_timestamp TIMESTAMPTZ,
    entry_price DOUBLE PRECISION,
    entry_sol_amount DOUBLE PRECISION,
    expected_tokens_out DOUBLE PRECISION,
    actual_tokens_out DOUBLE PRECISION,
    simulated_priority_fee DOUBLE PRECISION,
    exit_timestamp TIMESTAMPTZ,
    exit_price DOUBLE PRECISION,
    pnl_sol DOUBLE PRECISION,
    pnl_percentage DOUBLE PRECISION,
    status TEXT DEFAULT 'OPEN',
    wallet_impact_sol DOUBLE PRECISION DEFAULT 0.0,
    mfe DOUBLE PRECISION, -- Maximum Favorable Excursion
    mae DOUBLE PRECISION  -- Maximum Adverse Excursion
);

-- High frequency tick logs (for charts)
CREATE TABLE IF NOT EXISTS tick_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    token_mint TEXT,
    price DOUBLE PRECISION,
    vpc_metric DOUBLE PRECISION,
    cvd_metric DOUBLE PRECISION
);

-- Virtual Wallet State
CREATE TABLE IF NOT EXISTS paper_wallets (
    id SERIAL PRIMARY KEY,
    balance_sol DOUBLE PRECISION DEFAULT 2.0,
    total_contributed_sol DOUBLE PRECISION DEFAULT 2.0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed with 10.0 SOL
INSERT INTO paper_wallets (balance_sol, total_contributed_sol)
SELECT 2.0, 2.0
WHERE NOT EXISTS (SELECT 1 FROM paper_wallets);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trades_mint ON virtual_trades(token_mint);
CREATE INDEX IF NOT EXISTS idx_trades_status ON virtual_trades(status);
CREATE INDEX IF NOT EXISTS idx_ticks_mint ON tick_logs(token_mint);
CREATE INDEX IF NOT EXISTS idx_ticks_time ON tick_logs(timestamp);