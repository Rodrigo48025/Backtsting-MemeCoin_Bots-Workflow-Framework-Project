"use client";

import { CopyTradeMetricsCard } from "@/components/dashboard/copy-trade-metrics-card";
import { CopyTradeHeader } from "@/components/dashboard/copy-trade-header";
import { CopyTradeExposureTable } from "@/components/dashboard/copy-trade-exposure-table";
import { CopyTradeBotVerticalStack } from "@/components/dashboard/copy-trade-bot-vertical-stack";
import { CopyTradeSignalFeed } from "@/components/dashboard/copy-trade-signal-feed";
import { CopyTradeHistoryTable } from "@/components/dashboard/copy-trade-history-table";

export default function CopyTradeSniperProtocolPage() {
    return (
        <main className="px-3 py-4 md:px-12 md:py-10 max-w-[1800px] mx-auto min-h-screen flex flex-col gap-12 bg-black">

            {/* 1. System Header */}
            <CopyTradeHeader />

            {/* Top Row: Performance Metrics & Bot Vertical Stack */}
            <div className="grid grid-cols-12 gap-6 items-stretch">
                <div className="col-span-12 lg:col-span-9">
                    <CopyTradeMetricsCard />
                </div>
                <div className="col-span-12 lg:col-span-3">
                    <CopyTradeBotVerticalStack />
                </div>
            </div>

            {/* Bottom Row: History (3) + Exposure (3) + Triggers/Signals (3) + Tracking (3) */}
            <div className="grid grid-cols-12 gap-6 items-stretch">
                <div className="col-span-12 md:col-span-6 lg:col-span-3">
                    <CopyTradeHistoryTable />
                </div>
                <div className="col-span-12 md:col-span-6 lg:col-span-3">
                    <CopyTradeExposureTable />
                </div>
                <div className="col-span-12 md:col-span-6 lg:col-span-6">
                    <CopyTradeSignalFeed />
                </div>
            </div>

            {/* Footer / System Info */}
            <div className="mt-12 pt-6 border-t border-neutral-900 flex justify-between items-center opacity-40">
                <div className="flex items-center gap-4 text-[7px] font-bold uppercase tracking-[0.5em] text-neutral-500">
                    <span>SNIPER_VERIFICATION: STABLE</span>
                    <span>PROTOCOL_V1.0_COPY_TRADE</span>
                </div>
                <span className="text-[7px] font-mono text-neutral-700 font-bold uppercase tracking-widest">Authorized_Access_Only</span>
            </div>
        </main>
    );
}
