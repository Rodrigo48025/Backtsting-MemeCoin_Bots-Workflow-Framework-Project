"use server";

import { Pool } from 'pg';
import { getRedisClientWithTimeout } from "@/lib/redis";

const pool = new Pool({
    connectionString: process.env.GRADUATION_DATABASE_URL,
    statement_timeout: 5000,
});

const redisUrl = process.env.GRADUATION_REDIS_URL || 'redis://localhost:6380';

export async function getGraduationSniperDashboardData() {
    try {
        // 1. Fetch Stats & Wallet & History in parallel
        const [stats, wallet, history, exposure, pnlHistoryQuery] = await Promise.all([
            pool.query(`
                SELECT 
                    COUNT(*) as total_trades,
                    COUNT(*) FILTER (WHERE pnl_percentage > 0 AND status = 'CLOSED') as wins,
                    COALESCE(SUM(pnl_percentage), 0) as net_pnl_raw,
                    COALESCE(SUM(pnl_percentage * 0.5 / 100.0), 0) as net_pnl_sol,
                    COALESCE(AVG(pnl_percentage), 0) as avg_pnl,
                    COUNT(*) FILTER (WHERE status = 'OPEN') as active_trades
                FROM graduation_trades
            `),
            pool.query(`SELECT balance_sol FROM paper_wallets WHERE wallet_address = 'GRADUATION_MAIN_WAREHOUSE' LIMIT 1`),
            pool.query(`
                SELECT token_mint, pool_address, entry_price, exit_price, pnl_percentage, status, entry_timestamp, exit_timestamp
                FROM graduation_trades
                ORDER BY entry_timestamp DESC
                LIMIT 20
            `),
            pool.query(`
                SELECT token_mint, pool_address, entry_price, pnl_percentage, entry_timestamp,
                       EXTRACT(EPOCH FROM (NOW() - entry_timestamp)) as elapsed_seconds
                FROM graduation_trades
                WHERE status = 'OPEN'
                ORDER BY entry_timestamp DESC
            `),
            pool.query(`
                WITH time_series AS (
                    SELECT generate_series(
                        date_trunc('hour', NOW()) - interval '24 hours',
                        date_trunc('hour', NOW()),
                        '1 hour'::interval
                    ) as time_bucket
                ),
                binned_trades AS (
                    SELECT 
                        date_trunc('hour', exit_timestamp) as time_bucket,
                        SUM(pnl_percentage) as period_pnl
                    FROM graduation_trades
                    WHERE status = 'CLOSED'
                    AND exit_timestamp > NOW() - interval '24 hours'
                    GROUP BY 1
                )
                SELECT 
                    ts.time_bucket,
                    COALESCE(SUM(bt.period_pnl) OVER (ORDER BY ts.time_bucket), 0) as cumulative_pnl
                FROM time_series ts
                LEFT JOIN binned_trades bt ON ts.time_bucket = bt.time_bucket
                ORDER BY ts.time_bucket ASC
            `)
        ]);

        // 2. Redis Operations with timeout
        const redisClient = await getRedisClientWithTimeout(redisUrl);
        let triggerStrings: string[] = [];
        let signalStrings: string[] = [];
        if (redisClient) {
            try {
                const [triggers, signals] = await Promise.all([
                    redisClient.lRange("graduation_triggers", 0, 19),
                    redisClient.lRange("graduation_signals_log", 0, 49)
                ]);
                triggerStrings = triggers;
                signalStrings = signals;
                await redisClient.disconnect();
            } catch (e) {
                console.warn("⚠️ Graduation Redis Command Error:", e);
            }
        }

        return {
            stats: stats.rows[0],
            wallet: wallet.rows[0],
            history: history.rows,
            exposure: exposure.rows,
            triggers: triggerStrings.map(s => {
                try { return JSON.parse(s); } catch { return null; }
            }).filter(Boolean),
            pnlHistory: pnlHistoryQuery.rows.map(row => ({
                time: new Date(row.time_bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                pnl: parseFloat(row.cumulative_pnl || "0")
            })),
            signals: signalStrings.map(s => {
                try {
                    const parsed = JSON.parse(s);
                    return {
                        raw: parsed.raw || s,
                        parsed: parsed.parsed || null,
                        skip_reason: parsed.skip_reason || "UNKNOWN",
                        is_triggered: !!parsed.is_triggered,
                        timestamp: parsed.timestamp || new Date().toISOString()
                    };
                } catch { return null; }
            }).filter(Boolean)
        };
    } catch (error) {
        console.error("❌ Graduation Data Fetch Error:", error);
        return {
            error: String(error),
            isOffline: true
        };
    }
}

export async function resetGraduationSniperWallet() {
    try {
        await pool.query("UPDATE paper_wallets SET balance_sol = 10.0 WHERE wallet_address = 'GRADUATION_MAIN_WAREHOUSE'");
        await pool.query("TRUNCATE TABLE graduation_trades");
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

export async function getGraduationSniperLogs(tailLines: number = 30) {
    const { execSync } = require('child_process');
    const containers = [
        { name: "SCOUT", container: "graduation_scout" },
        { name: "WATCHER", container: "graduation_adminer" },
        { name: "SNIPER", container: "graduation_sniper" },
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

export async function getGraduationSniperBotStatus() {
    const { execSync } = require('child_process');

    const bots = [
        {
            name: "SCOUT",
            codename: "Graduation Scout",
            container: "graduation_scout",
            role: "PumpPortal Firehose → Immediate Trigger",
            keywords: {
                connected: ["Connecting to PumpPortal", "Subscribed", "Trending Monitor"],
                action: ["New token", "FILTER PASSED"],
                error: ["Crashed", "Error", "panic", "FATAL"],
            },
        },
        {
            name: "WATCHER",
            codename: "Graduation Adminer",
            container: "graduation_adminer",
            role: "DexScreener API → Price Sync",
            keywords: {
                connected: ["Backup Price Engine Active", "Initiating Synchronization"],
                action: ["Price Sync"],
                error: ["Crashed", "Error", "panic", "FATAL"],
            },
        },
        {
            name: "SNIPER",
            codename: "Graduation Sniper",
            container: "graduation_sniper",
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
                else if (lastAction.includes("Waiting")) thinking = "⏳ Armed and waiting for Graduation Scout triggers...";
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

export async function getGraduationSignals() {
    const redisClient = await getRedisClientWithTimeout(redisUrl);
    try {
        if (!redisClient) return [];
        const signalStrings = await redisClient.lRange("graduation_signals_log", 0, 49);
        await redisClient.disconnect();
        return signalStrings.map(s => JSON.parse(s));
    } catch (error) {
        return [];
    }
}
