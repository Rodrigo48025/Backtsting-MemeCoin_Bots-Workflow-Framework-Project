"use client";

import { useState } from "react";
import useSWR from "swr";
import { getTrackedWallets, addTrackedWallet, retireTrackedWallet, deleteTrackedWallet } from "@/app/actions/copy-trade-sniper-data";

interface TrackedWallet {
    id: number;
    wallet_address: string;
    label: string | null;
    status: string;
    added_at: string;
    retired_at: string | null;
    notes: string | null;
}

export function CopyTradeWalletManager() {
    const [isOpen, setIsOpen] = useState(false);
    const [newAddress, setNewAddress] = useState("");
    const [newLabel, setNewLabel] = useState("");
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "RETIRED">("ALL");

    const { data: swrWallets, mutate } = useSWR('tracked-wallets', getTrackedWallets, { refreshInterval: 30000 });
    const wallets = (swrWallets as TrackedWallet[]) || [];

    const handleAdd = async () => {
        if (!newAddress.trim()) return;
        setLoading(true);
        const res = await addTrackedWallet(newAddress, newLabel || undefined);
        if (res.success) {
            setNewAddress("");
            setNewLabel("");
            await mutate();
        }
        setLoading(false);
    };

    const handleRetire = async (address: string) => {
        setLoading(true);
        await retireTrackedWallet(address);
        await mutate();
        setLoading(false);
    };

    const handleReactivate = async (address: string) => {
        setLoading(true);
        await addTrackedWallet(address);
        await mutate();
        setLoading(false);
    };

    const handleDelete = async (address: string) => {
        if (!confirm("Permanently delete this wallet from the database?")) return;
        setLoading(true);
        await deleteTrackedWallet(address);
        await mutate();
        setLoading(false);
    };

    const filtered = wallets.filter(w => filter === "ALL" || w.status === filter);
    const activeCount = wallets.filter(w => w.status === "ACTIVE").length;
    const retiredCount = wallets.filter(w => w.status === "RETIRED").length;

    return (
        <>
            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="px-6 h-9 bg-black border border-emerald-900/50 text-emerald-500 hover:text-emerald-300 hover:border-emerald-500 text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2"
            >
                <span className="text-sm">⊕</span>
                MANAGE_WALLETS
                <span className="text-neutral-600 ml-1">({activeCount})</span>
            </button>

            {/* Modal Overlay */}
            {isOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-black border border-neutral-800 w-full max-w-2xl max-h-[80vh] flex flex-col">

                        {/* Modal Header */}
                        <div className="flex justify-between items-center p-4 border-b border-neutral-900">
                            <div>
                                <h2 className="text-sm font-black text-white uppercase tracking-wider">
                                    TRACKED_WALLETS
                                </h2>
                                <p className="text-[9px] text-neutral-600 font-mono uppercase tracking-widest mt-1">
                                    {activeCount} ACTIVE // {retiredCount} RETIRED
                                </p>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="w-8 h-8 flex items-center justify-center text-neutral-600 hover:text-white border border-neutral-800 hover:border-white transition-all text-xs"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Add Wallet Form */}
                        <div className="p-4 border-b border-neutral-900 space-y-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="WALLET_ADDRESS (Base58)"
                                    value={newAddress}
                                    onChange={e => setNewAddress(e.target.value)}
                                    className="flex-1 h-9 px-3 bg-neutral-950 border border-neutral-800 text-white text-[11px] font-mono placeholder:text-neutral-700 focus:border-emerald-800 focus:outline-none transition-all"
                                />
                                <input
                                    type="text"
                                    placeholder="LABEL (optional)"
                                    value={newLabel}
                                    onChange={e => setNewLabel(e.target.value)}
                                    className="w-40 h-9 px-3 bg-neutral-950 border border-neutral-800 text-white text-[11px] font-mono placeholder:text-neutral-700 focus:border-emerald-800 focus:outline-none transition-all"
                                />
                                <button
                                    onClick={handleAdd}
                                    disabled={loading || !newAddress.trim()}
                                    className="h-9 px-5 bg-emerald-950/50 border border-emerald-800/50 text-emerald-400 hover:bg-emerald-900/30 hover:border-emerald-500 text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    {loading ? "..." : "ADD"}
                                </button>
                            </div>
                        </div>

                        {/* Filter Tabs */}
                        <div className="flex gap-0 border-b border-neutral-900">
                            {(["ALL", "ACTIVE", "RETIRED"] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    className={`flex-1 h-8 text-[9px] font-bold uppercase tracking-widest transition-all ${filter === f
                                        ? "text-white border-b border-white"
                                        : "text-neutral-600 hover:text-neutral-400"
                                        }`}
                                >
                                    {f} ({f === "ALL" ? wallets.length : f === "ACTIVE" ? activeCount : retiredCount})
                                </button>
                            ))}
                        </div>

                        {/* Wallet List */}
                        <div className="flex-1 overflow-y-auto">
                            {filtered.length === 0 ? (
                                <div className="flex items-center justify-center h-32 text-neutral-700 text-[10px] font-mono uppercase tracking-widest">
                                    NO_WALLETS_FOUND
                                </div>
                            ) : (
                                filtered.map(w => (
                                    <div
                                        key={w.id}
                                        className={`flex items-center justify-between px-4 py-3 border-b border-neutral-900/50 group hover:bg-neutral-950 transition-all ${w.status === "RETIRED" ? "opacity-40" : ""
                                            }`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1.5 h-1.5 ${w.status === "ACTIVE" ? "bg-emerald-500" : "bg-neutral-700"}`} />
                                                <span className="text-[10px] font-mono text-white truncate">
                                                    {w.wallet_address}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1 ml-3.5">
                                                {w.label && (
                                                    <span className="text-[9px] text-neutral-500 font-mono">{w.label}</span>
                                                )}
                                                <span className="text-[8px] text-neutral-700 font-mono uppercase">
                                                    {new Date(w.added_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {w.status === "ACTIVE" ? (
                                                <button
                                                    onClick={() => handleRetire(w.wallet_address)}
                                                    disabled={loading}
                                                    className="h-7 px-3 border border-yellow-900/50 text-yellow-600 hover:text-yellow-400 hover:border-yellow-500 text-[8px] font-bold uppercase tracking-widest transition-all"
                                                >
                                                    RETIRE
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleReactivate(w.wallet_address)}
                                                    disabled={loading}
                                                    className="h-7 px-3 border border-emerald-900/50 text-emerald-700 hover:text-emerald-400 hover:border-emerald-500 text-[8px] font-bold uppercase tracking-widest transition-all"
                                                >
                                                    REACTIVATE
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDelete(w.wallet_address)}
                                                disabled={loading}
                                                className="h-7 px-3 border border-red-900/30 text-red-900 hover:text-red-500 hover:border-red-500 text-[8px] font-bold uppercase tracking-widest transition-all"
                                            >
                                                DEL
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-3 border-t border-neutral-900 flex justify-between items-center">
                            <span className="text-[8px] text-neutral-700 font-mono uppercase tracking-widest">
                                WALLET_REGISTRY // DB_BACKED
                            </span>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="h-7 px-4 border border-neutral-800 text-neutral-500 hover:text-white hover:border-white text-[9px] font-bold uppercase tracking-widest transition-all"
                            >
                                CLOSE
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
