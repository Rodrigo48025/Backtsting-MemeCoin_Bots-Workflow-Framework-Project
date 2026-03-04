"use client";

import { GraduationMetricsCard } from "@/components/dashboard/graduation-metrics-card";
import { GraduationHeader } from "@/components/dashboard/graduation-header";
import { GraduationExposureTable } from "@/components/dashboard/graduation-exposure-table";
import { GraduationTriggerTable } from "@/components/dashboard/graduation-trigger-table";
import { GraduationBotVerticalStack } from "@/components/dashboard/graduation-bot-vertical-stack";
import { GraduationSignalFeed } from "@/components/dashboard/graduation-signal-feed";

export default function GraduationSniperProtocolPage() {
    return (
        <main className="px-3 py-4 md:px-12 md:py-10 max-w-[1800px] mx-auto min-h-screen flex flex-col gap-8 bg-black">

            {/* 1. System Header */}
            <GraduationHeader />

            {/* 2. Primary Status Row: Metrics (Large) + Bot Controllers (Stack) */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-stretch">
                <div className="lg:col-span-3">
                    <GraduationMetricsCard />
                </div>
                <div className="lg:col-span-1">
                    <GraduationBotVerticalStack />
                </div>
            </div>

            {/* 3. Secondary Data Row: Live Detections + Active Exposure */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
                    <GraduationSignalFeed />
                </div>
                <div className="h-full lg:col-span-1">
                    <GraduationExposureTable />
                </div>
                <div className="h-full lg:col-span-1">
                    <GraduationTriggerTable />
                </div>
            </div>

            {/* Footer / System Info */}
            <div className="mt-12 pt-6 border-t border-neutral-900 flex justify-between items-center opacity-40">
                <div className="flex items-center gap-4 text-[7px] font-bold uppercase tracking-[0.5em] text-neutral-500">
                    <span>SNIPER_VERIFICATION: STABLE</span>
                    <span>PROTOCOL_V1.0_GRADUATION</span>
                </div>
                <span className="text-[7px] font-mono text-neutral-700 font-bold uppercase tracking-widest">Authorized_Access_Only</span>
            </div>
        </main>
    );
}
