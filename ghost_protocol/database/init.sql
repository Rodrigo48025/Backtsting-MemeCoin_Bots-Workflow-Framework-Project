-- Ghost Protocol Database Schema

-- Target queue (active hunting list)
CREATE TABLE IF NOT EXISTS target_queue (
    mint_address TEXT PRIMARY KEY,
    found_at TIMESTAMPTZ DEFAULT NOW(),
    pool_address TEXT NOT NULL,
    source TEXT,
    initial_liquidity DOUBLE PRECISION,
    status TEXT DEFAULT 'PENDING'
);

-- Rejected targets (for evaluation)
CREATE TABLE IF NOT EXISTS rejected_targets (
    mint_address TEXT PRIMARY KEY,
    rejected_at TIMESTAMPTZ DEFAULT NOW(),
    rejection_reason TEXT,
    initial_price DOUBLE PRECISION,
    current_status TEXT DEFAULT 'PENDING',
    last_check_at TIMESTAMPTZ,
    check_count INT DEFAULT 0
);

-- Incubating targets (Shadow Pipeline)
CREATE TABLE IF NOT EXISTS incubating_targets (
    mint_address TEXT PRIMARY KEY,
    name TEXT,
    symbol TEXT,
    uri TEXT,
    initial_buy_sol DOUBLE PRECISION,
    bonding_curve TEXT,
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    mature_at TIMESTAMPTZ,
    status TEXT DEFAULT 'WAITING',
    rejection_reason TEXT
);

-- Virtual trades (the simulation ledger)
CREATE TABLE IF NOT EXISTS virtual_trades (
    id SERIAL PRIMARY KEY,
    strategy_id INT DEFAULT 1,
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trades_mint ON virtual_trades(token_mint);
CREATE INDEX IF NOT EXISTS idx_trades_status ON virtual_trades(status);
CREATE INDEX IF NOT EXISTS idx_ticks_mint ON tick_logs(token_mint);
CREATE INDEX IF NOT EXISTS idx_ticks_time ON tick_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_incubation_status ON incubating_targets(status);