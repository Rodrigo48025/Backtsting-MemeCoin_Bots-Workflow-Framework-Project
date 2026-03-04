"use client";

import { VolumeMetricsCard } from "@/components/dashboard/volume-metrics-card";
import { VolumeHeader } from "@/components/dashboard/volume-header";
import { VolumeExposureTable } from "@/components/dashboard/volume-exposure-table";
import { VolumeTriggerTable } from "@/components/dashboard/volume-trigger-table";
import { VolumeBotVerticalStack } from "@/components/dashboard/volume-bot-vertical-stack";

export default function VolumeProtocolPage() {
    return (
        <main className="px-3 py-4 md:px-12 md:py-10 max-w-[1800px] mx-auto min-h-screen flex flex-col gap-8 bg-black">

            {/* 1. System Header */}
            <VolumeHeader />

            {/* 2. Primary Status Row: Metrics (Large) + Bot Controllers (Stack) */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-stretch">
                <div className="lg:col-span-3">
                    <VolumeMetricsCard />
                </div>
                <div className="lg:col-span-1">
                    <VolumeBotVerticalStack />
                </div>
            </div>

            {/* 3. Secondary Data Row: Live Detections + Active Exposure */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="h-full">
                    <VolumeExposureTable />
                </div>
                <div className="h-full">
                    <VolumeTriggerTable />
                </div>
            </div>

            {/* Footer / System Info */}
            <div className="mt-12 pt-6 border-t border-neutral-900 flex justify-between items-center opacity-40">
                <div className="flex items-center gap-4 text-[7px] font-bold uppercase tracking-[0.5em] text-neutral-500">
                    <span>MOMENTUM_VERIFICATION: STABLE</span>
                    <span>PROTOCOL_V1.0</span>
                </div>
                <span className="text-[7px] font-mono text-neutral-700 font-bold uppercase tracking-widest">Authorized_Access_Only</span>
            </div>
        </main>
    );
}
