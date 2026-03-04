"use client";

import { useState, useEffect } from "react";
import { getVolumeBotStatus } from "@/app/actions/volume-data";
import { Card, CardContent } from "@/components/ui/card";
import { Brain, Zap, Target, Activity } from "lucide-react";

import useSWR from "swr";

export function VolumeBotBrain() {
    const { data: botsData } = useSWR('volume-bot-status', getVolumeBotStatus, { refreshInterval: 2000 });
    const bots = botsData || [];

    if (bots.length === 0) return null;

    return (
        <div className="grid gap-3 md:gap-4 md:grid-cols-3 font-mono">
            {bots.map((bot, i) => (
                <Card key={i} className="bg-neutral-950 border-neutral-800 rounded-none overflow-hidden relative group">
                    <div className={`absolute top-0 right-0 px-2 py-0.5 text-[7px] font-black uppercase tracking-widest ${bot.status === 'ONLINE' ? 'bg-emerald-500 text-black' :
                        bot.status === 'STALE' ? 'bg-amber-500 text-black animate-pulse' :
                            'bg-red-500 text-white'
                        }`}>
                        {bot.status}
                    </div>

                    <CardContent className="p-4 pt-6">
                        <div className="flex items-start justify-between mb-4">
                            <div className="space-y-0.5">
                                <h3 className="text-[10px] md:text-xs font-black text-white uppercase tracking-tighter">{bot.name}</h3>
                                <p className="text-[7px] md:text-[8px] font-bold text-neutral-500 uppercase tracking-widest">{bot.codename}</p>
                            </div>
                            <div className="p-2 bg-neutral-900 border border-neutral-800">
                                {bot.name === "SCOUT" ? <Activity className="w-4 h-4 text-emerald-500" /> :
                                    bot.name === "WATCHER" ? <Zap className="w-4 h-4 text-emerald-500" /> :
                                        <Target className="w-4 h-4 text-emerald-500" />}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="space-y-1">
                                <span className="text-[7px] font-bold text-neutral-600 uppercase tracking-widest block">Current_Thought:</span>
                                <p className="text-[9px] md:text-[10px] text-neutral-200 font-bold leading-tight line-clamp-2 italic">
                                    "{bot.thinking}"
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-neutral-900">
                                <div className="space-y-0.5">
                                    <span className="text-[6px] font-bold text-neutral-600 uppercase">Signals</span>
                                    <div className="text-[9px] font-black text-white">{bot.signalCount}</div>
                                </div>
                                <div className="space-y-0.5">
                                    <span className="text-[6px] font-bold text-neutral-600 uppercase">Errors</span>
                                    <div className={`text-[9px] font-black ${bot.errorCount > 0 ? 'text-red-500' : 'text-neutral-500'}`}>{bot.errorCount}</div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
