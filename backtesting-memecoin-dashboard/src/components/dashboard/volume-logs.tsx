"use client";

import { useState, useRef, useEffect } from "react";
import { getVolumeLogs } from "@/app/actions/volume-data";
import { Card, CardContent } from "@/components/ui/card";
import { Terminal } from "lucide-react";

import useSWR from "swr";

export function VolumeLogs() {
    const [activeService, setActiveService] = useState("SCOUT");
    const scrollRef = useRef<HTMLDivElement>(null);

    const { data: logsData } = useSWR('volume-logs', getVolumeLogs, { refreshInterval: 2000 });
    const logs = logsData || [];

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs, activeService]);

    const currentLogs = logs.find(l => l.service === activeService)?.lines || ["Waiting for Docker stream..."];

    return (
        <Card className="bg-black border-neutral-800 rounded-none shadow-none mt-4 md:mt-8 overflow-hidden font-mono flex flex-col h-[300px] md:h-[500px]">
            <div className="px-4 py-2 border-b border-neutral-900 bg-neutral-950 flex flex-wrap gap-2 md:gap-4 items-center">
                {logs.map((s, i) => (
                    <button
                        key={i}
                        onClick={() => setActiveService(s.service)}
                        className={`text-[8px] md:text-[9px] font-black uppercase tracking-widest px-2 py-1 border transition-all ${activeService === s.service ? 'border-neutral-500 text-white bg-neutral-900' : 'border-transparent text-neutral-600 hover:text-neutral-400'}`}
                    >
                        {s.service}
                    </button>
                ))}
                <div className="ml-auto flex items-center gap-2 opacity-50 hidden sm:flex">
                    <Terminal className="w-3 h-3 text-emerald-500" />
                    <span className="text-[7px] text-neutral-300 font-bold uppercase tracking-[0.3em]">Live_Stdout_Stream</span>
                </div>
            </div>

            <CardContent className="p-0 flex-1 overflow-hidden relative">
                <div
                    ref={scrollRef}
                    className="absolute inset-0 overflow-y-auto p-4 space-y-1 selection:bg-emerald-500 selection:text-black custom-scrollbar"
                >
                    {currentLogs.map((line: string, i: number) => (
                        <div key={i} className="text-[9px] md:text-[10px] leading-relaxed break-all flex gap-3 group">
                            <span className="text-neutral-700 shrink-0 select-none">[{i.toString().padStart(2, '0')}]</span>
                            <span className={`text-neutral-400 group-hover:text-neutral-200 transition-colors ${line.includes('❌') || line.includes('Error') ? 'text-red-500/80 bg-red-500/5 px-1' : ''}`}>
                                {line}
                            </span>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
