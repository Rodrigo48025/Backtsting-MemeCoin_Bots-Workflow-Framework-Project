"use client";

import { resetVolumeWallet } from "@/app/actions/volume-data";

export function VolumeHeader() {
    const handleReset = async () => {
        if (confirm("RESET VOLUME_TRADES AND SOL BALANCE TO 10.0?")) {
            const res = await resetVolumeWallet();
            if (res.success) window.location.reload();
        }
    };

    return (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-neutral-900 pb-6 mb-2">
            <div className="space-y-1">
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-red-600" />
                    <span className="text-[8px] font-bold text-neutral-500 uppercase tracking-[0.4em]">SYSTEM_STATUS: ACTIVE</span>
                </div>
                <h1 className="text-2xl md:text-4xl font-black text-white uppercase tracking-tighter">
                    VOLUME_ACCELERATION <span className="text-[10px] md:text-xs font-normal text-neutral-600 font-mono tracking-widest ml-2 border border-neutral-800 px-2 py-0.5">V1.0_MOMENTUM</span>
                </h1>
                <p className="text-[9px] md:text-xs text-neutral-600 font-mono uppercase tracking-[0.2em]">High Frequency Momentum Execution // Isolated Infrastructure</p>
            </div>

            <button
                className="px-6 h-9 bg-black border border-neutral-800 text-neutral-500 hover:text-white hover:border-white text-[10px] font-bold uppercase tracking-widest transition-all"
                onClick={handleReset}
            >
                RESET_SIMULATION
            </button>
        </div>
    );
}
