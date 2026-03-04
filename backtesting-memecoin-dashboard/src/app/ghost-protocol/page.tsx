import { LiveStats } from "@/components/dashboard/live-stats";
import { TargetTable } from "@/components/dashboard/target-table";
import { RejectedTable } from "@/components/dashboard/shadow-board";
import { IncubationTable } from "@/components/dashboard/incubation-table";
import { BotHeader } from "@/components/dashboard/bot-header";
import { FleetControl } from "@/components/dashboard/fleet-control";

export default function GhostProtocolPage() {
  return (
    <main className="p-4 md:p-16 max-w-[1800px] mx-auto min-h-screen flex flex-col gap-6 md:gap-12">

      {/* 1. Header & Quick Actions */}
      <BotHeader />

      {/* 2. Fleet Management */}
      <FleetControl />

      {/* 3. Performance Stats */}
      <LiveStats />

      {/* 4. Live Operations Map */}
      <div className="grid gap-10 md:gap-20 lg:grid-cols-3">
        {/* SECTION: INCUBATING */}
        <div className="space-y-8">
          <div className="flex justify-between items-end border-b border-white/10 pb-4">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.4em] text-amber-500/80">Incubating_Coins</h2>
            <span className="text-[8px] text-zinc-400 font-bold tracking-widest uppercase">Shadow_Pipeline</span>
          </div>
          <IncubationTable />
        </div>

        {/* SECTION: MONITORED */}
        <div className="space-y-8">
          <div className="flex justify-between items-end border-b border-white/10 pb-4">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.4em] text-blue-500/80">Monitored_Coins</h2>
            <span className="text-[8px] text-zinc-400 font-bold tracking-widest uppercase">Live_Watch</span>
          </div>
          <TargetTable />
        </div>

        {/* SECTION: REJECTED */}
        <div className="space-y-8">
          <div className="flex justify-between items-end border-b border-white/10 pb-4">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.4em] text-red-500/80">Rejected_Coins</h2>
            <span className="text-[8px] text-zinc-400 font-bold tracking-widest uppercase">Risk_Filter</span>
          </div>
          <RejectedTable />
        </div>
      </div>

      <div className="mt-20 md:mt-40 pt-10 border-t border-white/5 flex flex-col md:flex-row justify-between gap-4 opacity-50 text-[8px] font-bold uppercase tracking-[0.6em]">
        <span>Encrypted_Data_Link_0x992</span>
        <span>Ghost_System_Internal_v1.0.7</span>
      </div>
    </main>
  );
}