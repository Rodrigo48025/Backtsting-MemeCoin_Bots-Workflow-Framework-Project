"use client";

import { useEffect, useState } from "react";
import { getDashboardData } from "@/app/actions/get-data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Check, Clock } from "lucide-react";

export function IncubationTable() {
    const [targets, setTargets] = useState<any[]>([]);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    useEffect(() => {
        const fetch = async () => {
            const data = await getDashboardData();
            if (data) setTargets(data.incubatingTargets);
        };
        fetch();
        const interval = setInterval(fetch, 2000);
        return () => clearInterval(interval);
    }, []);

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

    const getTimeRemaining = (matureAt: string) => {
        const now = new Date().getTime();
        const target = new Date(matureAt).getTime();
        const diff = target - now;
        if (diff <= 0) return "00:00";
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    if (targets.length === 0) return (
        <div className="flex items-center justify-center h-[200px] border border-zinc-900 border-dashed font-mono">
            <span className="text-zinc-700 text-[10px] uppercase font-bold tracking-widest">Shadow_Pipeline_Empty</span>
        </div>
    );

    return (
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <Table className="font-mono min-w-[400px]">
                <TableHeader>
                    <TableRow className="border-zinc-900 hover:bg-transparent text-[8px] md:text-[9px]">
                        <TableHead className="uppercase font-bold text-zinc-600">Incubating_ID</TableHead>
                        <TableHead className="uppercase font-bold text-zinc-600 text-right">Liquidity</TableHead>
                        <TableHead className="uppercase font-bold text-zinc-600 text-right">Mature_In</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {targets.map((t) => (
                        <TableRow key={t.mint_address} className="border-zinc-900 hover:bg-zinc-950 group">
                            <TableCell className="py-2">
                                <div className="flex flex-col">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-zinc-300 italic">{t.name || "Unknown"}</span>
                                        <span className="text-[8px] text-zinc-500">[{t.mint_address.slice(0, 6)}...]</span>
                                        <button
                                            onClick={() => copyToClipboard(t.mint_address)}
                                            className="transition-opacity opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-white"
                                        >
                                            {copiedId === t.mint_address ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                        </button>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell className="text-right text-[10px] text-zinc-400">
                                {parseFloat(t.initial_liquidity || 0).toFixed(1)} SOL
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1.5 font-bold text-[9px] text-amber-500/80">
                                    <Clock className="h-3 w-3" />
                                    <span>{getTimeRemaining(t.mature_at)}</span>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
