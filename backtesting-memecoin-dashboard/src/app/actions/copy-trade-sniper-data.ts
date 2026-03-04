"use server";

import { Pool } from 'pg';
import { createClient } from 'redis';

const pool = new Pool({
    connectionString: process.env.COPY_TRADE_DATABASE_URL,
});

const redisUrl = process.env.COPY_TRADE_REDIS_URL || 'redis://localhost:6381';
const redisClient = createClient({ url: redisUrl });
redisClient.on('error', (err) => console.error('Redis Client Error', err));

async function ensureRedis() {
    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
}

export async function getCopyTradeSignals() {
    try {
        await ensureRedis();
        const signalStrings = await redisClient.lRange("copy_trade_signals_log", 0, 49);
        const rawSignals = signalStrings.map(s => {
            try {
                const parsed = JSON.parse(s);
                return {
                    raw: parsed.raw || s,
                    parsed: parsed.parsed || null,
                    skip_reason: parsed.skip_reason || "UNKNOWN",
                    is_triggered: !!parsed.is_triggered,
                    timestamp: parsed.timestamp || new Date().toISOString()
                };
            } catch {
                return {
                    raw: s,
                    parsed: null,
                    skip_reason: "CORRUPT_JSON",
                    is_triggered: false,
                    timestamp: new Date().toISOString()
                };
            }
        });

        // Fetch PnL for each unique trader in the signals
        const uniqueTraders = Array.from(new Set(rawSignals.map(s => s.parsed?.traderPublicKey).filter(Boolean)));

        let pnlMap: Record<string, number> = {};
        if (uniqueTraders.length > 0) {
            const result = await pool.query(
                `SELECT copy_trade_address, SUM(pnl_percentage * entry_sol_amount / 100.0) as total_net_sol
                 FROM copy_trade_trades
                 WHERE copy_trade_address = ANY($1)
                 GROUP BY copy_trade_address`,
                [uniqueTraders]
            );
            result.rows.forEach(row => {
                pnlMap[row.copy_trade_address] = parseFloat(row.total_net_sol || "0");
            });
        }

        return rawSignals.map(s => ({
            ...s,
            traderPnL: s.parsed?.traderPublicKey ? pnlMap[s.parsed.traderPublicKey] : undefined
        }));
    } catch (error) {
        console.error("❌ getCopyTradeSignals Redis Error:", error);
        return [];
    }
}

export async function getCopyTradeSniperDashboardData() {
    try {
        // 1. Fetch Stats & Wallet & History in parallel
        const [stats, wallet, history, exposure, pnlHistoryQuery] = await Promise.all([
            pool.query(`
                SELECT 
                    COUNT(*) as total_trades,
                    COUNT(*) FILTER (WHERE pnl_percentage > 0 AND status = 'CLOSED') as wins,
                    COALESCE(SUM(pnl_percentage), 0) as net_pnl_raw,
                    COALESCE(SUM(pnl_percentage * 0.1 / 100.0), 0) as net_pnl_sol,
                    COALESCE(AVG(pnl_percentage), 0) as avg_pnl,
                    COUNT(*) FILTER (WHERE status = 'OPEN') as active_trades
                FROM copy_trade_trades
            `),
            pool.query(`SELECT balance_sol FROM paper_wallets LIMIT 1`),
            pool.query(`
                SELECT token_mint, copy_trade_address, funding_source, entry_price, exit_price, pnl_percentage, status, entry_timestamp, exit_timestamp
                FROM copy_trade_trades
                ORDER BY entry_timestamp DESC
                LIMIT 20
            `),
            pool.query(`
                SELECT token_mint, copy_trade_address, funding_source, entry_price, pnl_percentage, entry_timestamp, status,
                       EXTRACT(EPOCH FROM (COALESCE(exit_timestamp, NOW()) - entry_timestamp)) as elapsed_seconds
                FROM copy_trade_trades
                WHERE status = 'OPEN' 
                   OR (status = 'CLOSED' AND exit_timestamp > NOW() - interval '10 seconds')
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
                        SUM(pnl_percentage * 0.1 / 100.0) as period_pnl
                    FROM copy_trade_trades
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

        // 2. Redis Operations
        await ensureRedis();
        const [triggerStrings, signalStrings] = await Promise.all([
            redisClient.lRange("copy_trade_recent_triggers", 0, 19),
            redisClient.lRange("copy_trade_signals_log", 0, 49)
        ]);

        return {
            stats: stats.rows[0],
            wallet: wallet.rows[0],
            history: history.rows,
            exposure: exposure.rows,
            triggers: triggerStrings.map(s => JSON.parse(s)),
            pnlHistory: pnlHistoryQuery.rows.map(row => ({
                time: new Date(row.time_bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                pnl: parseFloat(row.cumulative_pnl || "0")
            })),
            signals: signalStrings.map(s => {
                try {
                    const parsed = JSON.parse(s);
                    const traderAddress = parsed.parsed?.traderPublicKey;
                    // For the main dashboard feed, we don't fetch all separate PnLs individually here to save perf,
                    // but we ensure the structure matches what the frontend expects.
                    return {
                        raw: parsed.raw || s,
                        parsed: parsed.parsed || null,
                        skip_reason: parsed.skip_reason || "UNKNOWN",
                        is_triggered: !!parsed.is_triggered,
                        timestamp: parsed.timestamp || new Date().toISOString(),
                        traderPnL: undefined // Dashboard refresh will pick it up from individual signal feed if needed
                    };
                } catch {
                    return {
                        raw: s,
                        parsed: null,
                        skip_reason: "CORRUPT_JSON",
                        is_triggered: false,
                        timestamp: new Date().toISOString()
                    };
                }
            })
        };
    } catch (error) {
        console.error("❌ Copy-Trade Data Fetch Error:", error);
        return { error: String(error) };
    }
}

export async function resetCopyTradeWallet() {
    try {
        await pool.query("UPDATE paper_wallets SET balance_sol = 10.0 WHERE wallet_address = 'COPY_TRADE_MAIN_WAREHOUSE'");
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
}

export async function clearCopyTradeTrades() {
    try {
        await pool.query("TRUNCATE TABLE copy_trade_trades");
        await ensureRedis();
        await redisClient.flushAll();
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
}

export async function getCopyTradeSniperLogs(tailLines: number = 30) {
    const { execSync } = require('child_process');
    const containers = [
        { name: "SCOUT", container: "copy_trade_scout" },
        { name: "SNIPER", container: "copy_trade_sniper" },
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

export async function getCopyTradeSniperBotStatus() {
    const { execSync } = require('child_process');

    const bots = [
        {
            name: "SCOUT",
            codename: "Copy-Trade Scout",
            container: "copy_trade_scout",
            role: "PumpPortal Firehose → Immediate Trigger",
            keywords: {
                connected: ["Connecting to PumpPortal", "Subscribed", "[SCOUT] Connected", "[SCOUT] Standing by"],
                action: ["New token", "FILTER PASSED", "[COPY_TRADE BUY]", "[COPY_TRADE SELL]", "[SCOUT] Standing by"],
                error: ["Crashed", "Error", "panic", "FATAL", "SYSTEM_ERROR"],
            },
        },

        {
            name: "SNIPER",
            codename: "Copy-Trade Sniper",
            container: "copy_trade_sniper",
            role: "Redis trigger → +50% TP / -25% SL / 10m TS",
            keywords: {
                connected: ["Execution Engine Online", "Starting COPY_TRADE SNIPER", "Waiting for triggers", "[ASSASSIN] Standing by"],
                action: ["SNIPED", "Entered", "Closed", "HIT", "[ASSASSIN] Entered", "[ASSASSIN] Trigger Received", "Position Closed", "[ASSASSIN] Standing by"],
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
            } else if (bot.name === "SNIPER") {
                if (lastAction.includes("SNIPED") || lastAction.includes("BUY")) thinking = "💰 Entering momentum trade — 0.1 SOL";
                else if (lastAction.includes("SELL")) thinking = "📤 Target hit or TTL expired, exiting...";
                else if (lastAction.includes("Waiting")) thinking = "⏳ Armed and waiting for Copy-Trade Scout triggers...";
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

export async function getTrackedWallets() {
    try {
        const result = await pool.query(
            `SELECT id, wallet_address, label, status, added_at, retired_at, notes
             FROM tracked_wallets
             ORDER BY status ASC, added_at DESC`
        );
        return result.rows;
    } catch (error) {
        console.error("❌ getTrackedWallets Error:", error);
        return [];
    }
}

export async function addTrackedWallet(walletAddress: string, label?: string) {
    try {
        if (!walletAddress || walletAddress.trim().length < 32) {
            return { success: false, error: "Invalid wallet address" };
        }
        await pool.query(
            `INSERT INTO tracked_wallets (wallet_address, label, status)
             VALUES ($1, $2, 'ACTIVE')
             ON CONFLICT (wallet_address) 
             DO UPDATE SET status = 'ACTIVE', retired_at = NULL, label = COALESCE($2, tracked_wallets.label)`,
            [walletAddress.trim(), label?.trim() || null]
        );
        return { success: true };
    } catch (error) {
        console.error("❌ addTrackedWallet Error:", error);
        return { success: false, error: String(error) };
    }
}

export async function retireTrackedWallet(walletAddress: string) {
    try {
        await pool.query(
            `UPDATE tracked_wallets SET status = 'RETIRED', retired_at = NOW() WHERE wallet_address = $1`,
            [walletAddress]
        );
        return { success: true };
    } catch (error) {
        console.error("❌ retireTrackedWallet Error:", error);
        return { success: false, error: String(error) };
    }
}

export async function deleteTrackedWallet(walletAddress: string) {
    try {
        await pool.query(
            `DELETE FROM tracked_wallets WHERE wallet_address = $1`,
            [walletAddress]
        );
        return { success: true };
    } catch (error) {
        console.error("❌ deleteTrackedWallet Error:", error);
        return { success: false, error: String(error) };
    }
}
