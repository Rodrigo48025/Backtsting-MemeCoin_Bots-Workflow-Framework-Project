"use client";

import useSWR from "swr";
import { getInsiderDashboardData } from "@/app/actions/insider-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, Area } from "recharts";

export function InsiderPnlChart() {
    const { data: rawData } = useSWR('insider-data', getInsiderDashboardData, { refreshInterval: 2000 });
    const data = rawData?.pnlHistory || [];

    if (data.length === 0) {
        return <div className="text-xs font-mono uppercase tracking-widest text-neutral-500 animate-pulse py-10 text-center border-t border-b border-white/10 my-4 bg-black">Acquiring Telemetry...</div>;
    }

    // Check if the most recent PnL period is positive or negative to color the area graph
    const latestPnl = data[data.length - 1]?.pnl || 0;
    const isPositive = latestPnl >= 0;

    return (
        <Card className="bg-black border-neutral-800 rounded-none shadow-none font-mono mt-4">
            <CardHeader className="px-4 py-3 border-b border-neutral-900 justify-between flex flex-row items-center">
                <CardTitle className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-500">All-Time Cumulative PnL (5m Intervals)</CardTitle>
                <div className={`text-xs font-bold ${isPositive ? 'text-[#00ff9d]' : 'text-red-500'}`}>
                    {isPositive ? '+' : ''}{latestPnl.toFixed(2)}%
                </div>
            </CardHeader>
            <CardContent className="px-0 pb-0 pt-4">
                <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                            data={data}
                            margin={{ top: 5, right: 0, left: -20, bottom: 0 }}
                        >
                            <defs>
                                <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={isPositive ? "#00ff9d" : "#ef4444"} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={isPositive ? "#00ff9d" : "#ef4444"} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                            <XAxis
                                dataKey="time"
                                stroke="#666"
                                fontSize={9}
                                tickLine={false}
                                axisLine={false}
                                tickMargin={10}
                            />
                            <YAxis
                                stroke="#666"
                                fontSize={9}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(value) => `${value}%`}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#000', borderColor: '#333', fontSize: '10px' }}
                                itemStyle={{ color: '#fff' }}
                                formatter={(value: number) => [`${value.toFixed(2)}%`, 'PnL']}
                                labelStyle={{ color: '#888', marginBottom: '4px' }}
                            />
                            <Area
                                type="monotone"
                                dataKey="pnl"
                                stroke={isPositive ? "#00ff9d" : "#ef4444"}
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorPnl)"
                                animationDuration={300}
                                isAnimationActive={false} // Disable animation for pure real-time feel
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
