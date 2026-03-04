"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { getEarlySniperDashboardData } from "@/app/actions/early-sniper-data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EarlyTriggerTable() {
    const { data: rawData } = useSWR('early-sniper-data', getEarlySniperDashboardData, { refreshInterval: 2000 });
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (rawData && !rawData.error) {
            setData(rawData);
        }
    }, [rawData]);

    const triggers = data?.triggers || [];

    return (
        <Card className="bg-black border-neutral-900 rounded-none shadow-none overflow-hidden h-full">
            <CardHeader className="px-4 py-3 border-b border-neutral-900">
                <CardTitle className="text-[10px] font-bold uppercase tracking-[0.4em] text-neutral-500">Live_New_Tokens (PumpPortal)</CardTitle>
            </CardHeader>
            <CardContent className="px-0 py-0">
                <Table>
                    <TableHeader className="bg-neutral-950 border-b border-neutral-900">
                        <TableRow className="hover:bg-transparent border-none">
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Asset</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Initial_MC</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Detected</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600 text-right">Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {triggers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-[9px] font-mono text-center py-20 text-neutral-800 tracking-widest uppercase italic">Waiting_for_firehose...</TableCell>
                            </TableRow>
                        ) : (
                            triggers.map((trigger: any, i: number) => (
                                <TableRow key={i} className="border-b border-neutral-900/50 hover:bg-neutral-900/50 transition-colors">
                                    <TableCell className="text-[9px] font-mono p-4 text-white">
                                        <a
                                            href={`https://gmgn.ai/sol/token/${trigger.mint}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:text-yellow-500 transition-colors"
                                        >
                                            {trigger.mint?.slice(0, 8)}.
                                        </a>
                                    </TableCell>
                                    <TableCell className="text-[9px] font-mono p-4 text-white font-black">
                                        {parseFloat(trigger.mc_sol || "0").toFixed(2)} SOL
                                    </TableCell>
                                    <TableCell className="text-[9px] font-mono p-4 text-neutral-400">
                                        —
                                    </TableCell>
                                    <TableCell className="text-[9px] font-mono p-4 text-right text-yellow-500 uppercase tracking-widest font-bold">
                                        TRIGGERED
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
