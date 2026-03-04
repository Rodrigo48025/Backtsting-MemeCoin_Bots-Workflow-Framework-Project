"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { getCopyTradeSniperDashboardData } from "@/app/actions/copy-trade-sniper-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export function CopyTradeMetricsCard() {
    const { data: rawData } = useSWR('copy-trade-sniper-data', getCopyTradeSniperDashboardData, { refreshInterval: 2000 });
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (rawData && !rawData.error) {
            setData(rawData);
        }
    }, [rawData]);

    if (!data) return (
        <div className="h-[120px] flex items-center justify-center border border-neutral-900 bg-black">
            <span className="text-[8px] font-mono text-neutral-800 animate-pulse tracking-[0.5em] uppercase">V_INIT...</span>
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
            <CardContent className="px-3 py-2 flex-1 flex flex-col gap-3">
                <div className="flex justify-between items-center border-b border-neutral-900 pb-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-neutral-500">Performance_Vector</span>
                    <span className="text-[11px] font-mono text-neutral-700">BAL: {parseFloat(wallet.balance_sol || "0").toFixed(2)} SOL</span>
                </div>
                {/* Stats Grid */}
                <div className="grid grid-cols-5 gap-4 pt-1">
                    <div className="space-y-1">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Sol</span>
                        <div className="text-xl font-black text-white leading-none">{parseFloat(wallet.balance_sol || "0").toFixed(1)}</div>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Ops</span>
                        <div className="text-xl font-black text-white leading-none">{safeStats.total_trades}</div>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Live</span>
                        <div className="text-xl font-black text-white leading-none">{safeStats.active_trades}</div>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">PnL</span>
                        <div className={`text-xl font-black leading-none ${safeStats.net_return >= 0 ? "text-white" : "text-red-600"}`}>
                            {safeStats.net_return >= 0 ? "+" : ""}{safeStats.net_return.toFixed(1)}%
                        </div>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Win%</span>
                        <div className="text-xl font-black text-white leading-none">{safeStats.winrate.toFixed(0)}</div>
                    </div>
                </div>

                <div className="flex-1 w-full pt-4 border-t border-neutral-900/50 flex flex-col">
                    {/* PnL Chart - Self-correcting stretch to fill card height */}
                    <div className="flex-1 min-h-[160px] mt-2 -mx-3">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 0, right: 0, left: -40, bottom: 0 }}>
                                <XAxis
                                    dataKey="time"
                                    stroke="#171717"
                                    fontSize={7}
                                    tickLine={false}
                                    axisLine={false}
                                    minTickGap={60}
                                />
                                <YAxis
                                    stroke="#171717"
                                    fontSize={7}
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
                                    type="monotone"
                                    dataKey="pnl"
                                    stroke="#EAB308"
                                    strokeWidth={3}
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
