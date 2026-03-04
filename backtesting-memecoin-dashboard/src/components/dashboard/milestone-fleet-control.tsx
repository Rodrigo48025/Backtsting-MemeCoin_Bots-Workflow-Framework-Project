"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { getMilestoneFleetStatus, getMilestoneContainerLogs, toggleMilestoneContainer } from "@/app/actions/docker";
import { Card } from "@/components/ui/card";
import { RotateCw } from "lucide-react";

type ContainerStatus = {
    id: string;
    name: string;
    state: string;
    status: string;
};

export function MilestoneFleetControl() {
    const [fleet, setFleet] = useState<ContainerStatus[]>([]);
    const [selectedLog, setSelectedLog] = useState<string>("milestone_scout");
    const [logs, setLogs] = useState<string>("SYSTEM: Awaiting log stream...");

    const { data: rawFleet } = useSWR('milestone-fleet-status', getMilestoneFleetStatus, { refreshInterval: 2000 });
    const { data: rawLogs } = useSWR(selectedLog ? `milestone-logs-${selectedLog}` : null, () => getMilestoneContainerLogs(selectedLog), { refreshInterval: 2000 });

    useEffect(() => {
        if (rawFleet) {
            setFleet(rawFleet.sort((a, b) => a.name.localeCompare(b.name)));
        }
    }, [rawFleet]);

    useEffect(() => {
        if (rawLogs !== undefined) {
            setLogs(rawLogs || "No logs captured for this service.");
        }
    }, [rawLogs]);

    return (
        <Card className="bg-black border-white/10 rounded-none overflow-hidden font-mono flex flex-col h-[180px] md:h-[280px]">
            {/* INTEGRATED HEADER */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/10 gap-2">
                <div className="flex items-center gap-3 md:gap-5 overflow-x-auto no-scrollbar pb-0.5 sm:pb-0">
                    <span className="text-[8px] md:text-[10px] font-bold text-white/70 uppercase tracking-widest whitespace-nowrap">Mon:</span>
                    {fleet.map((bot) => (
                        <button
                            key={bot.id}
                            onClick={() => setSelectedLog(bot.name)}
                            className={`flex items-center gap-1.5 transition-all whitespace-nowrap ${selectedLog === bot.name ? "opacity-100" : "opacity-60 hover:opacity-100"
                                }`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${bot.state === 'running' ? 'bg-white shadow-[0_0_5px_#fff]' : 'bg-white/20'}`} />
                            <span className={`text-[9px] md:text-[10px] font-bold uppercase tracking-tighter ${selectedLog === bot.name ? 'underline underline-offset-4' : ''}`}>
                                {bot.name.replace('milestone_', '')}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 border-t border-white/5 pt-1 sm:border-t-0 sm:pt-0">
                    <button
                        onClick={() => toggleMilestoneContainer(selectedLog, 'restart')}
                        className="flex items-center gap-1.5 text-[8px] font-bold text-white/60 hover:text-white transition-colors"
                    >
                        <RotateCw className="h-2.5 w-2.5" /> RST
                    </button>
                </div>
            </div>

            {/* COMPACT LOG AREA */}
            <div className="flex-1 overflow-auto px-3 py-2 bg-black custom-scrollbar">
                <pre className="text-[9px] md:text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono">
                    {logs}
                </pre>
            </div>

            {/* TERMINAL FOOTER */}
            <div className="px-3 py-0.5 bg-white/5 border-t border-white/10 flex justify-between">
                <span className="text-[7px] font-bold text-white/40 uppercase tracking-widest">
                    {selectedLog.replace('milestone_', '')}
                </span>
                <span className="text-[7px] font-bold text-white/40 uppercase tracking-widest">
                    50L
                </span>
            </div>
        </Card>
    );
}
