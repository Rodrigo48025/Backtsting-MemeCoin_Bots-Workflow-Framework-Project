"use client";

import { useEffect, useState } from "react";
import { getInsiderBotStatus } from "@/app/actions/insider-data";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type BotStatus = {
    name: string;
    codename: string;
    role: string;
    status: string;
    thinking: string;
    lastAction: string;
    lastTimestamp: string;
    errorCount: number;
    signalCount: number;
};

// Colors strictly Red, White, Light Grey, Black
const STATUS_STYLES: Record<string, string> = {
    ONLINE: "bg-white text-black hover:bg-white/90",
    STALE: "bg-red-500 text-white hover:bg-red-500/90",
    OFFLINE: "bg-neutral-800 text-white hover:bg-neutral-800/90",
    UNREACHABLE: "bg-black text-neutral-400 border border-neutral-800 hover:bg-black",
};

function timeAgo(ts: string): string {
    if (!ts) return "—";
    try {
        const then = new Date(ts + "Z").getTime();
        const now = Date.now();
        const diffSec = Math.floor((now - then) / 1000);
        if (diffSec < 60) return `${diffSec}s ago`;
        if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
        return `${Math.floor(diffSec / 3600)}h ago`;
    } catch {
        return "—";
    }
}

function stripEmojis(text: string): string {
    if (!text) return text;
    return text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu, "").trim();
}

export function InsiderBotBrain() {
    const [bots, setBots] = useState<BotStatus[]>([]);

    useEffect(() => {
        const fetch = async () => {
            const data = await getInsiderBotStatus();
            if (data) setBots(data);
        };
        fetch();
        const interval = setInterval(fetch, 4000);
        return () => clearInterval(interval);
    }, []);

    if (bots.length === 0) {
        return (
            <div className="text-neutral-400 text-xs font-mono animate-pulse p-4 text-center border border-dashed border-neutral-800 rounded-md">
                SYNCHRONIZING SYSTEM
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
            {bots.map((bot) => (
                <Card key={bot.name} className="bg-black border-neutral-800 rounded-lg shadow-none">
                    <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between space-y-0">
                        <div>
                            <CardTitle className="text-sm font-bold text-white uppercase tracking-wider">
                                {bot.name}
                            </CardTitle>
                            <CardDescription className="text-xs text-neutral-500">
                                {bot.codename}
                            </CardDescription>
                        </div>
                        <Badge variant="outline" className={`text-[10px] uppercase font-bold tracking-widest ${STATUS_STYLES[bot.status] || STATUS_STYLES.OFFLINE}`}>
                            {bot.status}
                        </Badge>
                    </CardHeader>
                    <CardContent className="p-4 pt-2 flex flex-col gap-3">
                        <div className="grid grid-cols-2 gap-y-2 text-xs">
                            <div className="text-neutral-500 uppercase">TASK:</div>
                            <div className="text-white text-right truncate" title={stripEmojis(bot.thinking)}>
                                {stripEmojis(bot.thinking) || "IDLE"}
                            </div>

                            <div className="text-neutral-500 uppercase">LAST_PING:</div>
                            <div className="text-white text-right">
                                {timeAgo(bot.lastTimestamp)}
                            </div>

                            <div className="text-neutral-500 uppercase">SIGNALS:</div>
                            <div className="text-white text-right font-bold">
                                {bot.signalCount}
                            </div>

                            <div className="text-neutral-500 uppercase">ERRORS:</div>
                            <div className={`text-right font-bold ${bot.errorCount > 0 ? "text-red-500" : "text-neutral-500"}`}>
                                {bot.errorCount}
                            </div>
                        </div>

                        <div className="text-xs text-neutral-400 truncate mt-2 pt-3 border-t border-neutral-800" title={stripEmojis(bot.lastAction)}>
                            <span className="text-neutral-600 uppercase pr-1">LAST_OP: </span>
                            {stripEmojis(bot.lastAction) || "NONE"}
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
