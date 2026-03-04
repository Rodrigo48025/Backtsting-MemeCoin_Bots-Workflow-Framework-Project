"use client";

import { useState, useEffect } from "react";
import { toggleMilestoneFleet, getMilestoneFleetStatus, killMilestoneProtocol } from "@/app/actions/docker";
import { getMilestoneDashboardData, clearMilestoneRejections, clearMilestoneTargets, wipeMilestoneRedis, factoryResetMilestone, panicSellMilestone } from "@/app/actions/milestone-data";
import { Loader2, Trash2, AlertCircle, CheckCircle2, Power, RotateCw } from "lucide-react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function MilestoneHeader() {
    const [isFleetRunning, setIsFleetRunning] = useState(true);
    const [systemStatus, setSystemStatus] = useState<string>("INITIALIZING...");
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

    useEffect(() => {
        const checkStatus = async () => {
            const status = await getMilestoneFleetStatus();
            const anyRunning = status.some(s => s.state === 'running');
            setIsFleetRunning(anyRunning);

            if (anyRunning) {
                const data = await getMilestoneDashboardData();
                if (data && 'systemStatus' in data) {
                    setSystemStatus(data.systemStatus as string);
                } else {
                    setSystemStatus("FULLY_OPERATIONAL");
                }
            } else {
                setSystemStatus("SYSTEM_HALTED");
            }
        };
        checkStatus();
        const interval = setInterval(checkStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (feedback) {
            const timer = setTimeout(() => setFeedback(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [feedback]);

    const handleAction = async (type: string, actionFn: () => Promise<{ success: boolean; error?: string }>, successMsg: string) => {
        setActionLoading(type);
        try {
            const result = await actionFn();
            if (result.success) {
                setFeedback({ type: "success", message: successMsg });
            } else {
                setFeedback({ type: "error", message: result.error || "ACTION_FAILED" });
            }
        } catch (e) {
            setFeedback({ type: "error", message: "SYSTEM_ERROR" });
        } finally {
            setActionLoading(null);
        }
    };

    const handleToggleFleet = async () => {
        setLoading(true);
        const action = isFleetRunning ? "stop" : "start";

        if (action === "stop") {
            setFeedback({ type: "success", message: "INITIATING_PANIC_SELL_SEQUENCE..." });
            await panicSellMilestone();
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        const result = await toggleMilestoneFleet(action);

        if (result.success) {
            setIsFleetRunning(!isFleetRunning);
            setFeedback({ type: "success", message: `MILESTONE_${action.toUpperCase()}ED` });
        } else {
            setFeedback({ type: "error", message: "FLEET_CONTROL_FAILED" });
        }
        setLoading(false);
    };

    return (
        <div className="w-full bg-black font-mono">
            {feedback && (
                <div className="fixed top-2 right-2 md:top-4 md:right-4 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
                    <Alert variant={feedback.type === "error" ? "destructive" : "default"} className="bg-black border-zinc-800 text-white min-w-[250px]">
                        {feedback.type === "success" ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <AlertCircle className="h-3 w-3 text-red-500" />}
                        <AlertTitle className="text-[9px] font-bold tracking-widest uppercase">System_Notification</AlertTitle>
                        <AlertDescription className="text-[10px] font-bold text-zinc-400">
                            {feedback.message}
                        </AlertDescription>
                    </Alert>
                </div>
            )}

            {/* TOP ROW: System Info */}
            <div className="flex flex-wrap gap-4 md:gap-8 py-3 md:py-4">
                <div className="flex flex-col gap-0.5">
                    <span className="text-[8px] md:text-[10px] font-bold tracking-[0.2em] text-zinc-400 uppercase">System_ID</span>
                    <span className="text-[11px] md:text-sm font-bold tracking-tighter text-white">MLSTN_PRTCL_X8</span>
                </div>

                <div className="flex flex-col gap-0.5 border-l border-white/10 pl-4 md:pl-8">
                    <span className="text-[8px] md:text-[10px] font-bold tracking-[0.2em] text-zinc-400 uppercase">Algorithm</span>
                    <span className="text-[10px] md:text-sm font-bold tracking-tighter text-white uppercase">10SOL_MCAP</span>
                </div>

                <div className="flex flex-col gap-0.5 border-l border-white/10 pl-4 md:pl-8">
                    <span className="text-[8px] md:text-[10px] font-bold tracking-[0.2em] text-zinc-400 uppercase">Status</span>
                    <span className={`text-[10px] md:text-sm font-bold tracking-tighter ${systemStatus.includes("IDLE") ? 'text-red-500 font-black animate-pulse' : isFleetRunning ? 'text-white' : 'text-zinc-500'}`}>
                        {systemStatus}
                    </span>
                </div>
            </div>

            {/* BOTTOM ROW: Action Buttons — compact grid on mobile */}
            <div className="flex flex-wrap items-center gap-1.5 md:gap-2 pb-3 md:pb-4">
                {/* Fleet Toggle */}
                <button
                    onClick={handleToggleFleet}
                    disabled={loading}
                    className={`text-[8px] md:text-[10px] font-bold px-3 md:px-5 py-1.5 border transition-all flex items-center gap-1.5 ${isFleetRunning
                        ? "bg-white text-black border-white hover:bg-black hover:text-white"
                        : "bg-black text-white border-white hover:bg-white hover:text-black"
                        }`}
                >
                    {loading && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                    {isFleetRunning ? "STOP" : "START"}
                </button>

                {/* Data Purge Buttons */}
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <button disabled={actionLoading === "rejected"} className="flex items-center gap-1 text-[8px] md:text-[10px] font-bold px-2 md:px-3 py-1.5 border border-red-900/40 text-red-500 hover:bg-red-500 hover:text-white transition-all disabled:opacity-50">
                            {actionLoading === "rejected" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5" />}
                            <span className="hidden sm:inline">CLR_</span>REJ
                        </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-black border-zinc-800 text-white font-mono max-w-[90vw] md:max-w-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-sm tracking-widest uppercase italic">CONFIRM_DATA_PURGE</AlertDialogTitle>
                            <AlertDialogDescription className="text-xs text-zinc-400 uppercase leading-relaxed">
                                This action will wipe all history from <span className="text-red-500">MILESTONE REJECTED_TARGETS</span>. Proceed?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel className="bg-transparent border-zinc-800 text-[10px] font-bold hover:bg-zinc-900 hover:text-white rounded-none">CANCEL</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleAction("rejected", clearMilestoneRejections, "MILESTONE_REJECTIONS_CLEARED")} className="bg-red-600 text-white text-[10px] font-bold hover:bg-red-700 rounded-none border-none">CONFIRM_PURGE</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <button disabled={actionLoading === "monitored"} className="flex items-center gap-1 text-[8px] md:text-[10px] font-bold px-2 md:px-3 py-1.5 border border-amber-900/40 text-amber-500 hover:bg-amber-500 hover:text-white transition-all disabled:opacity-50">
                            {actionLoading === "monitored" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5" />}
                            <span className="hidden sm:inline">CLR_</span>MON
                        </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-black border-zinc-800 text-white font-mono max-w-[90vw] md:max-w-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-sm tracking-widest uppercase italic text-amber-500">QUEUE_CLEAR_AUTH</AlertDialogTitle>
                            <AlertDialogDescription className="text-xs text-zinc-400 uppercase leading-relaxed">
                                This will clear all tokens in the <span className="text-amber-500">MONITORING_QUEUE</span>. The Sniper will stop tracking these targets.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel className="bg-transparent border-zinc-800 text-[10px] font-bold hover:bg-zinc-900 hover:text-white rounded-none">ABORT</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleAction("monitored", clearMilestoneTargets, "MILESTONE_QUEUE_CLEARED")} className="bg-amber-600 text-white text-[10px] font-bold hover:bg-amber-700 rounded-none border-none">CONTINUE_WIPE</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <button disabled={actionLoading === "factory_reset"} className="flex items-center gap-1 text-[8px] md:text-[10px] font-bold px-2 md:px-3 py-1.5 border border-purple-900/40 text-purple-500 hover:bg-purple-500 hover:text-white transition-all disabled:opacity-50">
                            {actionLoading === "factory_reset" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCw className="h-2.5 w-2.5" />}
                            <span className="hidden sm:inline">FACTORY_</span>RST
                        </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-black border-zinc-800 text-white font-mono max-w-[90vw] md:max-w-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-sm tracking-widest uppercase italic text-purple-500">HARD_FACTORY_RESET</AlertDialogTitle>
                            <AlertDialogDescription className="text-xs text-zinc-400 uppercase leading-relaxed">
                                CRITICAL: This will <span className="text-red-500 font-bold underline">WIPE EVERYTHING</span>.
                                Balance reset to <span className="text-white">10.00 SOL</span>.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel className="bg-transparent border-zinc-800 text-[10px] font-bold hover:bg-zinc-900 hover:text-white rounded-none">ABORT</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleAction("factory_reset", factoryResetMilestone, "FACTORY_RESET_COMPLETE")} className="bg-purple-600 text-white text-[10px] font-bold hover:bg-purple-700 rounded-none border-none">CONFIRM</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <button className="text-[8px] md:text-[10px] font-bold px-2 md:px-3 py-1.5 border border-white/20 hover:border-white hover:bg-white hover:text-black transition-all text-white">
                            <span className="hidden sm:inline">WIPE_</span>REDIS
                        </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-black border-zinc-800 text-white font-mono max-w-[90vw] md:max-w-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-sm tracking-widest uppercase italic text-white underline decoration-red-500">HARD_SYSTEM_WIPE</AlertDialogTitle>
                            <AlertDialogDescription className="text-xs text-zinc-400 uppercase leading-relaxed">
                                Purge all pending signals from <span className="text-amber-500">MILESTONE Redis</span>. Queue will be emptied.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel className="bg-transparent border-zinc-800 text-[10px] font-bold hover:bg-zinc-900 hover:text-white rounded-none">DENY</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleAction("redis", wipeMilestoneRedis, "MILESTONE_CACHE_CLEARED")} className="bg-white text-black text-[10px] font-bold hover:bg-zinc-200 rounded-none border-none">ALLOW_WIPE</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <button disabled={actionLoading === "killswitch"} className="text-[8px] md:text-[10px] font-bold px-2 md:px-3 py-1.5 border border-red-500/40 text-red-500 hover:bg-red-600 hover:text-white hover:border-red-600 transition-all flex items-center gap-1 disabled:opacity-50">
                            {actionLoading === "killswitch" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Power className="h-2.5 w-2.5" />}
                            KILL
                        </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-black border-zinc-800 text-white font-mono max-w-[90vw] md:max-w-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-sm tracking-widest uppercase italic text-red-500">⚠️ KILL_SWITCH</AlertDialogTitle>
                            <AlertDialogDescription className="text-xs text-zinc-400 uppercase leading-relaxed">
                                CRITICAL: <span className="text-red-500">docker compose down</span>. All containers DESTROYED.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel className="bg-transparent border-zinc-800 text-[10px] font-bold hover:bg-zinc-900 hover:text-white rounded-none">ABORT</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleAction("killswitch", killMilestoneProtocol, "MILESTONE_PROTOCOL_TERMINATED")} className="bg-red-600 text-white text-[10px] font-bold hover:bg-red-700 rounded-none border-none">CONFIRM</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
            <div className="h-[1px] w-full bg-white/10" />
        </div>
    );
}
