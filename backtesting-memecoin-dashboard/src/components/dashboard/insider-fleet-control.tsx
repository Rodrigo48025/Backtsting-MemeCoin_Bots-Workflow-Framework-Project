"use client";

import { useState } from "react";
import { resetInsiderWallet } from "@/app/actions/insider-data";
import { Button } from "@/components/ui/button";

export function InsiderFleetControl() {
    const [isResetting, setIsResetting] = useState(false);

    const handleReset = async () => {
        if (!confirm("SYSTEM_WARNING: SCORCHED_EARTH. Wipe all insider trades and reset wallet?")) return;
        setIsResetting(true);
        const res = await resetInsiderWallet();
        if (res.success) {
            console.log("SYSTEM_REBOOT: Insider Protocol operational state reset successfully.");
            window.location.reload(); // Refresh to catch changes
        }
        setIsResetting(false);
    };

    return (
        <div className="flex flex-wrap items-center gap-3 p-4 bg-black border border-neutral-800 rounded-lg font-mono">
            <div className="flex items-center gap-2 pr-4 border-r border-neutral-800">
                <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Fleet_Command</span>
            </div>

            <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={isResetting}
                className="h-8 rounded-none border-neutral-800 bg-black hover:bg-neutral-900 text-neutral-400 group"
            >
                <span className="text-[9px] uppercase font-black tracking-widest">{isResetting ? "RESETTING..." : "Global_Reset"}</span>
            </Button>

            <Button
                variant="outline"
                size="sm"
                disabled
                className="h-8 rounded-none border-red-900/40 bg-red-950/20 text-red-500/50 cursor-not-allowed"
            >
                <span className="text-[9px] uppercase font-black tracking-widest opacity-80 text-red-500">Panic_Sell_All</span>
            </Button>
        </div>
    );
}
