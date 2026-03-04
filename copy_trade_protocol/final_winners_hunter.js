const https = require('https');
const { Client } = require('pg');
require('dotenv').config();

// --- Configuration ---
const HELIUS_KEYS = (process.env.HELIUS_API_KEYS || "a1020167-d917-44e7-b1a6-8240147efe5f").split(',');
let heliusKeyIndex = 0;
function getHeliusKey() { const k = HELIUS_KEYS[heliusKeyIndex % HELIUS_KEYS.length]; heliusKeyIndex++; return k; }
function getRpcUrl() { return `https://mainnet.helius-rpc.com/?api-key=${getHeliusKey()}`; }

const DB_CONFIG = {
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: parseInt(process.env.POSTGRES_PORT || '5435'),
    user: process.env.POSTGRES_USER || 'copy_trade_user',
    password: process.env.POSTGRES_PASSWORD || 'copy_trade_password',
    database: process.env.POSTGRES_DB || 'copy_trade_db',
};

const LOOP_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const IGNORED_MINT = new Set(["So11111111111111111111111111111111111111112", "EPjFW36Wy2W3L38y6V676b1R1W5667GfH3u7hV32n2"]);
const IGNORED_WALLET = new Set([
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pT4028", "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", "6EF8rrecthR5Dkzon8Nwu78hRvfH1PnZ1bZ1Xdcq1Yn1",
    "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM", "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "ComputeBudget111111111111111111111111111111", "proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u"
]);

// --- Thresholds ---
const MIN_PNL_PCT = 5;
const MIN_PF = 1.5;
const MIN_TRADES_DAY = 20;
const MIN_SOL = 1;
const MIN_WR = 30;  // Lowered from 40% per user request
const MIN_VERIFIED_TRADES = 5;

// --- Helpers ---
async function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

async function rpc(method, params, retries = 3, backoff = 800) {
    const url = getRpcUrl();
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
        const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
            if (res.statusCode === 429 && retries > 0) {
                setTimeout(() => rpc(method, params, retries - 1, backoff * 2).then(resolve).catch(reject), backoff);
                return;
            }
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        });
        req.on('error', reject); req.write(body); req.end();
    });
}

// --- DB Integration ---
async function addWalletToDB(wallet, pnlData, sol) {
    const client = new Client(DB_CONFIG);
    try {
        await client.connect();
        // Check if wallet already exists
        const existing = await client.query('SELECT wallet_address FROM tracked_wallets WHERE wallet_address = $1', [wallet]);
        if (existing.rows.length > 0) {
            console.log(`   📋 Already tracked: ${wallet.substring(0, 12)}...`);
            return false;
        }

        const label = `ALPHA_HUNTER_PnL${pnlData.pnlPct}%_PF${pnlData.pf}_WR${pnlData.wr}%`;
        await client.query(
            `INSERT INTO tracked_wallets (wallet_address, label, status, added_at)
             VALUES ($1, $2, 'ACTIVE', NOW())`,
            [wallet, label]
        );
        console.log(`   🎯 ADDED TO DB: ${wallet.substring(0, 12)}... as ACTIVE`);
        return true;
    } catch (err) {
        console.error(`   ❌ DB Error for ${wallet.substring(0, 12)}...:`, err.message);
        return false;
    } finally {
        await client.end();
    }
}

// ============ PHASE 1: TOKEN DISCOVERY ============

async function discoverTokens() {
    const tkMap = new Map();
    const addToken = (addr, sym, mcap, vol, src) => {
        if (!tkMap.has(addr)) tkMap.set(addr, { mint: addr, symbol: sym, mcap, volume: vol, source: src });
    };

    // Source 1: Search
    const qs = ['solana', 'doge', 'pepe', 'shib', 'pump', 'trump', 'cat', 'moon', 'ai', 'meme', 'dog', 'frog', 'inu', 'elon', 'chad', 'based', 'bonk', 'jup', 'wen', 'popcat'];
    for (const q of qs) {
        try {
            const r = await fetchJSON(`https://api.dexscreener.com/latest/dex/search/?q=${q}`);
            if (r.pairs) for (const p of r.pairs) {
                if (!p.baseToken || p.chainId !== 'solana') continue;
                const mc = p.fdv || p.marketCap || 0;
                if (mc > 200000 && mc < 50000000 && (p.volume?.h24 || 0) > 20000 && !IGNORED_MINT.has(p.baseToken.address))
                    addToken(p.baseToken.address, p.baseToken.symbol, mc, p.volume?.h24 || 0, 'search');
            }
        } catch (e) { }
        await new Promise(r => setTimeout(r, 150));
    }
    const searchCount = tkMap.size;

    // Source 2: Boosted
    try {
        const b = await fetchJSON('https://api.dexscreener.com/token-boosts/latest/v1');
        let n = 0;
        if (Array.isArray(b)) for (const t of b) {
            if (t.chainId !== 'solana' || !t.tokenAddress || tkMap.has(t.tokenAddress) || IGNORED_MINT.has(t.tokenAddress)) continue;
            try {
                const pr = await fetchJSON(`https://api.dexscreener.com/latest/dex/tokens/${t.tokenAddress}`);
                if (pr.pairs?.[0]) {
                    const p = pr.pairs[0]; const mc = p.fdv || p.marketCap || 0;
                    if (mc > 200000 && mc < 50000000 && (p.volume?.h24 || 0) > 20000) {
                        addToken(t.tokenAddress, p.baseToken?.symbol || '?', mc, p.volume?.h24 || 0, 'boost'); n++;
                    }
                }
            } catch (e) { } await new Promise(r => setTimeout(r, 250));
            if (n >= 15) break;
        }
    } catch (e) { }

    // Source 3: Profiles
    try {
        const pr = await fetchJSON('https://api.dexscreener.com/token-profiles/latest/v1');
        let n = 0;
        if (Array.isArray(pr)) for (const t of pr) {
            if (t.chainId !== 'solana' || !t.tokenAddress || tkMap.has(t.tokenAddress)) continue;
            try {
                const r2 = await fetchJSON(`https://api.dexscreener.com/latest/dex/tokens/${t.tokenAddress}`);
                if (r2.pairs?.[0]) {
                    const p = r2.pairs[0]; const mc = p.fdv || p.marketCap || 0;
                    if (mc > 200000 && mc < 50000000 && (p.volume?.h24 || 0) > 20000) {
                        addToken(t.tokenAddress, p.baseToken?.symbol || '?', mc, p.volume?.h24 || 0, 'profile'); n++;
                    }
                }
            } catch (e) { } await new Promise(r => setTimeout(r, 250));
            if (n >= 15) break;
        }
    } catch (e) { }

    console.log(`   Funnel: ${tkMap.size} tokens (${searchCount} search + ${tkMap.size - searchCount} boost/profile)`);
    return [...tkMap.values()].sort((a, b) => b.volume - a.volume).slice(0, 25);
}

// ============ PHASE 3: PnL VERIFICATION ============

async function verifyPnL(wallet) {
    try {
        const key = getHeliusKey();
        const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${key}&limit=100`;
        const txns = await fetchJSON(url);
        if (!Array.isArray(txns) || txns.length === 0) return null;

        let wins = 0, losses = 0, grossW = 0, grossL = 0, tradeCount = 0;
        let earliest = Date.now() / 1000, latest = 0;

        for (const tx of txns) {
            if (!tx.nativeTransfers?.length || !tx.tokenTransfers?.length) continue;
            const ts = tx.timestamp || 0;
            if (ts < earliest) earliest = ts;
            if (ts > latest) latest = ts;

            let solIn = 0, solOut = 0;
            for (const nt of tx.nativeTransfers) {
                const amt = (nt.amount || 0) / 1e9;
                if (amt < 0.001) continue;
                if (nt.toUserAccount === wallet) solIn += amt;
                if (nt.fromUserAccount === wallet) solOut += amt;
            }

            const net = solIn - solOut;
            if (Math.abs(net) < 0.001) continue;
            tradeCount++;
            if (net > 0) { wins++; grossW += net; }
            else { losses++; grossL += Math.abs(net); }
        }

        if (tradeCount < MIN_VERIFIED_TRADES) return null;
        const days = Math.max((latest - earliest) / 86400, 0.5);
        const tpd = tradeCount / days;
        const netPnl = grossW - grossL;
        const pnlPct = grossL > 0 ? (netPnl / grossL) * 100 : (grossW > 0 ? 999 : 0);
        const wr = (wins / tradeCount) * 100;
        const pf = grossL > 0 ? grossW / grossL : (grossW > 0 ? 999 : 0);

        return { tradeCount, tpd: Math.round(tpd * 10) / 10, netPnl: +netPnl.toFixed(4), pnlPct: +pnlPct.toFixed(2), wr: +wr.toFixed(1), pf: +pf.toFixed(2), gw: +grossW.toFixed(4), gl: +grossL.toFixed(4) };
    } catch (e) { return null; }
}

// --- Main Cycle ---

let cycleCount = 0;

async function runCycle() {
    cycleCount++;
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║  🚀 HUNTER V2 — Cycle #${cycleCount} @ ${ts}  ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
    console.log(`   ${HELIUS_KEYS.length} keys | SOL ≥ ${MIN_SOL} | PnL% > ${MIN_PNL_PCT}% | PF > ${MIN_PF} | t/day ≥ ${MIN_TRADES_DAY} | WR > ${MIN_WR}% | trades ≥ ${MIN_VERIFIED_TRADES}\n`);

    try {
        // PHASE 1
        console.log("━━ PHASE 1: Token Discovery ━━");
        const tokens = await discoverTokens();
        if (!tokens.length) { console.log("   ❌ No winners.\n"); return; }

        // PHASE 2
        console.log("\n━━ PHASE 2: Golden Window (30s-180s) ━━\n");
        const pool = new Map();

        for (const tk of tokens) {
            process.stdout.write(`   ${tk.symbol.padEnd(12)} ($${(tk.mcap / 1e6).toFixed(1)}M) `);
            let sigs = [], before = null;
            for (let p = 0; p < 5; p++) {
                const sp = [tk.mint, { limit: 1000, commitment: "confirmed" }];
                if (before) sp[1].before = before;
                const r = await rpc("getSignaturesForAddress", sp);
                if (!r.result?.length) break;
                sigs.push(...r.result);
                before = r.result[r.result.length - 1].signature;
                if (r.result.length < 1000) break;
            }
            if (sigs.length < 50) { console.log("⚠️ short"); continue; }

            const launch = sigs[sigs.length - 1].blockTime;
            const alpha = sigs.filter(s => { const a = s.blockTime - launch; return a >= 30 && a <= 180; }).map(s => s.signature);
            if (!alpha.length) { console.log("⚠️ no window"); continue; }

            const lim = alpha.slice(0, 20); let fc = 0;
            for (let i = 0; i < lim.length; i += 5) {
                const batch = lim.slice(i, i + 5);
                const res = await Promise.all(batch.map(s => rpc("getTransaction", [s, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }])));
                for (const r of res) {
                    const tx = r.result; if (!tx || tx.meta?.err) continue;
                    const w = tx.transaction?.message?.accountKeys?.[0];
                    if (w && typeof w === 'string' && !IGNORED_WALLET.has(w)) {
                        if (!pool.has(w)) pool.set(w, { hits: 0, winners: new Set() });
                        const e = pool.get(w);
                        if (!e.winners.has(tk.mint)) { e.hits++; e.winners.add(tk.mint); fc++; }
                    }
                }
                await new Promise(r => setTimeout(r, 500));
            }
            console.log(`✅ ${fc}`);
        }

        console.log(`\n   Candidates: ${pool.size}\n`);
        if (!pool.size) { console.log("   ❌ No candidates.\n"); return; }

        // PHASE 3
        console.log("━━ PHASE 3: PnL Verification ━━\n");

        const cands = [...pool.entries()].sort((a, b) => b[1].hits - a[1].hits).slice(0, 60);
        const verified = [];
        let rej = { bal: 0, data: 0, pnl: 0, pf: 0, td: 0, wr: 0 };
        let checked = 0;

        for (const [wallet, stats] of cands) {
            checked++;
            process.stdout.write(`\r   Verifying ${checked}/${cands.length}...`);

            let sol = 0;
            try { const b = await rpc("getBalance", [wallet]); sol = (b.result?.value || 0) / 1e9; } catch (e) { }
            if (sol < MIN_SOL) { rej.bal++; continue; }

            const pnl = await verifyPnL(wallet);
            await new Promise(r => setTimeout(r, 350));
            if (!pnl) { rej.data++; continue; }

            if (pnl.pnlPct <= MIN_PNL_PCT) { rej.pnl++; continue; }
            if (pnl.pf <= MIN_PF) { rej.pf++; continue; }
            if (pnl.tpd < MIN_TRADES_DAY) { rej.td++; continue; }
            if (pnl.wr <= MIN_WR) { rej.wr++; continue; }

            const score = (pnl.pnlPct * 0.5) + (pnl.pf * 30) + (Math.log10(sol + 1) * 10);
            verified.push({ wallet, hits: stats.hits, sol, pnl, score });
            console.log(`\n   ✅ ALPHA: ${wallet.substring(0, 12)}... | PnL: +${pnl.pnlPct}% | PF: ${pnl.pf} | WR: ${pnl.wr}% | ${pnl.tpd} t/d | ${sol.toFixed(1)} SOL`);
        }

        console.log(`\n   Rejections: bal=${rej.bal} noData=${rej.data} pnl=${rej.pnl} pf=${rej.pf} td=${rej.td} wr=${rej.wr}`);

        // PHASE 4: AUTO-ADD TO DB
        if (verified.length > 0) {
            console.log(`\n━━ PHASE 4: Auto-Adding ${verified.length} Verified Wallets to DB ━━\n`);
            verified.sort((a, b) => b.score - a.score);

            for (const t of verified.slice(0, 10)) {
                console.log(`🟢 ${t.wallet}`);
                console.log(`   PnL: +${t.pnl.pnlPct}% | PF: ${t.pnl.pf} | WR: ${t.pnl.wr}% | ${t.pnl.tpd} t/d | ${t.sol.toFixed(2)} SOL`);
                console.log(`   🔍 https://gmgn.ai/sol/address/${t.wallet}`);

                // Auto-insert into tracked_wallets
                await addWalletToDB(t.wallet, t.pnl, t.sol);
                console.log('');
            }
        } else {
            console.log("\n   ❌ No alphas this cycle. Waiting for next scan...");
        }

    } catch (err) {
        console.error("   ❌ Cycle error:", err.message);
    }

    console.log(`\n   ⏳ Next cycle in ${LOOP_INTERVAL_MS / 1000}s...\n`);
}

// --- Loop ---
async function main() {
    console.log("🏁 Final Winners Hunter V2 — Auto-Loop Mode");
    console.log(`   Interval: ${LOOP_INTERVAL_MS / 1000}s | WR threshold: ${MIN_WR}%\n`);

    while (true) {
        await runCycle();
        await new Promise(r => setTimeout(r, LOOP_INTERVAL_MS));
    }
}

main().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
});
