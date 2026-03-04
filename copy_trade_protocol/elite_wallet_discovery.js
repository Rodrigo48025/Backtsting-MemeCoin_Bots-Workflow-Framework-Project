const https = require('https');
const { Client } = require('pg');
require('dotenv').config();

// --- Configuration ---
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "a1020167-d917-44e7-b1a6-8240147efe5f";
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

const DB_CONFIG = {
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: parseInt(process.env.POSTGRES_PORT || '5435'),
    user: process.env.POSTGRES_USER || 'copy_trade_user',
    password: process.env.POSTGRES_PASSWORD || 'copy_trade_password',
    database: process.env.POSTGRES_DB || 'copy_trade_db',
};

// Filter out common system addresses
const IGNORED_ADDRESSES = new Set([
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pT4028", "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", "6EF8rrecthR5Dkzon8Nwu78hRvfH1PnZ1bZ1Xdcq1Yn1",
    "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM", "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "1ATrade1ATrade1ATrade1ATrade1ATrade1ATrade1A",
    "ComputeBudget111111111111111111111111111111", "proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u"
]);

// --- Helpers ---

async function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function rpcRequest(method, params, retries = 3, backoff = 1000) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
        const req = https.request(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            if (res.statusCode === 429 && retries > 0) {
                setTimeout(() => rpcRequest(method, params, retries - 1, backoff * 2).then(resolve).catch(reject), backoff);
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// --- Main Logic ---

async function runEliteDiscovery() {
    console.log("🚀 Starting Elite Wallet Discovery (Auto-Sync Mode)");
    const dbClient = new Client(DB_CONFIG);

    try {
        await dbClient.connect();
        console.log("✅ Connected to PostgreSQL");

        // 1. Scan DexScreener for Top Winners across multiple search terms
        console.log("🔍 Scanning for high-volume winners...");
        const searchQueries = ['solana', 'pump.fun', 'moon', 'alpha', 'degen'];
        const allPairs = [];

        for (const query of searchQueries) {
            try {
                const data = await fetchJSON(`https://api.dexscreener.com/latest/dex/search/?q=${query}`);
                if (data.pairs) allPairs.push(...data.pairs);
            } catch (e) { console.log(`   -> Error searching for ${query}`); }
            await new Promise(r => setTimeout(r, 500));
        }

        const winningTokens = allPairs
            .filter(p => p.chainId === 'solana' && p.volume?.h24 > 25000) // Lenient volume filter
            .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
            .filter((v, i, a) => a.findIndex(t => t.baseToken.address === v.baseToken.address) === i) // Deduplicate
            .slice(0, 50); // Analyze top 50 unique tokens

        if (winningTokens.length === 0) throw new Error("No winning tokens found.");

        const walletPool = new Map(); // Wallet -> { score, winCount, pnl, sol }

        // 2. Extract Early Adopters
        for (const token of winningTokens) {
            const mint = token.baseToken.address;
            console.log(`\n🪙 Analyzing: ${token.baseToken.symbol} | FDV: $${token.fdv.toLocaleString()}`);

            const sigsRes = await rpcRequest("getSignaturesForAddress", [mint, { limit: 500 }]);
            if (!sigsRes.result || sigsRes.result.length < 100) continue;

            // Window: Txs 50 to 150 from launch
            const earliestSigs = sigsRes.result.slice(-150, -50).map(s => s.signature);

            console.log(`   -> Fetching ${earliestSigs.length} early trade details...`);

            // Fetch in batches to be fast but respect limits
            const batchSize = 25;
            for (let i = 0; i < earliestSigs.length; i += batchSize) {
                const batch = earliestSigs.slice(i, i + batchSize);
                const results = await Promise.all(batch.map(sig =>
                    rpcRequest("getTransaction", [sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }])
                ));

                for (const res of results) {
                    const tx = res.result;
                    if (!tx || tx.meta?.err) continue;
                    const wallet = tx.transaction?.message?.accountKeys?.[0];
                    if (wallet && !IGNORED_ADDRESSES.has(wallet)) {
                        if (!walletPool.has(wallet)) {
                            walletPool.set(wallet, { winCount: 0, pnl: 0, sol: 0, coins: new Set() });
                        }
                        const entry = walletPool.get(wallet);
                        if (!entry.coins.has(mint)) {
                            entry.winCount++;
                            entry.coins.add(mint);
                        }
                    }
                }
                await new Promise(r => setTimeout(r, 200));
            }
        }

        console.log(`\n💎 Extracted ${walletPool.size} potential elite candidates. Filtering by PnL...`);

        // 3. Validate PnL & Balance (Top 200 Candidates)
        const candidates = [...walletPool.entries()]
            .sort((a, b) => b[1].winCount - a[1].winCount)
            .slice(0, 200);

        for (let i = 0; i < candidates.length; i += 5) {
            const batch = candidates.slice(i, i + 5);
            await Promise.all(batch.map(async ([wallet, stats]) => {
                try {
                    // Balance
                    const balRes = await rpcRequest("getBalance", [wallet]);
                    stats.sol = (balRes.result?.value || 0) / 1e9;

                    // PnL across their "winning" tokens
                    for (const mint of stats.coins) {
                        const tokenBalRes = await rpcRequest("getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed" }]);
                        if (tokenBalRes.result?.value?.length > 0) {
                            const amount = tokenBalRes.result.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
                            const tokenData = winningTokens.find(t => t.baseToken.address === mint);
                            const price = parseFloat(tokenData?.priceUsd || "0");
                            stats.pnl += (amount * price);
                        }
                    }
                } catch (e) { }
            }));
            process.stdout.write(`\r   -> Validated ${i + batch.length} / ${candidates.length} candidates...`);
            await new Promise(r => setTimeout(r, 500));
        }

        // 4. Rank and Sync to DB
        const eliteList = candidates
            .map(([wallet, stats]) => ({
                wallet,
                score: (stats.winCount * 1000) + stats.pnl + (Math.log10(stats.sol + 1) * 100),
                pnl: stats.pnl,
                sol: stats.sol,
                wins: stats.winCount
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 100);

        console.log(`\n\n🎯 Found ${eliteList.length} ELITE wallets. Syncing to PostgreSQL...`);

        for (const elite of eliteList) {
            const query = `
                INSERT INTO tracked_wallets (wallet_address, label, status, notes)
                VALUES ($1, $2, 'ACTIVE', $3)
                ON CONFLICT (wallet_address) 
                DO UPDATE SET 
                    status = 'ACTIVE', 
                    label = EXCLUDED.label,
                    notes = EXCLUDED.notes;
            `;
            const notes = `Elite Discovery: PnL $${elite.pnl.toFixed(2)}, SOL ${elite.sol.toFixed(2)}, Wins ${elite.wins}`;
            await dbClient.query(query, [elite.wallet, 'ELITE_DISCOVERY', notes]);
        }

        console.log("✅ DB Sync Complete! Top 100 wallets are now being scouted.");

    } catch (err) {
        console.error("❌ Fatal Error:", err);
    } finally {
        await dbClient.end();
    }
}

runEliteDiscovery();
