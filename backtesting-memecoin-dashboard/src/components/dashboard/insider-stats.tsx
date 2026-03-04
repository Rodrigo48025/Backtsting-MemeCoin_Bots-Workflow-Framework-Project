"use client";

import useSWR from "swr";
import { getInsiderDashboardData } from "@/app/actions/insider-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function InsiderStats() {
    const { data } = useSWR('insider-data', getInsiderDashboardData, { refreshInterval: 2000 });

    if (data?.isOffline) return (
        <div className="flex items-center justify-center h-[100px] border border-red-900/30 bg-red-950/10 font-mono">
            <span className="text-red-500 text-[10px] uppercase font-bold animate-pulse">Status: SYSTEM_OFFLINE // Check_Docker_Compose</span>
        </div>
    );

    if (!data) return <div className="text-xs font-mono uppercase tracking-widest text-neutral-500 animate-pulse">Initializing System...</div>;

    const stats = data.stats || { total_trades: 0, wins: 0, total_pnl: 0, avg_pnl: 0 };
    const wallet = data.wallet || { balance_sol: 10.0 };

    const safeStats = {
        total_trades: parseInt(stats.total_trades || "0"),
        wins: parseInt(stats.wins || "0"),
        active_trades: parseInt(stats.active_trades || "0"),
        net_pnl_sol: parseFloat(stats.net_pnl_sol || "0"),
        net_pnl_percentage: (parseFloat(stats.net_pnl_sol || "0") / 2.0) * 100,
        avg_pnl: parseFloat(stats.avg_pnl || "0"),
    };

    const walletBalance = parseFloat(wallet.balance_sol || "10.0");

    return (
        <div className="flex flex-col gap-3 md:gap-4 font-mono">
            <div className="grid gap-2 md:gap-3 grid-cols-2 lg:grid-cols-5">
                <Card className="bg-black border-neutral-800 rounded-none shadow-none">
                    <CardHeader className="px-4 py-3 md:pb-2 border-b border-neutral-900">
                        <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Warehouse</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pt-3 pb-3">
                        <div className="text-lg md:text-2xl font-black text-white">{walletBalance.toFixed(2)}<span className="text-[10px] text-neutral-500 ml-2 font-normal">SOL</span></div>
                    </CardContent>
                </Card>

                <Card className="bg-black border-neutral-800 rounded-none shadow-none">
                    <CardHeader className="px-4 py-3 md:pb-2 border-b border-neutral-900">
                        <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Trades</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pt-3 pb-3">
                        <div className="text-lg md:text-2xl font-black text-white">{safeStats.total_trades}</div>
                    </CardContent>
                </Card>

                <Card className="bg-black border-neutral-800 rounded-none shadow-none">
                    <CardHeader className="px-4 py-3 md:pb-2 border-b border-neutral-900">
                        <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Active_Ops</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pt-3 pb-3">
                        <div className="text-lg md:text-2xl font-black text-white">{safeStats.active_trades}</div>
                    </CardContent>
                </Card>

                <Card className="bg-black border-neutral-800 rounded-none shadow-none">
                    <CardHeader className="px-4 py-3 md:pb-2 border-b border-neutral-900">
                        <CardTitle className={`text-[10px] font-bold uppercase tracking-widest ${safeStats.net_pnl_percentage >= 0 ? 'text-white' : 'text-red-500'}`}>Net_Return</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pt-3 pb-3">
                        <div className={`text-lg md:text-2xl font-black ${safeStats.net_pnl_percentage >= 0 ? 'text-white' : 'text-red-500'}`}>{safeStats.net_pnl_percentage >= 0 ? "+" : ""}{safeStats.net_pnl_percentage.toFixed(1)}%</div>
                    </CardContent>
                </Card>

                <Card className="bg-black border-neutral-800 rounded-none shadow-none col-span-2 lg:col-span-1">
                    <CardHeader className="px-4 py-3 md:pb-2 border-b border-neutral-900">
                        <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Winrate</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pt-3 pb-3">
                        <div className="text-lg md:text-2xl font-black text-white">
                            {safeStats.total_trades > 0 ? ((safeStats.wins / safeStats.total_trades) * 100).toFixed(0) : 0}%
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
