"use client";

import useSWR from "swr";
import { getInsiderDashboardData } from "@/app/actions/insider-data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function InsiderWatchlistTable() {
    const { data: rawData } = useSWR('insider-data', getInsiderDashboardData, { refreshInterval: 2000 });
    const watchlist = rawData?.watchlist || [];

    if (watchlist.length === 0) return (
        <div className="flex flex-col items-center justify-center py-10 bg-black border border-neutral-800 rounded-lg font-mono">
            <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold">Scanning_Network_For_CEX_Flows...</span>
        </div>
    );

    return (
        <div className="overflow-x-auto bg-black border border-neutral-800 rounded-lg p-2">
            <Table className="font-mono min-w-[600px]">
                <TableHeader>
                    <TableRow className="border-neutral-800 hover:bg-transparent">
                        <TableHead className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Insider_Trader</TableHead>
                        <TableHead className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Provenance</TableHead>
                        <TableHead className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider text-center">Ops</TableHead>
                        <TableHead className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider text-center">Win%</TableHead>
                        <TableHead className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider text-center">Net_PnL</TableHead>
                        <TableHead className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider text-right">Expiration</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {watchlist.map((entry) => (
                        <TableRow key={entry.address} className="border-neutral-800 hover:bg-neutral-900/50 transition-colors">
                            <TableCell>
                                <a href={`https://solscan.io/account/${entry.address}`} target="_blank" rel="noreferrer" className="text-xs font-bold text-white hover:text-neutral-300 hover:underline transition-colors">
                                    {entry.address.slice(0, 8)}...{entry.address.slice(-4)}
                                </a>
                            </TableCell>
                            <TableCell>
                                <Badge className="rounded-none bg-neutral-900 text-neutral-300 hover:bg-neutral-800 border-neutral-800 text-[9px] uppercase font-black px-2 py-0.5 tracking-tight">
                                    {entry.source}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-center font-bold text-xs text-white">
                                {entry.trades}
                            </TableCell>
                            <TableCell className="text-center font-bold text-xs text-white">
                                {entry.winrate.toFixed(0)}%
                            </TableCell>
                            <TableCell className={`text-center font-bold text-xs ${entry.netPnl >= 0 ? "text-white" : "text-red-500"}`}>
                                {entry.netPnl >= 0 ? "+" : ""}{entry.netPnl.toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="text-[10px] text-neutral-400 font-bold tracking-widest">
                                    {Math.floor(entry.ttl / 60)}M {entry.ttl % 60}S
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
