"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { getMilestoneDashboardData } from "@/app/actions/milestone-data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Check } from "lucide-react";

export function MilestoneTargetTable() {
    const [targets, setTargets] = useState<any[]>([]);
    const [isOffline, setIsOffline] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const { data } = useSWR('milestone-data', getMilestoneDashboardData, { refreshInterval: 2000 });

    useEffect(() => {
        if (data && data.activeTargets) {
            setTargets(data.activeTargets);
            setIsOffline(!!data.isOffline);
        } else if (data && data.error) {
            console.error("Dashboard API Error:", data.error);
            setTargets([]);
            setIsOffline(!!data.isOffline);
        }
    }, [data]);

    const copyToClipboard = (text: string) => {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text);
        } else {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-999999px";
            textArea.style.top = "-999999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
            } catch (err) {
                console.error('Fallback copy failed', err);
            }
            document.body.removeChild(textArea);
        }
        setCopiedId(text);
        setTimeout(() => setCopiedId(null), 2000);
    };

    if (isOffline) return (
        <div className="flex items-center justify-center h-[200px] border border-red-900/30 bg-red-950/10 font-mono">
            <span className="text-red-500 text-[10px] uppercase font-bold animate-pulse">Status: SERVICE_OFFLINE // Check_Docker_Compose</span>
        </div>
    );

    if (targets.length === 0) return (
        <div className="flex items-center justify-center h-[200px] border border-zinc-800 font-mono">
            <span className="text-zinc-500 text-[10px] uppercase font-bold">Queue_Empty // Waiting_For_Milestone</span>
        </div>
    );

    return (
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <Table className="font-mono min-w-[400px]">
                <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent text-[8px] md:text-[9px]">
                        <TableHead className="uppercase font-bold text-zinc-400">Identifier</TableHead>
                        <TableHead className="uppercase font-bold text-zinc-400 text-right">Liquidity</TableHead>
                        <TableHead className="uppercase font-bold text-zinc-400 text-right">Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {targets.map((t) => (
                        <TableRow key={t.mint_address} className="border-zinc-800 hover:bg-zinc-900 group">
                            <TableCell className="py-2">
                                <div className="flex flex-col">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-white">{t.mint_address.slice(0, 12)}...</span>
                                        <button
                                            onClick={() => copyToClipboard(t.mint_address)}
                                            className="transition-opacity text-zinc-500 hover:text-white"
                                        >
                                            {copiedId === t.mint_address ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                        </button>
                                    </div>
                                    <a href={`https://gmgn.ai/sol/token/${t.mint_address}`} target="_blank" rel="noreferrer" className="text-[8px] text-zinc-400 hover:text-white underline mt-0.5">
                                        VIEW_CHART
                                    </a>
                                </div>
                            </TableCell>
                            <TableCell className="text-right text-[10px] text-zinc-300">
                                {parseFloat(t.initial_liquidity || 0).toFixed(1)} SOL
                            </TableCell>
                            <TableCell className="text-right">
                                <span className="text-[9px] font-bold text-white border border-zinc-700 px-1 py-0.5 whitespace-nowrap">
                                    {t.status}
                                </span>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
