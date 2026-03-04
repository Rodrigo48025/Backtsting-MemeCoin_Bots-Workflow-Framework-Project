const https = require('https');

// --- User API Keys ---
const HELIUS_API_KEY = "a1020167-d917-44e7-b1a6-8240147efe5f";
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Helper for making standard generic GET requests
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

// Helper for making Solana RPC POST requests
async function rpcRequest(method, params) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params
        });

        const req = https.request(RPC_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
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

// Filter out bots, routers, and system addresses
const IGNORED_ADDRESSES = new Set([
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pT4028", // Raydium
    "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg", // Raydium
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium
    "6EF8rrecthR5Dkzon8Nwu78hRvfH1PnZ1bZ1Xdcq1Yn1", // Pump.fun Program
    "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM", // Pump.fun Fee
    "minikXmHwD52zBw5s1A5hH8RxbqZZx7Z1o2Tf56o11A", // Minitaur
    "11111111111111111111111111111111", // System
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
    "1ATrade1ATrade1ATrade1ATrade1ATrade1ATrade1A", // Jito Validator
    "ComputeBudget111111111111111111111111111111", // Compute Budget
    "proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u", // System Protocol
    "SysvarRent111111111111111111111111111111111", // Rent
    "Sysvar1ns1Ruction11111111111111111111111111" // Instructions
]);

async function findActiveDegenWallets() {
    console.log("🔍 Scanning DexScreener for top 'Trench' MemeCoins right now...");

    try {
        // Search for SOL pairs directly to get recent active markets
        const data = await fetchJSON('https://api.dexscreener.com/latest/dex/search/?q=sol');
        const pairs = data.pairs || [];

        // Filter down to Solana chain and high volume
        const hotParis = pairs
            .filter(p => p.chainId === 'solana' && p.volume?.h24 > 50000)
            .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
            .slice(0, 3); // Top 3 hottest pairs

        if (hotParis.length === 0) {
            console.log("❌ No hot pairs found.");
            return;
        }

        console.log(`🔥 Found ${hotParis.length} blazing hot Solana tokens. Extracting their top active traders...\n`);

        const walletFrequency = new Map();

        for (const pair of hotParis) {
            const tokenMint = pair.baseToken.address;
            console.log(`🪙 Fetching transactions for ${pair.baseToken.symbol} (${tokenMint}) - 24H Volume: $${pair.volume.h24.toLocaleString()}`);

            // 1. Get recent signatures for the token mint
            const sigsResponse = await rpcRequest("getSignaturesForAddress", [
                tokenMint,
                { limit: 50, commitment: "confirmed" } // Fetch the last 50 transactions
            ]);

            if (!sigsResponse.result || sigsResponse.result.length === 0) continue;
            const signatures = sigsResponse.result.map(s => s.signature);

            if (signatures.length === 0) continue;

            // 2. Fetch the actual parsed transactions in chunks to find the signers
            console.log(`   -> Analyzing ${signatures.length} recent trades...`);

            // Solana RPC requires fetching transactions individually or via batching, `getTransactions` is not a standard bulk method on all nodes.
            const txPromises = signatures.map(sig =>
                rpcRequest("getTransaction", [
                    sig,
                    { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }
                ])
            );

            const txResults = await Promise.all(txPromises);
            const validTxs = txResults.map(r => r.result).filter(Boolean);

            if (validTxs.length === 0) {
                console.log("   ❌ Error: No valid transaction data returned.");
                continue;
            }

            for (let i = 0; i < validTxs.length; i++) {
                const tx = validTxs[i];
                if (!tx || tx.meta?.err) continue; // Skip failed txs


                try {
                    // In raw 'json' encoding, accountKeys is a simple array of base58 strings.
                    // The very first key (index 0) is fundamentally ALWAYS the primary fee payer (signer).
                    const keys = tx.transaction?.message?.accountKeys;
                    if (Array.isArray(keys) && keys.length > 0) {
                        const wallet = keys[0];

                        // If we found a wallet and it's not a known system/router
                        if (wallet && typeof wallet === 'string' && !IGNORED_ADDRESSES.has(wallet)) {
                            walletFrequency.set(wallet, (walletFrequency.get(wallet) || 0) + 1);
                        }
                    }
                } catch (e) {
                    // Ignore malformed
                }
            }

            // Quick delay to avoid hitting RPC rate limits
            await new Promise(r => setTimeout(r, 1000));
        }

        // 3. Analyze our findings
        console.log("\n=========================================================");
        console.log("🏆 LIVE DEGEN WALLETS (ACTIVE RIGHT NOW)");
        console.log("=========================================================\n");

        if (walletFrequency.size === 0) {
            console.log("❌ No human/degen wallets could be extracted. Try again in 5 minutes.");
            return;
        }

        // Sort wallets by how many trades they executed across the hot tokens
        const sortedWallets = [...walletFrequency.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10); // Top 10 most active

        console.log(`Found ${walletFrequency.size} unique trading wallets. Here are the top active Degens:\n`);

        sortedWallets.forEach(([wallet, count], index) => {
            let label = "Volume Degen";
            let notes = "High-frequency retail/bot trader executing heavily on hot tokens right now.";

            if (count >= 15) {
                label = "Heavy Momentum Bot";
                notes = "Trading extremely fast across multiple trending tokens. Likely an automated sniper/scalper doing MEV or rapid momentum trading.";
            } else if (count >= 5) {
                label = "Active Trench Warrior";
                notes = "Consistently entering high-volume memecoins. Great target for following momentum.";
            }

            console.log(`🟢 [${index + 1}] Wallet: ${wallet}`);
            console.log(`   Activity: Executed ${count} trades in the last few minutes on trending coins.`);
            console.log(`   Label: ${label}`);
            console.log(`   Profile: ${notes}\n`);
        });

        console.log("🚀 Copy any of these ACTIVE addresses into the Dashboard's 'MANAGE WALLETS' modal to begin copy-trading them instantly.\n");

    } catch (error) {
        console.error("Error scanning wallets:", error);
    }
}

findActiveDegenWallets();
