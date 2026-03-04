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

// Helper for making Solana RPC POST requests with Rate Limit backoff
async function rpcRequest(method, params, retries = 3, backoff = 1000) {
    return new Promise((resolve, reject) => {
        const execute = () => {
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
                if (res.statusCode === 429) {
                    if (retries > 0) {
                        // console.log(`   -> ⚠️ RPC Rate limited (429). Retrying in ${backoff}ms...`);
                        setTimeout(() => rpcRequest(method, params, retries - 1, backoff * 2).then(resolve).catch(reject), backoff);
                        return;
                    }
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
        };
        execute();
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

async function findProfitableWallets() {
    console.log("🔍 STEP 1: Scanning DexScreener for 'Trench Winners' (Memecoins that survived and pumped)...");

    try {
        const data = await fetchJSON('https://api.dexscreener.com/latest/dex/search/?q=sol');
        const pairs = data.pairs || [];

        const winningTokens = pairs
            .filter(p => p.chainId === 'solana' &&
                p.volume?.h24 > 100000 &&
                (p.fdv > 150000 || p.marketCap > 150000))
            .sort((a, b) => (b.fdv || 0) - (a.fdv || 0))
            .slice(0, 5);

        if (winningTokens.length === 0) {
            console.log("❌ No winning tokens found currently. Try again later.");
            return;
        }

        console.log(`\n✅ Found ${winningTokens.length} Trench Winners. Beginning Early Adopter extraction...`);
        const walletScores = new Map(); // Wallet -> Stats

        for (const token of winningTokens) {
            const tokenMint = token.baseToken.address;
            const currentPrice = parseFloat(token.priceUsd) || 0;
            console.log(`\n🪙 Analyzing Winner: ${token.baseToken.symbol} (${tokenMint}) | MCAP: $${(token.fdv || token.marketCap).toLocaleString()}`);

            const sigsResponse = await rpcRequest("getSignaturesForAddress", [
                tokenMint,
                { limit: 1000, commitment: "confirmed" }
            ]);

            if (!sigsResponse.result || sigsResponse.result.length === 0) continue;

            const allSigs = sigsResponse.result;
            if (allSigs.length < 200) {
                console.log(`   -> ⚠️ Token too new or inactive to find early adopters (only ${allSigs.length} txs). Skipping.`);
                continue;
            }

            // Golden Window: transactions 50 to 250 from launch
            const goldenSigs = allSigs.slice(-250, -50).map(s => s.signature);

            console.log(`   -> Extracting ${goldenSigs.length} 'Early Adopter' (non-sniper) trade signers...`);

            const txPromises = [];
            for (let i = 0; i < goldenSigs.length; i += 50) {
                const batch = goldenSigs.slice(i, i + 50);
                const batchPromises = batch.map(sig =>
                    rpcRequest("getTransaction", [
                        sig,
                        { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }
                    ])
                );
                txPromises.push(...batchPromises);
                await new Promise(r => setTimeout(r, 500));
            }

            const txResults = await Promise.all(txPromises);
            const validTxs = txResults.map(r => r.result).filter(Boolean);

            let buyersFound = 0;
            for (const tx of validTxs) {
                if (!tx || tx.meta?.err) continue;

                const keys = tx.transaction?.message?.accountKeys;
                if (Array.isArray(keys) && keys.length > 0) {
                    const wallet = keys[0];

                    if (wallet && typeof wallet === 'string' && !IGNORED_ADDRESSES.has(wallet)) {
                        buyersFound++;

                        if (!walletScores.has(wallet)) {
                            walletScores.set(wallet, {
                                count: 0,
                                coinsFoundIn: new Set(),
                                unrealizedPnL: 0,
                                solBalance: 0,
                                avgTbt: 0
                            });
                        }

                        const stats = walletScores.get(wallet);
                        stats.count += 1;
                        stats.coinsFoundIn.add(tokenMint);
                    }
                }
            }
            console.log(`   -> Successfully extracted ${buyersFound} valid early trader footprints.`);
        }

        // STEP 2: Enqueue RPC calls to check SOL balances and Token PnL for extracted wallets
        console.log("\n🔍 STEP 2: Calculating Actionable On-Chain PnL and SOL Balances for extracted wallets...");

        let processedWallets = 0;
        const walletsEntries = [...walletScores.entries()];

        // Process in small batches to respect RPC limits
        for (let i = 0; i < walletsEntries.length; i += 10) {
            const batch = walletsEntries.slice(i, i + 10);

            const balancePromises = batch.map(([wallet, stats]) => async () => {
                try {
                    // Try to get SOL Balance
                    const solRes = await rpcRequest("getBalance", [wallet]);
                    const solBalanceParsed = (solRes.result?.value || 0) / 1e9; // Convert lamports to SOL
                    stats.solBalance = solBalanceParsed;

                    // Calculate Unrealized holding value across the winning tokens they bought early
                    let totalUnrealized = 0;
                    for (const mint of stats.coinsFoundIn) {
                        try {
                            const tokenBalanceRes = await rpcRequest("getTokenAccountsByOwner", [
                                wallet,
                                { mint: mint },
                                { encoding: "jsonParsed" }
                            ]);

                            if (tokenBalanceRes.result?.value?.length > 0) {
                                const amountInfo = tokenBalanceRes.result.value[0].account.data.parsed.info.tokenAmount;
                                const amount = amountInfo.uiAmount || 0;

                                // Find current price
                                const matchingToken = winningTokens.find(t => t.baseToken.address === mint);
                                const price = matchingToken ? parseFloat(matchingToken.priceUsd) : 0;

                                totalUnrealized += (amount * price);
                            }
                        } catch (e) { /* ignore single token account errors */ }
                    }
                    stats.unrealizedPnL = totalUnrealized;

                    // --- NEW: Calculate Time Between Trades (TBT) ---
                    const recentSigsRes = await rpcRequest("getSignaturesForAddress", [
                        wallet,
                        { limit: 11 } // We need 11 to get 10 intervals
                    ]);

                    if (recentSigsRes.result && recentSigsRes.result.length > 1) {
                        const sigs = recentSigsRes.result;
                        let totalDelta = 0;
                        let count = 0;

                        for (let j = 0; j < sigs.length - 1; j++) {
                            const time1 = sigs[j].blockTime;
                            const time2 = sigs[j + 1].blockTime;
                            if (time1 && time2) {
                                totalDelta += Math.abs(time1 - time2);
                                count++;
                            }
                        }

                        if (count > 0) {
                            stats.avgTbt = totalDelta / count;
                        }
                    }
                } catch (e) {
                    // Ignore wallet lookup errors, but surface rate limit failures
                    if (e && e.message) {
                        // console.log("Account fetch error:", e.message);
                    }
                }
            });

            await Promise.all(balancePromises.map(fn => fn()));
            processedWallets += batch.length;
            process.stdout.write(`\r   -> Checked PnL & Balance for ${processedWallets} / ${walletsEntries.length} wallets...`);
            await new Promise(r => setTimeout(r, 1000)); // Sleep for RPC limits (increased from 600)
        }

        // STEP 3: The Scoring System
        console.log("\n\n=========================================================");
        console.log("🎯 PROFITABLE 'DEGEN' WALLETS (RANKED BY SCORING + PnL)");
        console.log("=========================================================\n");

        if (walletScores.size === 0) {
            console.log("❌ No profitable wallets extracted.");
            return;
        }

        // SCORING FORMULA:
        // Win Base: Each distinct winning token gives 1000 points.
        // PnL: Unrealized profit in USD adds 1 point per $1 held in winning bags (diamond hands).
        // Whale Modifier: Math.log10(SolBalance + 1) * 50 to add a slight bump for heavily capitalized traders.
        const rankedWallets = [...walletScores.entries()]
            .map(([wallet, stats]) => {
                const winPoints = stats.coinsFoundIn.size * 1000;
                const pnlPoints = Math.min(stats.unrealizedPnL, 10000); // Cap extreme unrealized unrealized PNL to prevent outsized skewed score
                const whalePoints = Math.log10(stats.solBalance + 1) * 50;

                stats.totalScore = winPoints + pnlPoints + whalePoints;
                return [wallet, stats];
            })
            .sort((a, b) => b[1].totalScore - a[1].totalScore) // Sort descending
            .slice(0, 10); // Top 10

        console.log(`Analyzed thousands of early trades. Extracted ${walletScores.size} unique traders.`);
        console.log("Here are the highest performing, well-capitalized Degens:\n");

        rankedWallets.forEach(([wallet, stats], index) => {
            const numWinners = stats.coinsFoundIn.size;
            const pnlFormatted = stats.unrealizedPnL > 0 ? `$${stats.unrealizedPnL.toFixed(2)}` : "$0.00 (Taken Profit / Dust)";
            const solFormatted = stats.solBalance.toFixed(2);

            // Format TBT for display
            let tbtDisplay = "Unknown";
            if (stats.avgTbt > 0) {
                const totalSec = Math.floor(stats.avgTbt);
                const min = Math.floor(totalSec / 60);
                const sec = totalSec % 60;
                tbtDisplay = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
            }

            let label = "Trench Survivor";
            let emoji = "🟢";

            if (stats.avgTbt > 0 && stats.avgTbt < 15) {
                emoji = "⚡";
                label = "High-Frequency Bot";
            } else if (stats.unrealizedPnL > 5000 && numWinners > 1) {
                emoji = "🐋";
                label = "Diamond Whale";
            } else if (numWinners >= 3) {
                emoji = "🔥";
                label = "Apex Alpha Hunter";
            } else if (stats.solBalance > 100) {
                emoji = "💰";
                label = "Capitalized Sniper";
            } else if (numWinners >= 2) {
                emoji = "💎";
                label = "Proven Degen";
            } else if (stats.count >= 10) {
                emoji = "⚡";
                label = "Aggressive Scalper";
            }

            console.log(`${emoji} [Rank ${index + 1}] Wallet: ${wallet}`);
            console.log(`    🎯 Scoring Math: ${stats.totalScore.toFixed(0)} Points`);
            console.log(`    💸 Wallet Balance: ${solFormatted} SOL`);
            console.log(`    💰 Unrealized Bag PnL: ${pnlFormatted}`);
            console.log(`    🏆 Winning Coins Spoted Early: ${numWinners} out of 5`);
            console.log(`    ⏱️  Avg Time Between Trades: ${tbtDisplay}`);
            console.log(`    🏷️  Profile: ${label}\n`);
        });

        console.log("🚀 Copy the top 'Ranked' addresses into the Dashboard's 'MANAGE WALLETS' modal to copy their next gems.");

    } catch (error) {
        console.error("Error running profitable wallet hunter:", error);
    }
}

findProfitableWallets();
