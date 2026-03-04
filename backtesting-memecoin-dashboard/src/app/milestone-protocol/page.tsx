import { MilestoneStats } from "@/components/dashboard/milestone-stats";
import { MilestoneTargetTable } from "@/components/dashboard/milestone-target-table";
import { MilestoneHeader } from "@/components/dashboard/milestone-header";
import { MilestoneFleetControl } from "@/components/dashboard/milestone-fleet-control";
import { LiveExposureTable } from "@/components/dashboard/live-exposure-table";

export const dynamic = 'force-dynamic';

export default function MilestoneProtocolPage() {
    return (
        <main className="px-3 py-4 md:px-8 md:py-8 max-w-[1800px] mx-auto min-h-screen flex flex-col gap-4 md:gap-8">

            {/* 1. Header & Quick Actions */}
            <MilestoneHeader />

            {/* 2. Fleet Management */}
            <MilestoneFleetControl />

            {/* 3. Performance Stats */}
            <MilestoneStats />

            {/* 4. Real-time Risk & Exposure */}
            <div className="space-y-3 md:space-y-6">
                <div className="flex justify-between items-end border-b border-white/10 pb-2">
                    <h2 className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.3em] text-green-500/80">Live_Exposure</h2>
                    <span className="text-[7px] md:text-[8px] text-zinc-400 font-bold tracking-widest uppercase">Active_Positions</span>
                </div>
                <LiveExposureTable />
            </div>

            {/* 5. Live Operations Map — Monitored Coins Only */}
            <div className="space-y-3 md:space-y-6">
                <div className="flex justify-between items-end border-b border-white/10 pb-2">
                    <h2 className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.3em] text-blue-500/80">Monitored_Coins</h2>
                    <span className="text-[7px] md:text-[8px] text-zinc-400 font-bold tracking-widest uppercase">Live_Watch</span>
                </div>
                <MilestoneTargetTable />
            </div>

            <div className="mt-8 md:mt-20 pt-4 border-t border-white/5 flex flex-col md:flex-row justify-between gap-2 opacity-50 text-[7px] md:text-[8px] font-bold uppercase tracking-[0.4em]">
                <span>Encrypted_Data_Link_0xB8M</span>
                <span>Milestone_System_Internal_v1.0.0</span>
            </div>
        </main>
    );
}
