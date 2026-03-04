"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { getMilestoneDashboardData } from "@/app/actions/milestone-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function MilestoneStats() {
    const { data: rawData } = useSWR('milestone-data', getMilestoneDashboardData, { refreshInterval: 2000 });
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (rawData) setData(rawData);
    }, [rawData]);

    if (!data) return <div className="text-[10px] font-mono uppercase tracking-widest animate-pulse">Initializing_Milestone_Link...</div>;

    if (data.error) {
        return (
            <div className="p-3 border border-red-500/50 bg-red-500/10 font-mono text-red-500 rounded-none">
                <p className="text-[10px] font-bold uppercase tracking-widest">⚠️ Connection_Error</p>
                <p className="text-[9px] mt-1 opacity-80">{data.error}</p>
            </div>
        );
    }

    const stats = data.stats || { total_trades: 0, wins: 0, total_pnl: 0, avg_pnl: 0 };
    const wallet = data.wallet || { balance: 10.0, open_sol: 0.0 };

    const safeStats = {
        total_trades: parseInt(stats.total_trades || "0"),
        wins: parseInt(stats.wins || "0"),
        active_trades: parseInt(stats.active_trades || "0"),
        total_pnl: parseFloat(stats.total_pnl || "0"),
        avg_pnl: parseFloat(stats.avg_pnl || "0"),
    };

    const walletBalance = wallet.balance ?? 10.0;
    const openSol = wallet.open_sol ?? 0.0;
    const totalEquity = walletBalance + openSol;

    return (
        <div className="flex flex-col gap-3 md:gap-4">
            {/* Wallet & Volume Row — 2 cols on mobile, 5 on desktop */}
            <div className="grid gap-2 md:gap-3 grid-cols-2 md:grid-cols-5 font-mono">
                <Card className="bg-zinc-900/50 border-blue-500/30 rounded-none border-l-4">
                    <CardHeader className="px-3 py-2 md:pb-1">
                        <CardTitle className="text-[8px] md:text-[9px] font-bold uppercase tracking-widest text-blue-400">Balance</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-2">
                        <div className="text-lg md:text-2xl font-black text-white">{walletBalance.toFixed(2)}<span className="text-[10px] text-zinc-500 ml-1">SOL</span></div>
                    </CardContent>
                </Card>

                <Card className="bg-zinc-900/50 border-orange-500/30 rounded-none border-l-4">
                    <CardHeader className="px-3 py-2 md:pb-1">
                        <CardTitle className="text-[8px] md:text-[9px] font-bold uppercase tracking-widest text-orange-400">Trades</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-2">
                        <div className="text-lg md:text-2xl font-black text-white">{safeStats.total_trades}</div>
                    </CardContent>
                </Card>

                <Card className="bg-zinc-900/50 border-red-500/30 rounded-none border-l-4">
                    <CardHeader className="px-3 py-2 md:pb-1">
                        <CardTitle className="text-[8px] md:text-[9px] font-bold uppercase tracking-widest text-red-400">Active</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-2">
                        <div className="text-lg md:text-2xl font-black text-white">{safeStats.active_trades}</div>
                    </CardContent>
                </Card>

                <Card className="bg-zinc-900/50 border-zinc-700 rounded-none border-l-4">
                    <CardHeader className="px-3 py-2 md:pb-1">
                        <CardTitle className="text-[8px] md:text-[9px] font-bold uppercase tracking-widest text-zinc-400">Exposure</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-2">
                        <div className="text-lg md:text-2xl font-black text-white">{openSol.toFixed(2)}<span className="text-[10px] text-zinc-500 ml-1">SOL</span></div>
                    </CardContent>
                </Card>

                <Card className="bg-zinc-900/50 border-emerald-500/30 rounded-none border-l-4 col-span-2 md:col-span-1">
                    <CardHeader className="px-3 py-2 md:pb-1">
                        <CardTitle className="text-[8px] md:text-[9px] font-bold uppercase tracking-widest text-emerald-400">Equity</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-2">
                        <div className="text-lg md:text-2xl font-black text-white">{totalEquity.toFixed(2)}<span className="text-[10px] text-zinc-500 ml-1">SOL</span></div>
                    </CardContent>
                </Card>
            </div>

            {/* Performance Row — 2 cols on mobile, 4 on desktop */}
            <div className="grid gap-2 md:gap-3 grid-cols-2 lg:grid-cols-4 font-mono">
                <Card className="bg-black border-zinc-700 rounded-none">
                    <CardHeader className="px-3 py-2 md:pb-1">
                        <CardTitle className="text-[8px] md:text-[10px] font-bold uppercase tracking-widest text-zinc-400">Net_PnL</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-2">
                        <div className={`text-base md:text-xl font-bold ${safeStats.total_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {safeStats.total_pnl >= 0 ? "+" : ""}{safeStats.total_pnl.toFixed(2)}%
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-black border-zinc-700 rounded-none">
                    <CardHeader className="px-3 py-2 md:pb-1">
                        <CardTitle className="text-[8px] md:text-[10px] font-bold uppercase tracking-widest text-zinc-400">Win_Rate</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-2">
                        <div className="text-base md:text-xl font-bold text-white">
                            {safeStats.total_trades > 0 ? ((safeStats.wins / safeStats.total_trades) * 100).toFixed(1) : 0}%
                        </div>
                        <p className="text-[8px] text-zinc-500 uppercase">{safeStats.total_trades} Exec</p>
                    </CardContent>
                </Card>

                <Card className="bg-black border-zinc-700 rounded-none">
                    <CardHeader className="px-3 py-2 md:pb-1">
                        <CardTitle className="text-[8px] md:text-[10px] font-bold uppercase tracking-widest text-zinc-400">Avg_Perf</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-2">
                        <div className="text-base md:text-xl font-bold text-white">
                            {safeStats.avg_pnl.toFixed(2)}%
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-black border-zinc-700 rounded-none">
                    <CardHeader className="px-3 py-2 md:pb-1">
                        <CardTitle className="text-[8px] md:text-[10px] font-bold uppercase tracking-widest text-zinc-400">Strategy</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-2">
                        <div className="text-base md:text-xl font-bold text-white tracking-tighter">BOT_8</div>
                        <p className="text-[8px] text-zinc-500 uppercase">Speed Scalper</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
