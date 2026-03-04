"use client";

import { resetCopyTradeWallet, clearCopyTradeTrades } from "@/app/actions/copy-trade-sniper-data";
import { CopyTradeWalletManager } from "@/components/dashboard/copy-trade-wallet-manager";

export function CopyTradeHeader() {
    const handleResetWallet = async () => {
        if (confirm("RESET SOL BALANCE TO 10.0?")) {
            const res = await resetCopyTradeWallet();
            if (res.success) window.location.reload();
        }
    };

    const handleClearTrades = async () => {
        if (confirm("CLEAR ALL TRADE HISTORY AND REFRESH DASHBOARD?")) {
            const res = await clearCopyTradeTrades();
            if (res.success) window.location.reload();
        }
    };

    return (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-neutral-900 pb-6 mb-2">
            <div className="space-y-1">
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-yellow-500" />
                    <span className="text-[8px] font-bold text-neutral-500 uppercase tracking-[0.4em]">SYSTEM_STATUS: ACTIVE</span>
                </div>
                <h1 className="text-2xl md:text-4xl font-black text-white uppercase tracking-tighter">
                    COPY_TRADE_PROTOCOL <span className="text-[10px] md:text-xs font-normal text-neutral-600 font-mono tracking-widest ml-2 border border-neutral-800 px-2 py-0.5">V1.0_SNIPER</span>
                </h1>
                <p className="text-[9px] md:text-xs text-neutral-600 font-mono uppercase tracking-[0.2em]">Ultra-Low Latency PumpPortal Copy-Trader // Isolated Infrastructure</p>
            </div>

            <div className="flex items-center gap-2">
                <CopyTradeWalletManager />
                <button
                    className="px-4 h-9 bg-black border border-neutral-800 text-neutral-500 hover:text-white hover:border-white text-[10px] font-bold uppercase tracking-widest transition-all"
                    onClick={handleResetWallet}
                >
                    RESET_WALLET
                </button>
                <button
                    className="px-4 h-9 bg-black border border-neutral-800 text-neutral-500 hover:text-white hover:border-white text-[10px] font-bold uppercase tracking-widest transition-all"
                    onClick={handleClearTrades}
                >
                    CLEAR_TRADES
                </button>
            </div>
        </div>
    );
}
