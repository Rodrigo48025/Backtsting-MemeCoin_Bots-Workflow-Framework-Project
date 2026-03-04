"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { getCopyTradeSignals, deleteTrackedWallet } from "@/app/actions/copy-trade-sniper-data";

interface Signal {
    raw: string;
    parsed: {
        mint?: string;
        traderPublicKey?: string;
        txType?: string;
        solAmount?: number;
    } | null;
    skip_reason: string;
    is_triggered: boolean;
    timestamp: string;
    traderPnL?: number;
}

export function CopyTradeSignalFeed() {
    const { mutate: globalMutate } = useSWRConfig();
    const { data: signals, isLoading, mutate } = useSWR('copy-trade-signals', getCopyTradeSignals, { refreshInterval: 2000, fallbackData: [] });
    const [deleting, setDeleting] = useState<string | null>(null);

    const handleDelete = async (address: string) => {
        if (!confirm(`Permanently remove ${address.slice(0, 8)}... from your fleet?`)) return;
        setDeleting(address);
        const res = await deleteTrackedWallet(address);
        if (res.success) {
            // Optimistically mutate or just let SWR poll? 
            // Better to mutate the tracked-wallets since that's what changed
            await globalMutate('tracked-wallets');
            await mutate();
        } else {
            alert("Deletion failed: " + res.error);
        }
        setDeleting(null);
    };

    if (isLoading && signals.length === 0) {
        return (
            <div className="bg-black/40 border border-neutral-900 p-6 rounded-none backdrop-blur-sm min-h-[600px] flex items-center justify-center">
                <span className="text-[10px] font-bold text-neutral-800 uppercase tracking-widest animate-pulse">Synchronizing_Heartbeat...</span>
            </div>
        );
    }

    return (
        <div className="bg-black/40 border border-neutral-900 flex flex-col rounded-none backdrop-blur-sm h-full min-h-[600px]">
            <div className="p-4 border-b border-neutral-900 flex justify-between items-center bg-black/20">
                <div>
                    <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-[0.3em]">FLEET_SIGNAL_DIAGNOSTICS</h3>
                    <p className="text-[8px] text-neutral-600 uppercase tracking-widest mt-1">Direct wire to PumpPortal firehose</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span className="text-[9px] font-bold text-neutral-500 uppercase">LIVE_FEED</span>
                </div>
            </div>

            {/* Top Traders Leaderboard */}
            {signals.length > 0 && (
                <div className="px-4 py-2 border-b border-neutral-900 bg-black/40">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">TOP_TRADERS</span>
                        <div className="h-[1px] flex-1 bg-neutral-900"></div>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {Array.from(new Set(signals.map(s => s.parsed?.traderPublicKey).filter(Boolean)))
                            .map(pubkey => ({
                                pubkey,
                                pnl: signals.find(s => s.parsed?.traderPublicKey === pubkey)?.traderPnL || 0
                            }))
                            .sort((a, b) => b.pnl - a.pnl)
                            .slice(0, 5)
                            .map((trader, i) => (
                                <div key={i} className="flex flex-col border border-neutral-900 bg-black/40 px-2 py-1 min-w-[80px]">
                                    <span className="text-[8px] font-bold text-neutral-400">{trader.pubkey?.slice(0, 4)}...{trader.pubkey?.slice(-4)}</span>
                                    <span className={`text-[9px] font-mono ${trader.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                        {trader.pnl >= 0 ? '+' : ''}{trader.pnl.toFixed(3)} SOL
                                    </span>
                                </div>
                            ))
                        }
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 font-mono space-y-1">
                {signals.length === 0 ? (
                    <div className="h-full flex items-center justify-center opacity-20">
                        <span className="text-[8px] uppercase tracking-[0.5em]">No_Detections_Yet</span>
                    </div>
                ) : (
                    signals.map((signal, i) => (
                        <div key={i} className={`p-2 border-l-2 text-[9px] ${signal.is_triggered ? 'border-green-500 bg-green-500/5' : 'border-neutral-800 bg-black/20'}`}>
                            <div className="flex justify-between items-start">
                                <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-2">
                                        <span className="text-neutral-600">[{new Date(signal.timestamp).toLocaleTimeString()}]</span>
                                        <span className={`font-bold ${signal.is_triggered ? 'text-green-400' : 'text-neutral-500'}`}>
                                            {signal.parsed?.traderPublicKey?.slice(0, 4)}...{signal.parsed?.traderPublicKey?.slice(-4)}
                                        </span>
                                        <span className={`text-[8px] px-1 border ${signal.is_triggered ? 'border-green-800 text-green-500' : 'border-neutral-800 text-neutral-600'}`}>
                                            {signal.parsed?.txType?.toUpperCase() || "UNKNOWN"}
                                        </span>
                                        {signal.traderPnL !== undefined && (
                                            <span className={`text-[8px] font-bold px-1 ${signal.traderPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                {signal.traderPnL >= 0 ? '+' : ''}{signal.traderPnL.toFixed(3)} SOL
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-neutral-400 truncate max-w-[200px]">
                                        MINT: {signal.parsed?.mint || "N/A (Non-Pump.fun)"}
                                    </div>
                                </div>
                                <div className="text-right flex flex-col items-end gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[8px] font-bold ${signal.is_triggered ? 'text-green-500' : 'text-neutral-700'}`}>
                                            {signal.is_triggered ? "⚡ TRIGGERED" : `SKIP: ${signal.skip_reason}`}
                                        </span>
                                        {signal.parsed?.traderPublicKey && (
                                            <button
                                                onClick={() => handleDelete(signal.parsed!.traderPublicKey!)}
                                                disabled={deleting === signal.parsed.traderPublicKey}
                                                className="w-5 h-5 flex items-center justify-center border border-red-900/30 text-red-900 hover:text-red-500 hover:border-red-500 transition-all text-[8px] font-black"
                                                title="Delete Trader"
                                            >
                                                {deleting === signal.parsed.traderPublicKey ? "..." : "✕"}
                                            </button>
                                        )}
                                    </div>
                                    {signal.parsed?.solAmount && (
                                        <span className="text-neutral-600 mt-1">{signal.parsed.solAmount.toFixed(2)} SOL</span>
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
