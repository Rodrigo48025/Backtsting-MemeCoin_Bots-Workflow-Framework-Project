"use client";

import { useState } from "react";
import useSWR from "swr";
import { getEarlySniperBotStatus, getEarlySniperLogs } from "@/app/actions/early-sniper-data";
import { Card, CardContent } from "@/components/ui/card";

export function EarlyBotVerticalStack() {
    const [expandedBot, setExpandedBot] = useState<string | null>(null);

    const fetcher = async () => {
        const [statusRes, logsRes] = await Promise.all([
            getEarlySniperBotStatus(),
            getEarlySniperLogs(15)
        ]);
        if (statusRes && !Array.isArray(statusRes) && (statusRes as any).error) return null;
        if (logsRes && !Array.isArray(logsRes) && (logsRes as any).error) return null;
        return { bots: statusRes || [], logs: logsRes || [] };
    };

    const { data, error } = useSWR('early-bot-stack', fetcher, { refreshInterval: 2000 });
    const bots = data?.bots || [];
    const logs = data?.logs || [];

    if (bots.length === 0) return null;

    return (
        <div className="flex flex-col gap-3 h-full">
            {bots.map((bot, i) => {
                const isExpanded = expandedBot === bot.name;
                const botLogs = logs.find(l => l.service === bot.name)?.lines || [];

                return (
                    <Card key={i} className="bg-black border-neutral-900 rounded-none shadow-none flex flex-col overflow-hidden group">
                        <CardContent className="p-4 flex flex-col gap-4">
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-1.5 h-1.5 ${bot.status === 'ONLINE' ? 'bg-yellow-500' : bot.status === 'STALE' ? 'bg-neutral-600' : 'bg-red-600'}`} />
                                        <h3 className="text-[10px] font-black text-white uppercase tracking-tighter">{bot.name}</h3>
                                    </div>
                                    <p className="text-[7px] font-bold text-neutral-600 uppercase tracking-widest">{bot.codename}</p>
                                </div>
                                <button
                                    onClick={() => setExpandedBot(isExpanded ? null : bot.name)}
                                    className="text-[8px] font-bold text-neutral-500 hover:text-white uppercase tracking-widest border border-neutral-800 px-2 py-1 transition-all"
                                >
                                    {isExpanded ? "HIDE_LOGS" : "VIEW_LOGS"}
                                </button>
                            </div>

                            <div className="space-y-1">
                                <span className="text-[7px] font-bold text-neutral-700 uppercase tracking-widest block">FOCUS:</span>
                                <p className="text-[9px] text-neutral-400 font-bold leading-tight italic">
                                    "{bot.thinking}"
                                </p>
                            </div>

                            {isExpanded && (
                                <div className="mt-2 pt-3 border-t border-neutral-900 space-y-1 max-h-[150px] overflow-y-auto custom-scrollbar">
                                    {botLogs.map((line: string, idx: number) => (
                                        <div key={idx} className="text-[8px] font-mono leading-tight flex gap-2">
                                            <span className="text-neutral-800 shrink-0">[{idx}]</span>
                                            <span className={`break-all ${line.includes('Error') || line.includes('❌') ? 'text-red-500' : 'text-neutral-500'}`}>
                                                {line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*/, "")}
                                            </span>
                                        </div>
                                    ))}
                                    {botLogs.length === 0 && (
                                        <div className="text-[8px] font-mono text-neutral-800 italic uppercase">Streaming_Logs...</div>
                                    )}
                                </div>
                            )}

                            <div className="flex justify-between text-[7px] font-bold text-neutral-600 uppercase border-t border-neutral-900 pt-2">
                                <span>Signals: {bot.signalCount}</span>
                                <span className={bot.errorCount > 0 ? "text-red-600" : ""}>Err: {bot.errorCount}</span>
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
