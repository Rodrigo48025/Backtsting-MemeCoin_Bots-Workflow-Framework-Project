"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw } from "lucide-react";
import { resetInsiderWallet } from "@/app/actions/insider-data";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function InsiderHeader() {
    const [isResetting, setIsResetting] = useState(false);

    const handleReset = async () => {
        setIsResetting(true);
        await resetInsiderWallet();
        setIsResetting(false);
    };

    return (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-neutral-800 pb-6 font-mono">
            <div className="flex items-center gap-4">
                <div className="h-12 w-12 bg-black border border-neutral-800 flex items-center justify-center">
                    <span className="text-white font-black text-xl">I</span>
                </div>
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-xl md:text-2xl font-black tracking-widest text-white uppercase">INSIDER_PROTOCOL</h1>
                        <Badge variant="outline" className="text-[8px] border-neutral-800 text-neutral-400 bg-black rounded-none uppercase font-bold tracking-widest px-1.5 py-0">LIVE_OPS</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-neutral-500 uppercase font-bold tracking-[.2em]">Burner_Detection_v2.0.0</span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <button disabled={isResetting} className="flex items-center gap-2 text-[9px] md:text-[10px] font-bold px-3 py-2 bg-black border border-neutral-800 text-red-500 hover:bg-neutral-900 transition-all disabled:opacity-50 tracking-widest uppercase">
                            {isResetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                            Global_Reset
                        </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-black border border-neutral-800 rounded-none max-w-md">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-sm tracking-widest uppercase text-red-500 font-bold font-mono">SYSTEM_WARNING: SCORCHED_EARTH</AlertDialogTitle>
                            <AlertDialogDescription className="text-xs text-neutral-400 font-mono mt-2">
                                This will completely wipe all historical insider trades from the database, clear the Redis watchlist, and reset the virtual portfolio back to <span className="text-white font-bold">2.0 SOL</span>.
                                <br /><br />
                                This action cannot be undone. Are you sure you want to proceed?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="mt-4">
                            <AlertDialogCancel className="bg-transparent text-neutral-400 text-[10px] font-bold hover:bg-neutral-900 hover:text-white rounded-none border-none tracking-widest uppercase">CANCEL</AlertDialogCancel>
                            <AlertDialogAction onClick={handleReset} className="bg-red-500 text-white text-[10px] font-bold hover:bg-red-600 rounded-none border-none tracking-widest uppercase">CONFIRM_WIPE</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <div className="px-4 py-2 bg-black border border-neutral-800 hidden md:block">
                    <span className="text-[7px] text-neutral-500 uppercase font-bold block mb-0.5 tracking-widest">Active_Filters</span>
                    <span className="text-[10px] text-white font-bold tracking-tight flex items-center gap-1.5 uppercase">
                        Fresh_Wallet_&lt;5TX
                    </span>
                </div>
            </div>
        </div>
    );
}
