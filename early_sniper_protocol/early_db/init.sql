CREATE TABLE IF NOT EXISTS paper_wallets (
    wallet_address TEXT PRIMARY KEY,
    balance_sol DOUBLE PRECISION DEFAULT 10.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO paper_wallets (wallet_address, balance_sol) 
VALUES ('EARLY_MAIN_WAREHOUSE', 10.0)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS insider_trades (
    id SERIAL PRIMARY KEY,
    token_mint TEXT NOT NULL,
    insider_address TEXT NOT NULL,
    funding_source TEXT DEFAULT 'EARLY_SNIPER',
    entry_price DOUBLE PRECISION,
    exit_price DOUBLE PRECISION,
    entry_sol_amount DOUBLE PRECISION,
    pnl_percentage DOUBLE PRECISION DEFAULT 0.0,
    status TEXT DEFAULT 'OPEN',
    entry_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    exit_timestamp TIMESTAMP WITH TIME ZONE,
    UNIQUE(token_mint, insider_address)
);
