"use server";

import { Pool } from 'pg';
import { getRedisClientWithTimeout } from "@/lib/redis";

const pool = new Pool({
    connectionString: process.env.INSIDER_DATABASE_URL,
});

const redisUrl = process.env.INSIDER_REDIS_URL || 'redis://localhost:6381';

export async function getInsiderDashboardData() {
    try {
        // 1. Fetch Stats
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_trades,
                COUNT(*) FILTER (WHERE pnl_percentage > 0 AND status = 'CLOSED') as wins,
                COALESCE(SUM(pnl_percentage), 0) as net_pnl_raw,
                COALESCE(SUM(pnl_percentage * 0.1 / 100.0), 0) as net_pnl_sol,
                COALESCE(AVG(pnl_percentage), 0) as avg_pnl,
                COUNT(*) FILTER (WHERE status = 'OPEN') as active_trades
            FROM insider_trades
        `);

        // 2. Fetch Wallet
        const wallet = await pool.query(`SELECT balance_sol FROM paper_wallets LIMIT 1`);

        // 3. Fetch Recent Trades (History)
        const history = await pool.query(`
            SELECT token_mint, insider_address, funding_source, entry_price, exit_price, pnl_percentage, status, entry_timestamp, exit_timestamp
            FROM insider_trades
            ORDER BY entry_timestamp DESC
            LIMIT 20
        `);

        // 4. Fetch Active Exposure (Open Trades)
        const exposure = await pool.query(`
            SELECT token_mint, insider_address, funding_source, entry_price, pnl_percentage, entry_timestamp,
                   EXTRACT(EPOCH FROM (NOW() - entry_timestamp)) as elapsed_seconds
            FROM insider_trades
            WHERE status = 'OPEN'
            ORDER BY entry_timestamp DESC
        `);

        // 5. Fetch Watchlist from Redis (Scout Data) with timeout
        const redisClient = await getRedisClientWithTimeout(redisUrl);

        let watchlist = [];
        if (redisClient) {
            try {
                const keys = await redisClient.keys("watchlist:*");

                // Fetch Wallet Stats from DB to join with Watchlist
                const walletStatsQuery = await pool.query(`
                    SELECT 
                        insider_address, 
                        COUNT(*) as trades, 
                        COUNT(*) FILTER (WHERE pnl_percentage > 0 AND status = 'CLOSED') as wins,
                        COALESCE(SUM(pnl_percentage), 0) as net_pnl
                    FROM insider_trades
                    GROUP BY insider_address
                `);
                const statsMap = new Map();
                walletStatsQuery.rows.forEach(row => statsMap.set(row.insider_address, row));

                for (const key of keys) {
                    const address = key.split(":")[1];
                    const source = await redisClient.get(key);
                    const stats = statsMap.get(address) || { trades: 0, wins: 0, net_pnl: 0 };

                    watchlist.push({
                        address: address,
                        source: source,
                        ttl: await redisClient.ttl(key),
                        trades: parseInt(stats.trades),
                        winrate: stats.trades > 0 ? (parseInt(stats.wins) / parseInt(stats.trades)) * 100 : 0,
                        netPnl: parseFloat(stats.net_pnl)
                    });
                }
                await redisClient.disconnect();
            } catch (e) {
                console.warn("⚠️ Insider Redis Command Error:", e);
            }
        }

        // 6. Fetch PnL History (All-Time, 5-minute intervals, Cumulative)
        const pnlHistoryQuery = await pool.query(`
            WITH time_range AS (
                SELECT 
                    date_bin('5 minutes', MIN(exit_timestamp), '2024-01-01'::timestamp) as start_time,
                    date_bin('5 minutes', NOW(), '2024-01-01'::timestamp) as end_time
                FROM insider_trades
                WHERE status = 'CLOSED'
            ),
            time_buckets AS (
                SELECT generate_series(
                    COALESCE((SELECT start_time FROM time_range), date_trunc('minute', NOW())),
                    COALESCE((SELECT end_time FROM time_range), date_trunc('minute', NOW())),
                    '5 minutes'::interval
                ) as time_bucket
            ),
            binned_trades AS (
                SELECT 
                    date_bin('5 minutes', exit_timestamp, '2024-01-01'::timestamp) as time_bucket,
                    SUM(pnl_percentage) as period_pnl
                FROM insider_trades
                WHERE status = 'CLOSED'
                GROUP BY time_bucket
            )
            SELECT 
                b.time_bucket,
                COALESCE(t.period_pnl, 0) as period_pnl,
                SUM(COALESCE(t.period_pnl, 0)) OVER (ORDER BY b.time_bucket ASC) as cumulative_pnl
            FROM time_buckets b
            LEFT JOIN binned_trades t ON b.time_bucket = t.time_bucket
            ORDER BY b.time_bucket ASC;
        `);

        // Format history for Recharts
        const pnlHistory = pnlHistoryQuery.rows.map(row => {
            const date = new Date(row.time_bucket);
            return {
                time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                pnl: parseFloat(row.cumulative_pnl || "0")
            };
        });

        return {
            stats: stats.rows[0],
            wallet: wallet.rows[0],
            history: history.rows,
            exposure: exposure.rows,
            watchlist: watchlist,
            pnlHistory: pnlHistory
        };
    } catch (error) {
        console.error("❌ Insider Data Fetch Error:", error);
        return {
            error: String(error),
            isOffline: true
        };
    }
}

export async function resetInsiderWallet() {
    try {
        await pool.query("UPDATE paper_wallets SET balance_sol = 10.0");
        await pool.query("TRUNCATE TABLE insider_trades");
        const client = await getRedisClientWithTimeout(redisUrl);
        if (client) {
            await client.flushAll();
            await client.disconnect();
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
}

export async function getInsiderLogs(tailLines: number = 30) {
    const { execSync } = require('child_process');
    const containers = [
        { name: "SCOUT", container: "insider_scout" },
        { name: "WATCHER", container: "insider_watcher" },
        { name: "SNIPER", container: "insider_sniper" },
    ];
    const logs: { service: string; lines: string[] }[] = [];

    for (const svc of containers) {
        try {
            const raw = execSync(
                `docker logs --tail ${tailLines} --timestamps ${svc.container} 2>&1`,
                { timeout: 5000, encoding: "utf-8" }
            );
            const lines = raw
                .split("\n")
                .filter((l: string) => l.trim().length > 0)
                .slice(-tailLines);
            logs.push({ service: svc.name, lines });
        } catch {
            logs.push({ service: svc.name, lines: ["❌ Failed to fetch logs."] });
        }
    }
    return logs;
}

export async function getInsiderBotStatus() {
    const { execSync } = require('child_process');

    const bots = [
        {
            name: "SCOUT",
            codename: "The Detective",
            container: "insider_scout",
            role: "Redis Queue → Burner Wallet Heuristic",
            keywords: {
                connected: ["Connected to Redis"],
                action: ["Analyzing", "INSIDER DETECTED", "Skipping"],
                error: ["Crashed", "Error", "❌"],
            },
        },
        {
            name: "WATCHER",
            codename: "The Tracker",
            container: "insider_watcher",
            role: "PumpPortal WebSocket → Buyer Slot Streaming",
            keywords: {
                connected: ["Connecting to PumpPortal", "Tracking First 20"],
                action: ["Buyer Slot"],
                error: ["Crashed", "Error", "❌"],
            },
        },
        {
            name: "SNIPER",
            codename: "The Assassin",
            container: "insider_sniper",
            role: "Redis trigger → simulated 1 SOL buy/hold/sell",
            keywords: {
                connected: ["Waiting for triggers"],
                action: ["SNIPED", "Executing", "Trade", "BUY", "SELL"],
                error: ["Crashed", "Error", "❌", "Insufficient"],
            },
        },
    ];

    const results = [];

    for (const bot of bots) {
        try {
            const raw = execSync(
                `docker logs --tail 80 --timestamps ${bot.container} 2>&1`,
                { timeout: 5000, encoding: "utf-8" }
            );
            const lines = raw.split("\n").filter((l: string) => l.trim().length > 0);

            // Container status
            let containerStatus = "OFFLINE";
            try {
                const status = execSync(
                    `docker inspect -f '{{.State.Status}}' ${bot.container}`,
                    { timeout: 3000, encoding: "utf-8" }
                ).trim();
                containerStatus = status === "running" ? "ONLINE" : status.toUpperCase();
            } catch { /* ignore */ }

            // Parse last action (most recent meaningful line)
            let lastAction = "Idle";
            let lastTimestamp = "";
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i];
                const isAction = bot.keywords.action.some((kw: string) => line.includes(kw)) ||
                    bot.keywords.connected.some((kw: string) => line.includes(kw));
                if (isAction) {
                    // Extract timestamp
                    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
                    if (tsMatch) lastTimestamp = tsMatch[1];
                    // Extract the readable part (after timestamp)
                    const cleaned = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*/, "");
                    lastAction = cleaned.slice(0, 80);
                    break;
                }
            }

            // Staleness check: if ONLINE but no recent log activity, mark as STALE
            if (containerStatus === "ONLINE" && lastTimestamp) {
                const diffMs = Date.now() - new Date(lastTimestamp + "Z").getTime();
                if (diffMs > 5 * 60 * 1000) { // 5 minutes stale
                    containerStatus = "STALE";
                }
            }

            // Count errors
            const errorCount = lines.filter((l: string) =>
                bot.keywords.error.some((kw: string) => l.includes(kw))
            ).length;

            // Count signal volume
            const signalCount = lines.filter((l: string) =>
                bot.keywords.action.some((kw: string) => l.includes(kw))
            ).length;

            // Thinking state — what is the bot currently doing?
            let thinking = "Standing by...";
            if (containerStatus !== "ONLINE") {
                thinking = "⚠️ Container not running";
            } else if (bot.name === "SCOUT") {
                if (lastAction.includes("INSIDER DETECTED")) thinking = "🔥 Found a Burner Wallet! Sending trigger...";
                else if (lastAction.includes("Analyzing")) thinking = "🔎 Analyzing trader history via RPC...";
                else if (lastAction.includes("Skipping")) thinking = "⏭️ Established wallet, skipping...";
                else thinking = "🕵️ Waiting for forensics queue...";
            } else if (bot.name === "WATCHER") {
                if (lastAction.includes("Buyer Slot")) thinking = "📡 Streaming early buyers to forensics...";
                else if (lastAction.includes("Tracking")) thinking = "👀 Tracking newly launched tokens...";
                else thinking = "🔌 Connecting to PumpPortal stream...";
            } else if (bot.name === "SNIPER") {
                if (lastAction.includes("SNIPED") || lastAction.includes("BUY")) thinking = "💰 Executing trade — 1 SOL market buy!";
                else if (lastAction.includes("SELL")) thinking = "📤 60s hold complete, selling position...";
                else if (lastAction.includes("Waiting")) thinking = "⏳ Armed and waiting for Watcher triggers on Redis...";
                else thinking = "🎯 On standby, monitoring Redis channel...";
            }

            results.push({
                name: bot.name,
                codename: bot.codename,
                role: bot.role,
                status: containerStatus,
                thinking,
                lastAction,
                lastTimestamp,
                errorCount,
                signalCount,
            });
        } catch {
            results.push({
                name: bot.name,
                codename: bot.codename,
                role: bot.role,
                status: "UNREACHABLE",
                thinking: "❌ Cannot reach container",
                lastAction: "N/A",
                lastTimestamp: "",
                errorCount: 0,
                signalCount: 0,
            });
        }
    }

    return results;
}
