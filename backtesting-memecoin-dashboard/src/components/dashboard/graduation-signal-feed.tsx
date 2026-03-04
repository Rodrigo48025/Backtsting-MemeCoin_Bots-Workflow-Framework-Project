"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { getGraduationSignals } from "@/app/actions/graduation-sniper-data";

interface Signal {
    mint: string;
    tx_type: string;
    market_cap?: number;
    skip_reason: string;
    is_triggered: boolean;
    timestamp: string;
}

export function GraduationSignalFeed() {
    const { data: signals, isLoading } = useSWR('graduation-signals', getGraduationSignals, { refreshInterval: 2000, fallbackData: [] });

    if (isLoading && signals.length === 0) {
        return (
            <div className="bg-black/40 border border-neutral-900 p-6 rounded-none backdrop-blur-sm h-[400px] flex items-center justify-center">
                <span className="text-[10px] font-bold text-neutral-800 uppercase tracking-widest animate-pulse">Syncing_68_SOL_Thresholds...</span>
            </div>
        );
    }

    return (
        <div className="bg-black/40 border border-neutral-900 flex flex-col rounded-none backdrop-blur-sm h-[400px]">
            <div className="p-4 border-b border-neutral-900 flex justify-between items-center bg-black/20">
                <div>
                    <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-[0.3em]">GRADUATION_THRESHOLD_FEED</h3>
                    <p className="text-[8px] text-neutral-600 uppercase tracking-widest mt-1">Monitoring bonding curve saturation levels</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </span>
                    <span className="text-[9px] font-bold text-neutral-500 uppercase">LIVE_MONITOR</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 font-mono space-y-1">
                {signals.length === 0 ? (
                    <div className="h-full flex items-center justify-center opacity-20">
                        <span className="text-[8px] uppercase tracking-[0.5em]">No_Threshold_Crossings</span>
                    </div>
                ) : (
                    signals.map((signal, i) => (
                        <div key={i} className={`p-2 border-l-2 text-[9px] ${signal.is_triggered ? 'border-blue-500 bg-blue-500/5' : 'border-neutral-800 bg-black/20'}`}>
                            <div className="flex justify-between items-start">
                                <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-2">
                                        <span className="text-neutral-600">[{new Date(signal.timestamp).toLocaleTimeString()}]</span>
                                        <span className={`font-bold ${signal.is_triggered ? 'text-blue-400' : 'text-neutral-500'}`}>
                                            {signal.mint.slice(0, 4)}...{signal.mint.slice(-4)}
                                        </span>
                                        <span className={`text-[8px] px-1 border ${signal.is_triggered ? 'border-blue-800 text-blue-500' : 'border-neutral-800 text-neutral-600'}`}>
                                            {signal.tx_type?.toUpperCase() || "UNKNOWN"}
                                        </span>
                                    </div>
                                    <div className="text-neutral-400 truncate max-w-[200px]">
                                        THRESHOLD: {signal.market_cap ? `${signal.market_cap.toFixed(2)} SOL / 68.00` : "PENDING"}
                                    </div>
                                </div>
                                <div className="text-right flex flex-col items-end">
                                    <span className={`text-[8px] font-bold ${signal.is_triggered ? 'text-blue-500' : 'text-neutral-700'}`}>
                                        {signal.is_triggered ? "🚀 GRADUATED" : signal.skip_reason}
                                    </span>
                                    {signal.market_cap && (
                                        <div className="w-24 h-1 bg-neutral-900 mt-2 relative overflow-hidden">
                                            <div
                                                className={`h-full ${signal.is_triggered ? 'bg-blue-500' : 'bg-neutral-700'}`}
                                                style={{ width: `${Math.min((signal.market_cap / 68) * 100, 100)}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
