-- Create paper_wallets table
CREATE TABLE IF NOT EXISTS paper_wallets (
    id SERIAL PRIMARY KEY,
    balance_sol DOUBLE PRECISION DEFAULT 10.0,
    total_contributed_sol DOUBLE PRECISION DEFAULT 10.0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed with 10.0 SOL if empty
INSERT INTO paper_wallets (balance_sol, total_contributed_sol)
SELECT 10.0, 10.0
WHERE NOT EXISTS (SELECT 1 FROM paper_wallets);

-- Add wallet_impact to virtual_trades to track balance changes accurately
ALTER TABLE virtual_trades ADD COLUMN IF NOT EXISTS wallet_impact_sol DOUBLE PRECISION DEFAULT 0.0;
