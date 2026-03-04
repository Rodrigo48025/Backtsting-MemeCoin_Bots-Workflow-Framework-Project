"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { getEarlySniperDashboardData } from "@/app/actions/early-sniper-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export function EarlyMetricsCard() {
    const { data: rawData } = useSWR('early-sniper-data', getEarlySniperDashboardData, { refreshInterval: 2000 });
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (rawData && !rawData.error) {
            setData(rawData);
        } else if (rawData?.error) {
            setData(rawData);
        }
    }, [rawData]);

    if (data?.isOffline) return (
        <div className="h-[400px] flex items-center justify-center border border-red-900/30 bg-red-950/10 font-mono">
            <span className="text-red-500 text-[10px] uppercase font-bold animate-pulse tracking-[0.5em]">Status: SERVICE_OFFLINE // Check_Docker_Compose</span>
        </div>
    );

    if (!data) return (
        <div className="h-[400px] flex items-center justify-center border border-neutral-900 bg-black">
            <span className="text-[10px] font-mono text-neutral-600 animate-pulse tracking-[0.5em] uppercase">Initializing_Data_Vector...</span>
        </div>
    );

    const stats = data.stats || { total_trades: 0, wins: 0, net_pnl_sol: 0, avg_pnl: 0, active_trades: 0 };
    const wallet = data.wallet || { balance_sol: 10.0 };
    const chartData = data.pnl_history || data.pnlHistory || [];

    const startingBalance = 10.0;
    const safeStats = {
        total_trades: parseInt(stats.total_trades || "0"),
        wins: parseInt(stats.wins || "0"),
        active_trades: parseInt(stats.active_trades || "0"),
        net_return: stats.total_trades > 0 ? (parseFloat(wallet.balance_sol || "10") - startingBalance) / startingBalance * 100 : 0,
        winrate: stats.total_trades > 0 ? (parseInt(stats.wins) / parseInt(stats.total_trades)) * 100 : 0,
    };

    return (
        <Card className="bg-black border-neutral-900 rounded-none shadow-none h-full flex flex-col">
            <CardHeader className="px-6 py-4 border-b border-neutral-900 flex flex-row justify-between items-end">
                <div className="space-y-1">
                    <CardTitle className="text-[10px] font-bold uppercase tracking-[0.4em] text-neutral-500">Early_Sniper_Performance</CardTitle>
                    <div className="text-[8px] text-neutral-700 font-bold uppercase tracking-widest">Real_Time_Statistical_Aggregate</div>
                </div>
                <div className="text-[10px] font-mono text-neutral-600">FLOAT: 10.00 SOL</div>
            </CardHeader>
            <CardContent className="px-6 py-6 flex-1 flex flex-col gap-8">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="space-y-1">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Warehouse</span>
                        <div className="text-2xl font-black text-white">{parseFloat(wallet.balance_sol || "0").toFixed(2)}<span className="text-[8px] text-neutral-500 ml-1">SOL</span></div>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Trades</span>
                        <div className="text-2xl font-black text-white">{safeStats.total_trades}</div>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Active_Ops</span>
                        <div className="text-2xl font-black text-white">{safeStats.active_trades}</div>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Net_Result</span>
                        <div className={`text-2xl font-black ${safeStats.net_return >= 0 ? "text-white" : "text-red-600"}`}>
                            {safeStats.net_return >= 0 ? "+" : ""}{safeStats.net_return.toFixed(1)}%
                        </div>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Accuracy</span>
                        <div className="text-2xl font-black text-white">{safeStats.winrate.toFixed(0)}%</div>
                    </div>
                </div>

                {/* Chart Area */}
                <div className="flex-1 min-h-[200px] w-full pt-4 border-t border-neutral-900/50">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-[8px] font-bold text-neutral-700 uppercase tracking-[0.4em]">PnL_Vector_Stream</span>
                    </div>
                    <div className="h-[200px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                                <XAxis
                                    dataKey="time"
                                    stroke="#262626"
                                    fontSize={8}
                                    tickLine={false}
                                    axisLine={false}
                                    minTickGap={40}
                                />
                                <YAxis
                                    stroke="#262626"
                                    fontSize={8}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(v) => `${v}%`}
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: "#000", border: "1px solid #171717", fontSize: "9px", fontFamily: "monospace", borderRadius: "0px" }}
                                    itemStyle={{ color: "#FFF" }}
                                    cursor={{ stroke: '#404040', strokeWidth: 1 }}
                                />
                                <ReferenceLine y={0} stroke="#171717" />
                                <Line
                                    type="stepAfter"
                                    dataKey="pnl"
                                    stroke="#EAB308"
                                    strokeWidth={2}
                                    dot={false}
                                    animationDuration={0}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
