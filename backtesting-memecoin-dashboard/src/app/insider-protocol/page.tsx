import { InsiderStats } from "@/components/dashboard/insider-stats";
import { InsiderPnlChart } from "@/components/dashboard/insider-pnl-chart";
import { InsiderWatchlistTable } from "@/components/dashboard/insider-watchlist-table";
import { InsiderHeader } from "@/components/dashboard/insider-header";
import { InsiderFleetControl } from "@/components/dashboard/insider-fleet-control";
import { InsiderExposureTable } from "@/components/dashboard/insider-exposure-table";
import { InsiderLogs } from "@/components/dashboard/insider-logs";
import { InsiderBotBrain } from "@/components/dashboard/insider-bot-brain";
import { InsiderHistoryTable } from "@/components/dashboard/insider-history-table";

export const dynamic = 'force-dynamic';

export default function InsiderProtocolPage() {
    return (
        <main className="px-3 py-4 md:px-8 md:py-8 max-w-[1800px] mx-auto min-h-screen flex flex-col gap-4 md:gap-8">

            {/* 1. Header & Quick Actions */}
            <InsiderHeader />

            {/* 2. Fleet Management */}
            <InsiderFleetControl />

            {/* 3. Bot Brain — What Each Bot Is Thinking */}
            <div className="space-y-3 md:space-y-6">
                <div className="flex justify-between items-end border-b border-white/10 pb-2">
                    <h2 className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.3em] text-orange-500/80">Bot_Brain</h2>
                    <span className="text-[7px] md:text-[8px] text-zinc-400 font-bold tracking-widest uppercase">Neural_Status</span>
                </div>
                <InsiderBotBrain />
            </div>

            {/* 4. Performance Stats & Momentum */}
            <div className="w-full">
                <InsiderStats />
                <InsiderPnlChart />
            </div>

            {/* 5. Real-time Risk & Micro-Exposure */}
            <div className="space-y-3 md:space-y-6">
                <div className="flex justify-between items-end border-b border-white/10 pb-2">
                    <h2 className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-500/80">Active_Assisted_Trades</h2>
                    <span className="text-[7px] md:text-[8px] text-zinc-400 font-bold tracking-widest uppercase">Micro_Sniper_Queue</span>
                </div>
                <InsiderExposureTable />
            </div>

            {/* 6. CEX Watchlist — Scout Detections */}
            <div className="space-y-3 md:space-y-6">
                <div className="flex justify-between items-end border-b border-white/10 pb-2">
                    <h2 className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.3em] text-blue-500/80">Insider_Watchlist</h2>
                    <span className="text-[7px] md:text-[8px] text-zinc-400 font-bold tracking-widest uppercase">CEX_Funding_Provenance</span>
                </div>
                <InsiderWatchlistTable />
            </div>

            {/* 7. Live Docker Logs */}
            <div className="space-y-3 md:space-y-6">
                <div className="flex justify-between items-end border-b border-white/10 pb-2">
                    <h2 className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.3em] text-purple-500/80">System_Logs</h2>
                    <span className="text-[7px] md:text-[8px] text-zinc-400 font-bold tracking-widest uppercase">Docker_Stream</span>
                </div>
                <InsiderLogs />
            </div>

            {/* 8. Transaction History */}
            <div className="space-y-3 md:space-y-6">
                <div className="flex justify-between items-end border-b border-white/10 pb-2">
                    <h2 className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-500">Full_Audit_Trail</h2>
                    <span className="text-[7px] md:text-[8px] text-zinc-400 font-bold tracking-widest uppercase">Postgres_Records</span>
                </div>
                <InsiderHistoryTable />
            </div>

            <div className="mt-8 md:mt-20 pt-4 border-t border-white/5 flex flex-col md:flex-row justify-between gap-2 opacity-30 text-[7px] md:text-[8px] font-bold uppercase tracking-[0.4em]">
                <span>Provenance_Verification_Enabled</span>
                <span>Insider_System_Internal_v0.1.0_BETA</span>
            </div>
        </main>
    );
}
