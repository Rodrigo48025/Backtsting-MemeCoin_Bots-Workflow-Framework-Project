"use client";

import useSWR from "swr";
import { getInsiderDashboardData } from "@/app/actions/insider-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function InsiderHistoryTable() {
    const { data } = useSWR('insider-data', getInsiderDashboardData, { refreshInterval: 2000 });
    const history = data?.history || [];

    return (
        <Card className="bg-black border-neutral-900 rounded-none shadow-none overflow-hidden h-full">
            <CardHeader className="px-4 py-3 border-b border-neutral-900">
                <CardTitle className="text-[10px] font-bold uppercase tracking-[0.4em] text-neutral-500">Transaction_History (Postgres)</CardTitle>
            </CardHeader>
            <CardContent className="px-0 py-0">
                <Table>
                    <TableHeader className="bg-neutral-950 border-b border-neutral-900">
                        <TableRow className="hover:bg-transparent border-none">
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Asset</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Insider</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">PnL_%</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Status</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600 text-right">Time</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {history.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-[9px] font-mono text-center py-20 text-neutral-800 tracking-widest uppercase italic border-none">No_Historical_Data</TableCell>
                            </TableRow>
                        ) : (
                            history.map((trade: any, i: number) => {
                                const pnl = parseFloat(trade.pnl_percentage || "0");
                                const isWin = pnl > 0;
                                const isLoss = pnl < 0;
                                return (
                                    <TableRow key={i} className="border-b border-neutral-900/50 hover:bg-neutral-900/50 transition-colors">
                                        <TableCell className="text-[9px] font-mono p-4 text-white">
                                            <a
                                                href={`https://gmgn.ai/sol/token/${trade.token_mint}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="hover:text-yellow-500 transition-colors"
                                            >
                                                {trade.token_mint?.slice(0, 8)}.
                                            </a>
                                        </TableCell>
                                        <TableCell className="text-[9px] font-mono p-4 text-neutral-400">
                                            {trade.insider_address?.slice(0, 4)}...{trade.insider_address?.slice(-4)}
                                        </TableCell>
                                        <TableCell className={`text-[9px] font-mono p-4 font-black ${isWin ? 'text-green-500' : isLoss ? 'text-red-500' : 'text-neutral-500'}`}>
                                            {isWin ? '+' : ''}{pnl.toFixed(2)}%
                                        </TableCell>
                                        <TableCell className="text-[9px] font-mono p-4">
                                            <span className={`px-2 py-0.5 rounded-full text-[7px] font-bold uppercase tracking-widest ${trade.status === 'CLOSED' ? 'bg-neutral-900 text-neutral-500' : 'bg-green-950 text-green-500 animate-pulse'}`}>
                                                {trade.status}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-[9px] font-mono p-4 text-right text-neutral-600">
                                            {new Date(trade.entry_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
