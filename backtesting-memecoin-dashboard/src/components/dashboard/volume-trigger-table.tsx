"use client";

import useSWR from "swr";
import { getVolumeDashboardData } from "@/app/actions/volume-data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function VolumeTriggerTable() {
    const { data } = useSWR('volume-data', getVolumeDashboardData, { refreshInterval: 2000 });

    const triggers = data?.triggers || [];

    return (
        <Card className="bg-black border-neutral-900 rounded-none shadow-none overflow-hidden h-full">
            <CardHeader className="px-4 py-3 border-b border-neutral-900">
                <CardTitle className="text-[10px] font-bold uppercase tracking-[0.4em] text-neutral-500">Live_Scout_Detections</CardTitle>
            </CardHeader>
            <CardContent className="px-0 py-0">
                <Table>
                    <TableHeader className="bg-neutral-950 border-b border-neutral-900">
                        <TableRow className="hover:bg-transparent border-none">
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Asset</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Ratio</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600">Vol_SOL</TableHead>
                            <TableHead className="text-[8px] font-bold uppercase tracking-widest p-4 text-neutral-600 text-right">MC_SOL</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {triggers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-[9px] font-mono text-center py-20 text-neutral-800 tracking-widest uppercase italic">Waiting_for_burst...</TableCell>
                            </TableRow>
                        ) : (
                            triggers.map((trigger: any, i: number) => (
                                <TableRow key={i} className="border-b border-neutral-900/50 hover:bg-neutral-900/50 transition-colors">
                                    <TableCell className="text-[9px] font-mono p-4 text-white">
                                        <a
                                            href={`https://gmgn.ai/sol/token/${trigger.mint}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:text-red-500 transition-colors"
                                        >
                                            {trigger.mint.slice(0, 8)}.
                                        </a>
                                    </TableCell>
                                    <TableCell className="text-[9px] font-mono p-4 text-white font-black">
                                        {trigger.ratio.toFixed(2)}x
                                    </TableCell>
                                    <TableCell className="text-[9px] font-mono p-4 text-neutral-400">
                                        {trigger.current_vol.toFixed(2)} SOL
                                    </TableCell>
                                    <TableCell className="text-[9px] font-mono p-4 text-right text-neutral-600">
                                        {trigger.mc_sol.toFixed(1)}
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
