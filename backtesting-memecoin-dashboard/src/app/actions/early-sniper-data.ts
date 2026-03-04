"use server";

import { Pool } from 'pg';
import { getRedisClientWithTimeout } from "@/lib/redis";

const pool = new Pool({
    connectionString: process.env.EARLY_DATABASE_URL,
});

const redisUrl = process.env.EARLY_REDIS_URL || 'redis://localhost:6384';

export async function getEarlySniperDashboardData() {
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

        // 5. Fetch Recent Triggers from Redis with timeout
        const redisClient = await getRedisClientWithTimeout(redisUrl);
        let triggers = [];
        if (redisClient) {
            try {
                const triggerStrings = await redisClient.lRange("early_recent_triggers", 0, 19);
                triggers = triggerStrings.map(s => JSON.parse(s));
                await redisClient.disconnect();
            } catch (e) {
                console.warn("⚠️ Early Sniper Redis Command Error:", e);
            }
        }

        // 6. Fetch PnL History
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
            triggers: triggers,
            pnlHistory: pnlHistory
        };
    } catch (error) {
        console.error("❌ Early Sniper Data Fetch Error:", error);
        return {
            error: String(error),
            isOffline: true
        };
    }
}

export async function resetEarlySniperWallet() {
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

export async function getEarlySniperLogs(tailLines: number = 30) {
    const { execSync } = require('child_process');
    const containers = [
        { name: "SCOUT", container: "early_scout" },
        { name: "WATCHER", container: "early_watcher" },
        { name: "SNIPER", container: "early_sniper" },
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

export async function getEarlySniperBotStatus() {
    const { execSync } = require('child_process');

    const bots = [
        {
            name: "SCOUT",
            codename: "Early Scout",
            container: "early_scout",
            role: "PumpPortal Firehose → Immediate Trigger",
            keywords: {
                connected: ["Connecting to PumpPortal", "Subscribed", "Trending Monitor"],
                action: ["New token", "FILTER PASSED"],
                error: ["Crashed", "Error", "panic", "FATAL"],
            },
        },
        {
            name: "WATCHER",
            codename: "Early Sync",
            container: "early_watcher",
            role: "DexScreener API → Price Sync",
            keywords: {
                connected: ["Backup Price Engine Active", "Initiating Synchronization"],
                action: ["Price Sync"],
                error: ["Crashed", "Error", "panic", "FATAL"],
            },
        },
        {
            name: "SNIPER",
            codename: "Early Assassin",
            container: "early_sniper",
            role: "Redis trigger → +50% TP / -25% SL / 10m TS",
            keywords: {
                connected: ["Execution Engine Online"],
                action: ["SNIPED", "Entered", "Closed", "HIT"],
                error: ["Crashed", "Error", "panic", "FATAL"],
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

            let containerStatus = "OFFLINE";
            try {
                const status = execSync(
                    `docker inspect -f '{{.State.Status}}' ${bot.container}`,
                    { timeout: 3000, encoding: "utf-8" }
                ).trim();
                containerStatus = status === "running" ? "ONLINE" : status.toUpperCase();
            } catch { /* ignore */ }

            let lastAction = "Idle";
            let lastTimestamp = "";
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i];
                const isAction = bot.keywords.action.some((kw: string) => line.includes(kw)) ||
                    bot.keywords.connected.some((kw: string) => line.includes(kw));
                if (isAction) {
                    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
                    if (tsMatch) lastTimestamp = tsMatch[1];
                    const cleaned = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*/, "");
                    lastAction = cleaned.slice(0, 80);
                    break;
                }
            }

            if (containerStatus === "ONLINE" && lastTimestamp) {
                const diffMs = Date.now() - new Date(lastTimestamp + "Z").getTime();
                if (diffMs > 5 * 60 * 1000) {
                    containerStatus = "STALE";
                }
            }

            const errorCount = lines.filter((l: string) =>
                bot.keywords.error.some((kw: string) => l.includes(kw))
            ).length;

            const signalCount = lines.filter((l: string) =>
                bot.keywords.action.some((kw: string) => l.includes(kw))
            ).length;

            let thinking = "Standing by...";
            if (containerStatus === "OFFLINE" || containerStatus === "UNREACHABLE") {
                thinking = "⚠️ Container not running";
            } else if (containerStatus === "STALE") {
                thinking = "💤 Running but idle — no recent activity";
            } else if (bot.name === "SCOUT") {
                thinking = "🕵️ Watching PumpPortal firehose...";
            } else if (bot.name === "WATCHER") {
                thinking = "🔌 Monitoring active snipes list...";
            } else if (bot.name === "SNIPER") {
                if (lastAction.includes("SNIPED") || lastAction.includes("BUY")) thinking = "💰 Entering momentum trade — 0.1 SOL";
                else if (lastAction.includes("SELL")) thinking = "📤 Target hit or TTL expired, exiting...";
                else if (lastAction.includes("Waiting")) thinking = "⏳ Armed and waiting for Early Scout triggers...";
                else thinking = "🎯 On standby for early snipes...";
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
