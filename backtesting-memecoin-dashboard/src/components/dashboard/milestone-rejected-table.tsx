"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { getMilestoneDashboardData } from "@/app/actions/milestone-data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Check } from "lucide-react";

export function MilestoneRejectedTable() {
    const [rejections, setRejections] = useState<any[]>([]);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const { data } = useSWR('milestone-data', getMilestoneDashboardData, { refreshInterval: 2000 });

    useEffect(() => {
        if (data && data.rejections) setRejections(data.rejections);
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

    if (rejections.length === 0) return (
        <div className="flex items-center justify-center h-[200px] border border-zinc-900 font-mono">
            <span className="text-zinc-700 text-[10px] uppercase font-bold">Audit_Log_Clear</span>
        </div>
    );

    return (
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <Table className="font-mono min-w-[500px]">
                <TableHeader>
                    <TableRow className="border-zinc-900 hover:bg-transparent text-[8px] md:text-[9px]">
                        <TableHead className="uppercase font-bold text-zinc-600">ID / Copy</TableHead>
                        <TableHead className="uppercase font-bold text-zinc-600">Stopped_At</TableHead>
                        <TableHead className="uppercase font-bold text-zinc-600 text-right">Verdict</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rejections.map((r) => {
                        const parts = r.rejection_reason.split(']');
                        const filterTag = parts[0] ? `${parts[0]}]` : "[UNKNOWN]";
                        const details = parts[1] || r.rejection_reason;

                        return (
                            <TableRow key={r.mint_address} className="border-zinc-900 hover:bg-zinc-950 group">
                                <TableCell className="py-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-white tracking-tighter">
                                            {r.mint_address.slice(0, 8)}...
                                        </span>
                                        <button
                                            onClick={() => copyToClipboard(r.mint_address)}
                                            className="text-zinc-500 hover:text-white transition-colors"
                                        >
                                            {copiedId === r.mint_address ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                        </button>
                                    </div>
                                </TableCell>
                                <TableCell className="py-2">
                                    <div className="flex flex-col">
                                        <span className="text-[8px] font-bold text-zinc-500 uppercase">{filterTag}</span>
                                        <span className="text-[9px] text-zinc-400 truncate max-w-[150px]">{details}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <span className="text-[9px] font-bold text-white uppercase italic whitespace-nowrap">
                                        {r.current_status}
                                    </span>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
