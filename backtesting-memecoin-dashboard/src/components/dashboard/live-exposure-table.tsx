"use client";

import { useEffect, useState } from "react";
import { getMilestoneDashboardData } from "@/app/actions/milestone-data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Timer, ExternalLink, TrendingUp, TrendingDown, Clock } from "lucide-react";

export function LiveExposureTable() {
    const [trades, setTrades] = useState<any[]>([]);
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const fetch = async () => {
            const data = await getMilestoneDashboardData();
            if (data && data.liveExposure) {
                setTrades(data.liveExposure);
            }
        };
        fetch();
        const interval = setInterval(fetch, 2000);
        const clockInterval = setInterval(() => setNow(Date.now()), 1000);
        return () => {
            clearInterval(interval);
            clearInterval(clockInterval);
        };
    }, []);

    const calculateRemaining = (discoveryTime: string) => {
        const TOTAL_TTL = 5 * 60; // Speed Scalper Meta: 5m
        const start = new Date(discoveryTime).getTime();
        const elapsed = (now - start) / 1000;
        const remaining = Math.max(0, TOTAL_TTL - elapsed);

        const minutes = Math.floor(remaining / 60);
        const seconds = Math.floor(remaining % 60);
        return {
            text: `${minutes}:${seconds.toString().padStart(2, '0')}`,
            percentage: (remaining / TOTAL_TTL) * 100,
            urgent: remaining < 120 // Urgent when < 2 mins
        };
    };

    if (trades.length === 0) return (
        <div className="flex flex-col items-center justify-center h-[80px] md:h-[120px] border border-dashed border-zinc-800 font-mono gap-1 bg-zinc-950/20">
            <Clock className="h-4 w-4 text-zinc-700 animate-pulse" />
            <span className="text-zinc-600 text-[8px] uppercase font-bold tracking-[.15em]">Zero_Exposure</span>
        </div>
    );

    return (
        <div className="overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0">
            <Table className="font-mono min-w-[360px]">
                <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent text-[8px] md:text-[9px]">
                        <TableHead className="uppercase font-bold text-zinc-400 px-2">
                            <div className="flex items-center gap-1.5">
                                Target
                                <span className="bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800 text-[7px] text-zinc-500">
                                    {trades.length}
                                </span>
                            </div>
                        </TableHead>
                        <TableHead className="uppercase font-bold text-zinc-400 text-right px-2">PnL</TableHead>
                        <TableHead className="uppercase font-bold text-zinc-400 text-right px-2">TTL</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {trades.map((t) => {
                        const ttl = calculateRemaining(t.discovery_timestamp);
                        const pnl = parseFloat(t.pnl_percentage || 0);

                        return (
                            <TableRow key={t.token_mint} className="border-zinc-900 hover:bg-zinc-900/50 transition-colors">
                                <TableCell className="py-1.5 md:py-2 px-2">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[9px] md:text-[10px] font-bold text-zinc-100">{t.token_mint.slice(0, 6)}</span>
                                        <a href={`https://gmgn.ai/sol/token/${t.token_mint}`} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-white transition-colors">
                                            <ExternalLink className="h-2.5 w-2.5" />
                                        </a>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right py-1.5 md:py-2 px-2">
                                    <div className={`flex items-center justify-end gap-1 font-bold text-[10px] md:text-[11px] ${pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                                        {pnl >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%
                                    </div>
                                </TableCell>
                                <TableCell className="text-right py-1.5 md:py-2 px-2">
                                    <div className="flex flex-col items-end gap-1 min-w-[50px]">
                                        <div className={`flex items-center gap-1 text-[9px] md:text-[10px] font-bold ${ttl.urgent ? "text-amber-500 animate-pulse" : "text-zinc-300"}`}>
                                            <Timer className="h-2.5 w-2.5" />
                                            {ttl.text}
                                        </div>
                                        <div className="w-full h-0.5 bg-zinc-900 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-1000 ${ttl.urgent ? "bg-amber-600" : "bg-zinc-400"}`}
                                                style={{ width: `${ttl.percentage}%` }}
                                            />
                                        </div>
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
