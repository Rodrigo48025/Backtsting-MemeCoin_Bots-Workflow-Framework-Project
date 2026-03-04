#!/bin/bash

# Exit on any error
set -e

echo "Starting system deployment refresh..."

# 1. Docker Reset
echo "1. Resetting Docker environment..."
docker compose down || true
docker compose build --no-cache

# 2. Rust Cleanse
echo "2. Cleaning and rebuilding Rust binaries..."
cd insider_scout
cargo clean
cargo build
cd ../insider_watcher
cargo clean
cargo build
cd ../insider_sniper
cargo clean
cargo build
cd ..

# 3. Dashboard Rebuild
echo "3. Rebuilding Next.js Dashboard..."
cd ../backtesting-memecoin-dashboard
npm install
npm run build
cd ../insider_protocol

# 4. Process Management
echo "4. Restarting PM2 processes..."
# Ignoring error if no processes exist yet
pm2 restart all || true

# 5. System Up
echo "5. Bringing Docker cluster up..."
docker compose up -d

echo "Deployment refresh complete!"
