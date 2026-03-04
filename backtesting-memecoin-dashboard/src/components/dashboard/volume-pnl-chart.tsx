"use client";

import useSWR from "swr";
import { getVolumeDashboardData } from "@/app/actions/volume-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export function VolumePnlChart() {
    const { data } = useSWR('volume-data', getVolumeDashboardData, { refreshInterval: 2000 });

    if (!data?.pnlHistory) return null;

    const chartData = data.pnlHistory;

    return (
        <Card className="bg-black border-neutral-800 rounded-none shadow-none mt-4 md:mt-8">
            <CardHeader className="px-4 py-3 md:pb-2 border-b border-neutral-900 flex flex-row justify-between items-center">
                <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Momentum_PnL_Vector</CardTitle>
                <div className="text-[8px] text-neutral-600 font-bold uppercase tracking-widest hidden md:block">Real_Time_Cumulative_Return</div>
            </CardHeader>
            <CardContent className="px-2 pt-6 pb-2">
                <div className="h-[150px] md:h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                            <XAxis
                                dataKey="time"
                                stroke="#404040"
                                fontSize={8}
                                tickLine={false}
                                axisLine={false}
                                minTickGap={30}
                            />
                            <YAxis
                                stroke="#404040"
                                fontSize={8}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(value) => `${value}%`}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: "#000", border: "1px solid #262626", fontSize: "10px", fontFamily: "monospace" }}
                                itemStyle={{ color: "#fff" }}
                            />
                            <ReferenceLine y={0} stroke="#262626" />
                            <Line
                                type="stepAfter"
                                dataKey="pnl"
                                stroke="#fff"
                                strokeWidth={2}
                                dot={false}
                                animationDuration={300}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
