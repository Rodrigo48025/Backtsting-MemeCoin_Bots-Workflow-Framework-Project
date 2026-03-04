"use server";

import { milestoneQuery } from "@/lib/db";
import { getRedisClientWithTimeout } from "@/lib/redis";
import { revalidatePath } from 'next/cache';

export async function getMilestoneDashboardData() {
    try {
        // 1. Fetch Monitored Targets (Active Sniper)
        const activeTargets = await milestoneQuery(`
      SELECT mint_address, pool_address, initial_liquidity, status, found_at 
      FROM target_queue 
      ORDER BY found_at DESC
    `);

        // 2. Fetch Rejections
        const rejections = await milestoneQuery(`
      SELECT mint_address, rejection_reason, initial_price, current_status, rejected_at 
      FROM rejected_targets 
      ORDER BY rejected_at DESC
    `);

        // 3. Fetch Aggregate Performance Stats (Completed Trades Only)
        const stats = await milestoneQuery(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'CLOSED') as total_trades,
        COUNT(*) FILTER (WHERE status = 'CLOSED' AND pnl_percentage > 0) as wins,
        COUNT(*) FILTER (WHERE status = 'OPEN' AND discovery_timestamp > NOW() - INTERVAL '5 minutes') as active_trades,
        COALESCE(AVG(pnl_percentage) FILTER (WHERE status = 'CLOSED'), 0) as avg_pnl
      FROM virtual_trades
    `);

        // 4. Fetch recent trades
        const recentTrades = await milestoneQuery(`
      SELECT token_mint, direction, entry_price, pnl_percentage, status, entry_timestamp
      FROM virtual_trades
      ORDER BY entry_timestamp DESC
      LIMIT 5
    `);

        // 5. Fetch Wallet State
        const wallet = await milestoneQuery(`SELECT balance_sol FROM paper_wallets LIMIT 1`);

        // 6. Fetch Open Trade SOL (Cost Basis)
        const openSolResult = await milestoneQuery(`
            SELECT COALESCE(SUM(entry_sol_amount), 0) as open_sol 
            FROM virtual_trades 
            WHERE status = 'OPEN'
        `);

        // 7. Calculate Portfolio PnL
        const INITIAL_BALANCE = 2.0;
        const currentBalance = parseFloat(wallet.rows[0]?.balance_sol ?? "10.0");
        const openSolValue = parseFloat(openSolResult.rows[0]?.open_sol || "0.0");
        const totalEquity = currentBalance + openSolValue;
        const portfolioPnL = ((totalEquity - INITIAL_BALANCE) / INITIAL_BALANCE) * 100;

        const tradesCount = parseInt(stats.rows[0]?.total_trades || "0");
        const avgPortfolioPnL = tradesCount > 0 ? portfolioPnL / tradesCount : 0;

        // 8. Fetch Active Trades (Live Exposure)
        const activeTrades = await milestoneQuery(`
            SELECT token_mint, entry_price, pnl_percentage, discovery_timestamp, entry_timestamp
            FROM virtual_trades
            WHERE status = 'OPEN'
              AND discovery_timestamp > NOW() - INTERVAL '5 minutes'
            ORDER BY entry_timestamp DESC
        `);

        // 9. Fetch System Status from Redis with 1s timeout
        const redisUrl = process.env.MILESTONE_REDIS_URL || 'redis://localhost:6385';
        const redisClient = await getRedisClientWithTimeout(redisUrl);

        let systemStatus = "OFFLINE";
        if (redisClient) {
            try {
                systemStatus = await redisClient.get("milestone_system_status") || "FULLY_OPERATIONAL";
                await redisClient.disconnect();
            } catch (e) {
                console.warn("⚠️ Milestone Redis Command Error:", e);
            }
        }

        return {
            activeTargets: activeTargets.rows,
            rejections: rejections.rows,
            stats: {
                ...(stats.rows[0] || { total_trades: 0, wins: 0 }),
                total_pnl: portfolioPnL, // Corrected Portfolio Return
                avg_pnl: avgPortfolioPnL   // Corrected average impact per trade
            },
            recentTrades: recentTrades.rows,
            wallet: {
                balance: currentBalance,
                open_sol: openSolValue
            },
            liveExposure: activeTrades.rows,
            systemStatus
        };
    } catch (error: any) {
        console.error("❌ Milestone Dashboard Data Fetch Error:", error);
        return {
            error: String(error.message || error),
            isOffline: true
        };
    }
}

export async function clearMilestoneRejections() {
    try {
        await milestoneQuery("TRUNCATE TABLE rejected_targets");
        return { success: true };
    } catch (error) {
        console.error("❌ Failed to clear milestone rejections:", error);
        return { success: false, error: String(error) };
    }
}

export async function clearMilestoneTargets() {
    try {
        await milestoneQuery("TRUNCATE TABLE target_queue");
        return { success: true };
    } catch (error) {
        console.error("❌ Failed to clear milestone targets:", error);
        return { success: false, error: String(error) };
    }
}

export async function wipeMilestoneRedis() {
    try {
        const redisUrl = process.env.MILESTONE_REDIS_URL || 'redis://localhost:6385';
        const client = await getRedisClientWithTimeout(redisUrl);
        if (client) {
            await client.flushAll();
            await client.disconnect();
            return { success: true };
        }
        return { success: false, error: "Redis Offline" };
    } catch (error: any) {
        console.error("Milestone Redis Flush Error:", error);
        return { success: false, error: error.message };
    }
}

export async function factoryResetMilestone() {
    try {
        // 1. Purge all operational data
        await milestoneQuery(`TRUNCATE TABLE virtual_trades, rejected_targets, target_queue, tick_logs CASCADE`);

        // 2. Reset Wallet
        await milestoneQuery(`UPDATE paper_wallets SET balance_sol = 2.0, last_updated = NOW()`);

        // 3. Flush Redis
        const redisUrl = process.env.MILESTONE_REDIS_URL || 'redis://localhost:6385';
        const redis = await getRedisClientWithTimeout(redisUrl);
        if (redis) {
            await redis.flushAll();
            await redis.disconnect();
        }

        revalidatePath('/milestone-protocol');
        return { success: true };
    } catch (e: any) {
        console.error("Factory Reset Error:", e);
        return { success: false, error: "RESET_FAILED" };
    }
}

export async function panicSellMilestone() {
    try {
        const redisUrl = process.env.MILESTONE_REDIS_URL || 'redis://localhost:6385';
        const redis = await getRedisClientWithTimeout(redisUrl);
        if (redis) {
            // Broadcast PANIC_SELL signal
            await redis.publish('milestone_commands', 'PANIC_SELL');
            await redis.disconnect();
            return { success: true };
        }
        return { success: false, error: "OFFLINE" };
    } catch (e: any) {
        console.error("Panic Sell Error:", e);
        return { success: false, error: "PANIC_SIGNAL_FAILED" };
    }
}
