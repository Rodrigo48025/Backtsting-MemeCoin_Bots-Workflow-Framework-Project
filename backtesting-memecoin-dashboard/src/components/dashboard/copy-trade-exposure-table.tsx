"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { getCopyTradeSniperDashboardData } from "@/app/actions/copy-trade-sniper-data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CopyTradeExposureTable() {
    const { data: rawData } = useSWR('copy-trade-sniper-data', getCopyTradeSniperDashboardData, { refreshInterval: 2000 });
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (rawData && !rawData.error) {
            setData(rawData);
        }
    }, [rawData]);

    const exposure = data?.exposure || [];

    return (
        <Card className="bg-black border-neutral-900 rounded-none shadow-none overflow-hidden h-full">
            <CardHeader className="px-4 py-3 border-b border-neutral-900">
                <CardTitle className="text-[10px] font-bold uppercase tracking-[0.4em] text-neutral-500">Active_CopyTrade_Snipes</CardTitle>
            </CardHeader>
            <CardContent className="px-0 py-0">
                <Table>
                    <TableHeader className="bg-neutral-950 border-b border-neutral-900">
                        <TableRow className="hover:bg-transparent border-none">
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Asset</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Entry</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">PnL</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600 text-right">Age</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {exposure.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-[9px] font-mono text-center py-20 text-neutral-800 tracking-widest uppercase italic">Empty_Queue</TableCell>
                            </TableRow>
                        ) : (
                            exposure.map((trade: any, i: number) => (
                                <TableRow key={i} className={`border-b border-neutral-900/50 hover:bg-neutral-900/50 transition-colors ${trade.status === 'CLOSED' ? 'opacity-50 grayscale-[0.5]' : ''}`}>
                                    <TableCell className="text-[9px] font-mono p-4 text-white">
                                        <div className="flex items-center gap-2">
                                            <a
                                                href={`https://gmgn.ai/sol/token/${trade.token_mint}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="hover:text-yellow-500 transition-colors"
                                            >
                                                {trade.token_mint.slice(0, 8)}.
                                            </a>
                                            {trade.status === 'CLOSED' && (
                                                <span className="text-[6px] bg-red-950 text-red-500 px-1 py-0.5 rounded font-black border border-red-900 animate-pulse">
                                                    EXITED
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-[9px] font-mono p-4 text-neutral-400">
                                        ${parseFloat(trade.entry_price).toFixed(10)}
                                    </TableCell>
                                    <TableCell className={`text-[9px] font-mono p-4 font-black ${parseFloat(trade.pnl_percentage) >= 0 ? "text-white" : "text-red-600"}`}>
                                        {parseFloat(trade.pnl_percentage) >= 0 ? "+" : ""}{parseFloat(trade.pnl_percentage).toFixed(2)}%
                                    </TableCell>
                                    <TableCell className="text-[9px] font-mono p-4 text-right text-neutral-600 font-bold">
                                        {trade.status === 'CLOSED' ? "DONE" : `${Math.floor(trade.elapsed_seconds)}s`}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
