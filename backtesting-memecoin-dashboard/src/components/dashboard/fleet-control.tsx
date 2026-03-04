"use client";

import { useEffect, useState } from "react";
import { getFleetStatus, getContainerLogs, ContainerStatus, toggleContainer } from "@/app/actions/docker";
import { Card } from "@/components/ui/card";
import { RotateCw } from "lucide-react";

export function FleetControl() {
  const [fleet, setFleet] = useState<ContainerStatus[]>([]);
  const [selectedLog, setSelectedLog] = useState<string>("ghost_scout");
  const [logs, setLogs] = useState<string>("SYSTEM: Awaiting log stream...");

  useEffect(() => {
    const fetchStatus = async () => {
      const data = await getFleetStatus();
      setFleet(data.sort((a, b) => a.name.localeCompare(b.name)));
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchLogs = async () => {
      const logData = await getContainerLogs(selectedLog);
      setLogs(logData || "No logs captured for this service.");
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [selectedLog]);

  return (
    <Card className="bg-black border-white/10 rounded-none overflow-hidden font-mono flex flex-col h-[320px]">
      {/* INTEGRATED HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10 gap-3">
        <div className="flex items-center gap-4 md:gap-6 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
          <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest whitespace-nowrap">Monitors:</span>
          {fleet.map((bot) => (
            <button
              key={bot.id}
              onClick={() => setSelectedLog(bot.name)}
              className={`flex items-center gap-2 transition-all whitespace-nowrap ${selectedLog === bot.name ? "opacity-100" : "opacity-60 hover:opacity-100"
                }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${bot.state === 'running' ? 'bg-white shadow-[0_0_5px_#fff]' : 'bg-white/20'}`} />
              <span className={`text-[10px] font-bold uppercase tracking-tighter ${selectedLog === bot.name ? 'underline underline-offset-4' : ''}`}>
                {bot.name.replace('ghost_', '')}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-4 border-t border-white/5 pt-2 sm:border-t-0 sm:pt-0">
          <button
            onClick={() => toggleContainer(selectedLog, 'restart')}
            className="flex items-center gap-2 text-[9px] font-bold text-white/60 hover:text-white transition-colors"
          >
            <RotateCw className="h-3 w-3" /> <span className="hidden xs:inline">RESTART_STREAM</span><span className="xs:hidden">RESTART</span>
          </button>
          <div className="h-3 w-[1px] bg-white/10 hidden sm:block" />
          <span className="text-[9px] font-bold text-white/50 tracking-widest uppercase">
            LINK_AUTH
          </span>
        </div>
      </div>

      {/* COMPACT LOG AREA */}
      <div className="flex-1 overflow-auto p-5 bg-black custom-scrollbar">
        <pre className="text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono">
          {logs}
        </pre>
      </div>

      {/* TERMINAL FOOTER */}
      <div className="px-4 py-1 bg-white/5 border-t border-white/10 flex justify-between">
        <span className="text-[8px] font-bold text-white/40 uppercase tracking-widest">
          Active_Output: {selectedLog}
        </span>
        <span className="text-[8px] font-bold text-white/40 uppercase tracking-widest">
          Buffer: 50_Lines
        </span>
      </div>
    </Card>
  );
}