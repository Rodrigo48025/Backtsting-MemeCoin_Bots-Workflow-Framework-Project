"use client";

import { useEffect, useState } from "react";
import { getTrackedWallets } from "@/app/actions/copy-trade-sniper-data";

interface TrackedWallet {
    address: string;
    rank: number;
    score: number;
    winRate: string;
    avgSize: string;
    tp: string;
}

export function TrackedWalletsCard() {
    const [wallets, setWallets] = useState<TrackedWallet[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function load() {
            const data = await getTrackedWallets();
            setWallets(data);
            setIsLoading(false);
        }
        load();
        const interval = setInterval(load, 30000);
        return () => clearInterval(interval);
    }, []);

    if (isLoading) {
        return (
            <div className="bg-black/40 border border-neutral-900 p-6 rounded-none backdrop-blur-sm animate-pulse h-[300px] flex items-center justify_center">
                <span className="text-[10px] font-bold text-neutral-800 uppercase tracking-widest">Loading_Elite_Fleet...</span>
            </div>
        );
    }

    return (
        <div className="bg-black/40 border border-neutral-900 p-6 rounded-none backdrop-blur-sm">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-[0.3em]">ELITE_TRACKING_FLEET</h3>
                    <p className="text-[9px] text-neutral-700 uppercase tracking-widest mt-1">Real-time subscription to high-alpha entities</p>
                </div>
                <div className="px-2 py-0.5 border border-neutral-800 text-[8px] font-bold text-neutral-600 uppercase tracking-widest bg-black">
                    {wallets.length} ACTIVE_CHANNELS
                </div>
            </div>

            <div className="space-y-4">
                {wallets.map((wallet) => (
                    <div key={wallet.address} className="group relative border border-neutral-900/50 bg-black/20 p-3 hover:border-neutral-800 transition-colors">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="text-[9px] font-black text-neutral-800">#{wallet.rank}</div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-mono text-neutral-400 group-hover:text-white transition-colors capitalize">
                                        {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                                    </span>
                                    <div className="flex gap-4 mt-1">
                                        <span className="text-[8px] font-bold text-neutral-600">WIN: {wallet.winRate}</span>
                                        <span className="text-[8px] font-bold text-neutral-600">SIZE: {wallet.avgSize}</span>
                                        <span className="text-[8px] font-bold text-neutral-600">TP: {wallet.tp}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] font-black text-neutral-400 group-hover:text-green-500 transition-colors">
                                    SCORE: {wallet.score.toFixed(1)}
                                </div>
                                <div className="text-[7px] font-bold text-neutral-700 uppercase tracking-tighter mt-0.5">SUBSCRIBED_AUTO_EXEC</div>
                            </div>
                        </div>
                        {/* Status bar */}
                        <div className="absolute bottom-0 left-0 h-[1px] bg-green-900/40 w-full"></div>
                    </div>
                ))}
            </div>
        </div>
    );
}
