"use client";

import { useState, useEffect } from "react";
import { toggleFleet, getFleetStatus, wipeRedisCache, killGhostProtocol } from "@/app/actions/docker";
import { clearRejectedTargets, clearMonitoredTargets } from "@/app/actions/db-ops";
import { clearIncubationQueue } from "@/app/actions/get-data";
import { Loader2, Trash2, AlertCircle, CheckCircle2, Power } from "lucide-react";
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

export function BotHeader() {
  const [isFleetRunning, setIsFleetRunning] = useState(true);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Sync the button state with reality on load
  useEffect(() => {
    const checkStatus = async () => {
      const status = await getFleetStatus();
      const anyRunning = status.some(s => s.state === 'running');
      setIsFleetRunning(anyRunning);
    };
    checkStatus();
  }, []);

  // Clear feedback after 5 seconds
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
    const result = await toggleFleet(action);

    if (result.success) {
      setIsFleetRunning(!isFleetRunning);
      setFeedback({ type: "success", message: `SYSTEM_${action.toUpperCase()}ED` });
    } else {
      setFeedback({ type: "error", message: "FLEET_CONTROL_FAILED" });
    }
    setLoading(false);
  };

  return (
    <div className="w-full bg-black mb-12 font-mono">
      {feedback && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <Alert variant={feedback.type === "error" ? "destructive" : "default"} className="bg-black border-zinc-800 text-white min-w-[300px]">
            {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-red-500" />}
            <AlertTitle className="text-[10px] font-bold tracking-widest uppercase">System_Notification</AlertTitle>
            <AlertDescription className="text-xs font-bold text-zinc-400">
              {feedback.message}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center py-6 gap-6">
        <div className="flex flex-wrap gap-6 md:gap-10">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold tracking-[0.3em] text-zinc-400 uppercase">System_ID</span>
            <span className="text-sm font-bold tracking-tighter text-white">GHOST_PRTCL_X1</span>
          </div>

          <div className="flex flex-col gap-1 border-l border-white/10 pl-6 md:pl-10">
            <span className="text-[10px] font-bold tracking-[0.3em] text-zinc-400 uppercase">Algorithm</span>
            <span className="text-sm font-bold tracking-tighter text-white uppercase text-xs md:text-sm">Dead_Cat_CVD</span>
          </div>

          <div className="flex flex-col gap-1 border-l border-white/10 pl-6 md:pl-10">
            <span className="text-[10px] font-bold tracking-[0.3em] text-zinc-400 uppercase">Status</span>
            <span className={`text-sm font-bold tracking-tighter ${isFleetRunning ? 'text-white' : 'text-zinc-500'}`}>
              {isFleetRunning ? "FULLY_OPERATIONAL" : "SYSTEM_HALTED"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-2">
            {/* Clear Rejections Dialog */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  disabled={actionLoading === "rejected"}
                  className="group flex items-center gap-2 text-[10px] font-bold px-3 py-1.5 border border-red-900/40 text-red-500 hover:bg-red-500 hover:text-white transition-all disabled:opacity-50"
                >
                  {actionLoading === "rejected" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  CLEAR_REJECTIONS
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-black border-zinc-800 text-white font-mono">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm tracking-widest uppercase italic">CONFIRM_DATA_PURGE</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-zinc-400 uppercase leading-relaxed">
                    This action will wipe all history from <span className="text-red-500">REJECTED_TARGETS</span>.
                    Logged data will be unrecoverable. Proceed?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-transparent border-zinc-800 text-[10px] font-bold hover:bg-zinc-900 hover:text-white rounded-none">CANCEL</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleAction("rejected", clearRejectedTargets, "REJECTION_LOGS_CLEARED")}
                    className="bg-red-600 text-white text-[10px] font-bold hover:bg-red-700 rounded-none border-none"
                  >
                    CONFIRM_PURGE
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Clear Monitored Dialog */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  disabled={actionLoading === "monitored"}
                  className="group flex items-center gap-2 text-[10px] font-bold px-3 py-1.5 border border-amber-900/40 text-amber-500 hover:bg-amber-500 hover:text-white transition-all disabled:opacity-50"
                >
                  {actionLoading === "monitored" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  CLEAR_MONITORED
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-black border-zinc-800 text-white font-mono">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm tracking-widest uppercase italic text-amber-500">QUEUE_CLEAR_AUTH</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-zinc-400 uppercase leading-relaxed">
                    This action will clear all tokens currently in the <span className="text-amber-500">MONITORING_QUEUE</span>.
                    The Sniper will stop tracking these targets.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-transparent border-zinc-800 text-[10px] font-bold hover:bg-zinc-900 hover:text-white rounded-none">ABORT</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleAction("monitored", clearMonitoredTargets, "MONITORING_QUEUE_CLEARED")}
                    className="bg-amber-600 text-white text-[10px] font-bold hover:bg-amber-700 rounded-none border-none"
                  >
                    CONTINUE_WIPE
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* NEW: Clear Incubation Dialog */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  disabled={actionLoading === "incubation"}
                  className="group flex items-center gap-2 text-[10px] font-bold px-3 py-1.5 border border-amber-500/20 text-amber-500/60 hover:bg-amber-500/20 hover:text-white transition-all disabled:opacity-50"
                >
                  {actionLoading === "incubation" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  CLEAR_INCUBATION
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-black border-zinc-800 text-white font-mono">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm tracking-widest uppercase italic text-amber-500">INCUBATION_PURGE</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-zinc-400 uppercase leading-relaxed">
                    CRITICAL: This will clear all coins currently in the <span className="text-amber-500">SHADOW_PIPELINE</span>.
                    Filtration will be aborted for these targets.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-transparent border-zinc-800 text-[10px] font-bold hover:bg-zinc-900 hover:text-white rounded-none">CANCEL</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleAction("incubation", clearIncubationQueue, "INCUBATION_PIPELINE_CLEARED")}
                    className="bg-amber-600 text-white text-[10px] font-bold hover:bg-amber-700 rounded-none border-none"
                  >
                    CONFIRM_CLEAR
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleToggleFleet}
              disabled={loading}
              className={`text-[10px] font-bold px-6 py-2 border transition-all flex items-center gap-3 ${isFleetRunning
                ? "bg-white text-black border-white hover:bg-black hover:text-white"
                : "bg-black text-white border-white hover:bg-white hover:text-black"
                }`}
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              {isFleetRunning ? "STOP_ALL_SERVICES" : "RESUME_EXECUTOR"}
            </button>

            {/* Wipe Redis Dialog */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="text-[10px] font-bold px-4 py-1.5 border border-white/20 hover:border-white hover:bg-white hover:text-black transition-all text-white"
                >
                  WIPE_REDIS_CACHE
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-black border-zinc-800 text-white font-mono">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm tracking-widest uppercase italic text-white underline decoration-red-500">HARD_SYSTEM_WIPE</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-zinc-400 uppercase leading-relaxed">
                    CRITICAL: This will purge all pending signals from Redis.
                    Discovery logs will remain, but the execution queue will be emptied.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-transparent border-zinc-800 text-[10px] font-bold hover:bg-zinc-900 hover:text-white rounded-none">DENY</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleAction("redis", wipeRedisCache, "CACHE_CLEARED")}
                    className="bg-white text-black text-[10px] font-bold hover:bg-zinc-200 rounded-none border-none"
                  >
                    ALLOW_WIPE
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* GLOBAL KILL SWITCH */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  disabled={actionLoading === "killswitch"}
                  className="text-[10px] font-bold px-4 py-1.5 border border-red-500/40 text-red-500 hover:bg-red-600 hover:text-white hover:border-red-600 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {actionLoading === "killswitch" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                  KILL_GHOST_PROTOCOL
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-black border-zinc-800 text-white font-mono">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm tracking-widest uppercase italic text-red-500">
                    ⚠️ GLOBAL_KILL_SWITCH
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-zinc-400 uppercase leading-relaxed">
                    CRITICAL: This will run <span className="text-red-500">docker compose down</span> on the Ghost Protocol.
                    All containers, networks, and orphan volumes will be <span className="text-red-500">DESTROYED</span>.
                    System resources will be fully released. This does NOT affect Milestone Protocol.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-transparent border-zinc-800 text-[10px] font-bold hover:bg-zinc-900 hover:text-white rounded-none">ABORT</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleAction("killswitch", killGhostProtocol, "GHOST_PROTOCOL_TERMINATED")}
                    className="bg-red-600 text-white text-[10px] font-bold hover:bg-red-700 rounded-none border-none"
                  >
                    CONFIRM_TERMINATION
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
      <div className="h-[1px] w-full bg-white/10" />
    </div>
  );
}