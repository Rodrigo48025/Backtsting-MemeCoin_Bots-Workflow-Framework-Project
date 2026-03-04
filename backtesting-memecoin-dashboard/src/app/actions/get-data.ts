"use server";

import { query } from "@/lib/db";
import { createClient } from 'redis';

export async function clearIncubationQueue() {
  try {
    // 1. Clear PostgreSQL table (Ongoing WAITING tokens)
    await query("DELETE FROM incubating_targets WHERE status = 'WAITING'");

    // 2. Clear Redis delay queue
    const redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    await redisClient.connect();
    await redisClient.del('delayed_analysis_queue');
    await redisClient.quit();

    return { success: true };
  } catch (error) {
    console.error("❌ Failed to clear incubation queue:", error);
    return { success: false, error: String(error) };
  }
}

export async function getDashboardData() {
  try {
    // 1. Fetch Incubating Tokens (Shadow Pipeline)
    const incubatingTargets = await query(`
      SELECT mint_address, name, symbol, initial_buy_sol as initial_liquidity, status, mature_at 
      FROM incubating_targets 
      WHERE status = 'WAITING'
      ORDER BY discovered_at DESC 
      LIMIT 10
    `);

    // 2. Fetch Monitored Targets (Active Sniper)
    const activeTargets = await query(`
      SELECT mint_address, pool_address, initial_liquidity, status, found_at 
      FROM target_queue 
      ORDER BY found_at DESC 
      LIMIT 10
    `);

    // 3. Fetch Rejections
    const rejections = await query(`
      SELECT mint_address, rejection_reason, initial_price, current_status, rejected_at 
      FROM rejected_targets 
      ORDER BY rejected_at DESC 
      LIMIT 10
    `);

    // 4. Fetch Aggregate Performance Stats
    const stats = await query(`
      SELECT 
        COUNT(*) as total_trades,
        COUNT(*) FILTER (WHERE pnl_percentage > 0) as wins,
        SUM(pnl_percentage) as total_pnl,
        AVG(pnl_percentage) as avg_pnl
      FROM virtual_trades
    `);

    // 5. Fetch the last few trades
    const recentTrades = await query(`
      SELECT token_mint, direction, entry_price, pnl_percentage, status, entry_timestamp
      FROM virtual_trades
      ORDER BY entry_timestamp DESC
      LIMIT 5
    `);

    return {
      incubatingTargets: incubatingTargets.rows,
      activeTargets: activeTargets.rows,
      rejections: rejections.rows,
      stats: stats.rows[0] || { total_trades: 0, wins: 0, total_pnl: 0, avg_pnl: 0 },
      recentTrades: recentTrades.rows
    };
  } catch (error) {
    console.error("❌ Dashboard Data Fetch Error:", error);
    return null;
  }
}