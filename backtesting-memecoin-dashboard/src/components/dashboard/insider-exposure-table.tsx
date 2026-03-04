"use client";

import useSWR from "swr";
import { useState, useEffect } from "react";
import { getInsiderDashboardData } from "@/app/actions/insider-data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function InsiderExposureTable() {
    const { data: rawData } = useSWR('insider-data', getInsiderDashboardData, { refreshInterval: 2000 });
    const [trades, setTrades] = useState<any[]>([]);
    const [now, setNow] = useState(Date.now());

    // Synchronize trades when new data arrives
    useEffect(() => {
        if (rawData?.exposure) {
            setTrades(rawData.exposure.map((t: any) => ({
                ...t,
                clientSyncTime: Date.now()
            })));
        }
    }, [rawData]);

    // Fast local clock for smooth TTL animations without hitting network
    useEffect(() => {
        const clockInterval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(clockInterval);
    }, []);

    const calculateRemaining = (trade: any) => {
        const TOTAL_TTL = 60; // Insider Trade: 60s Hard-TTL
        const serverElapsed = parseFloat(trade.elapsed_seconds || 0);
        const clientDrift = trade.clientSyncTime ? (now - trade.clientSyncTime) / 1000 : 0;
        const totalElapsed = serverElapsed + Math.max(0, clientDrift);
        const remaining = Math.max(0, TOTAL_TTL - totalElapsed);

        const seconds = Math.floor(remaining);
        return {
            text: `${seconds}s`,
            percentage: (remaining / TOTAL_TTL) * 100,
            urgent: remaining < 15
        };
    };

    if (trades.length === 0) return (
        <div className="flex flex-col items-center justify-center h-[120px] border border-neutral-800 font-mono gap-1 bg-black rounded-lg">
            <span className="text-neutral-500 text-[10px] uppercase font-bold tracking-widest animate-pulse">No_Live_Assisted_Trades</span>
        </div>
    );

    return (
        <div className="overflow-x-auto bg-black border border-neutral-800 rounded-lg p-2">
            <Table className="font-mono">
                <TableHeader>
                    <TableRow className="border-neutral-800 hover:bg-transparent">
                        <TableHead className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Micro_Target</TableHead>
                        <TableHead className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Insider_Flow</TableHead>
                        <TableHead className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Net_PNL</TableHead>
                        <TableHead className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider text-right">Micro_TTL</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {trades.map((t) => {
                        const ttl = calculateRemaining(t);
                        const pnl = parseFloat(t.pnl_percentage || 0);

                        return (
                            <TableRow key={t.token_mint} className="border-neutral-800 hover:bg-neutral-900/50 transition-colors">
                                <TableCell>
                                    <div className="flex flex-col">
                                        <a href={`https://gmgn.ai/sol/token/${t.token_mint}`} target="_blank" rel="noreferrer" className="text-xs font-bold text-white hover:text-neutral-300 hover:underline">
                                            {t.token_mint.slice(0, 10)}...
                                        </a>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col">
                                        {t.funding_source.includes("->") ? (
                                            <span className="text-[9px] text-neutral-400 uppercase font-black" title={t.funding_source}>
                                                <span className="text-red-500 text-[9px] font-black border border-red-500/30 px-1 mr-2">2-HOP</span>
                                                {t.funding_source.split("->")[0]}
                                            </span>
                                        ) : (
                                            <span className="text-[9px] text-neutral-400 uppercase font-black">{t.funding_source}</span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className={`font-bold text-xs ${pnl >= 0 ? "text-white" : "text-red-500"}`}>
                                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex flex-col items-end gap-1.5">
                                        <div className={`text-[10px] font-black tracking-widest ${ttl.urgent ? "text-red-500 animate-pulse" : "text-neutral-400"}`}>
                                            {ttl.text}
                                        </div>
                                        <div className="w-24 h-1 bg-neutral-900 rounded-none overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-1000 ${ttl.urgent ? "bg-red-500" : "bg-neutral-500"}`}
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
