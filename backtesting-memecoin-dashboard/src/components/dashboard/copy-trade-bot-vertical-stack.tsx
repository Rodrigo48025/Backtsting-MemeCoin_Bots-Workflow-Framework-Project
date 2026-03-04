"use client";

import useSWR from "swr";
import { getCopyTradeSniperBotStatus, getCopyTradeSniperLogs } from "@/app/actions/copy-trade-sniper-data";
import { Card, CardContent } from "@/components/ui/card";

export function CopyTradeBotVerticalStack() {
    const fetcher = async () => {
        const [statusRes, logsRes] = await Promise.all([
            getCopyTradeSniperBotStatus(),
            getCopyTradeSniperLogs(5)
        ]);
        if (statusRes && !Array.isArray(statusRes) && (statusRes as any).error) return null;
        if (logsRes && !Array.isArray(logsRes) && (logsRes as any).error) return null;
        return { bots: statusRes || [], logs: logsRes || [] };
    };

    const { data, error } = useSWR('copy-trade-bot-stack', fetcher, { refreshInterval: 2000 });
    const bots = data?.bots || [];
    const logs = data?.logs || [];

    if (bots.length === 0) return null;

    return (
        <div className="flex flex-col gap-6 h-full">
            {bots.map((bot, i) => {
                const botLogs = logs.find(l => l.service === bot.name)?.lines || [];

                return (
                    <Card key={i} className="bg-black border-neutral-900 rounded-none shadow-none flex flex-col flex-1 overflow-hidden">
                        <CardContent className="p-4 flex flex-col h-full gap-4">

                            {/* Header Section */}
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-1.5 h-1.5 ${bot.status === 'ONLINE' ? 'bg-yellow-500' : bot.status === 'STALE' ? 'bg-neutral-600' : 'bg-red-600'}`} />
                                        <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em]">{bot.name}</h3>
                                    </div>
                                    <p className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">{bot.codename}</p>
                                </div>
                                <div className="text-[8px] font-bold text-neutral-500 uppercase tracking-widest border border-neutral-800 px-2 py-1 bg-neutral-950/50">
                                    {bot.status}
                                </div>
                            </div>

                            {/* Focus Section */}
                            <div className="space-y-1 mt-2">
                                <span className="text-[7px] font-bold text-neutral-700 uppercase tracking-widest block">CURRENT_FOCUS</span>
                                <p className="text-[10px] text-emerald-500/80 font-mono leading-tight bg-emerald-950/10 p-2 border border-emerald-900/20">
                                    $ {bot.thinking}
                                </p>
                            </div>

                            {/* Mini Logs Window - Flexible Area */}
                            <div className="flex-1 flex flex-col min-h-[100px] mt-2">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[7px] font-bold text-neutral-800 uppercase tracking-widest">LIVE_TERMINAL_FEED</span>
                                    <span className="text-[7px] font-mono text-neutral-700">TAIL: 5 LINES</span>
                                </div>
                                <div className="bg-[#050505] border border-neutral-900 flex-1 p-2 overflow-hidden flex flex-col justify-end">
                                    {botLogs.map((line: string, idx: number) => {
                                        const cleanLine = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?(?:\s+)?/, "").trim();
                                        const isError = cleanLine.includes('Error') || cleanLine.includes('❌') || cleanLine.includes('SYSTEM_ERROR') || cleanLine.includes('HALT');
                                        const isAction = cleanLine.includes('✅') || cleanLine.includes('🚨') || cleanLine.includes('🎯');

                                        return (
                                            <div key={idx} className="text-[8px] font-mono leading-tight flex gap-2">
                                                <span className={`break-all truncate ${isError ? 'text-red-500' : isAction ? 'text-yellow-500' : 'text-neutral-600'}`}>
                                                    {">"} {cleanLine}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    {botLogs.length === 0 && (
                                        <div className="text-[8px] font-mono text-neutral-800 italic uppercase">Establishing_Stream...</div>
                                    )}
                                </div>
                            </div>

                            {/* Footer Metrics */}
                            <div className="flex justify-between text-[8px] font-bold text-neutral-600 uppercase border-t border-neutral-900 pt-3 mt-auto">
                                <span className="flex items-center gap-1.5 hover:text-neutral-400 transition-colors">
                                    <span className="w-1 h-1 bg-yellow-900 block rounded-full"></span>
                                    SIGNALS: {bot.signalCount}
                                </span>
                                <span className={`flex items-center gap-1.5 ${bot.errorCount > 0 ? "text-red-500 font-black" : ""}`}>
                                    <span className={`w-1 h-1 block rounded-full ${bot.errorCount > 0 ? "bg-red-500 animate-pulse" : "bg-neutral-800"}`}></span>
                                    ERR_COUNT: {bot.errorCount}
                                </span>
                            </div>

                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
