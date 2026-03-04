"use client";

import useSWR from "swr";
import { useState } from "react";
import { getInsiderLogs } from "@/app/actions/insider-data";

const SERVICE_COLORS: Record<string, string> = {
    SCOUT: "text-neutral-400",
    WATCHER: "text-neutral-400",
    SNIPER: "text-neutral-400",
};

const SERVICE_BORDER: Record<string, string> = {
    SCOUT: "border-neutral-800",
    WATCHER: "border-neutral-800",
    SNIPER: "border-neutral-800",
};

export function InsiderLogs() {
    const [activeTab, setActiveTab] = useState("SCOUT");
    const [isPaused, setIsPaused] = useState(false);

    const { data: logsData } = useSWR(
        isPaused ? null : 'insider-logs',
        () => getInsiderLogs(40),
        { refreshInterval: 3000 }
    );

    const logs = logsData || [];

    const activeLogs = logs.find((l) => l.service === activeTab)?.lines || [];

    return (
        <div className="font-mono">
            {/* Tab Bar */}
            <div className="flex items-center gap-1 mb-2">
                {["SCOUT", "WATCHER", "SNIPER"].map((svc) => (
                    <button
                        key={svc}
                        onClick={() => setActiveTab(svc)}
                        className={`px-3 py-1.5 text-[8px] md:text-[9px] font-bold uppercase tracking-[0.2em] border transition-all duration-200 ${activeTab === svc
                            ? `${SERVICE_COLORS[svc]} ${SERVICE_BORDER[svc]} bg-black`
                            : "text-neutral-600 border-transparent hover:text-neutral-400 hover:border-neutral-800"
                            }`}
                    >
                        {svc}
                    </button>
                ))}

                <div className="flex-1" />

                <button
                    onClick={() => setIsPaused(!isPaused)}
                    className={`px-3 py-1.5 text-[8px] font-bold uppercase tracking-widest border transition-all ${isPaused
                        ? "text-red-500 border-red-900 bg-red-950/20"
                        : "text-neutral-600 border-transparent hover:text-neutral-400 hover:border-neutral-800"
                        }`}
                >
                    {isPaused ? "RESUME" : "PAUSE"}
                </button>
            </div>

            {/* Log Output */}
            <div
                className={`bg-black border ${SERVICE_BORDER[activeTab]} p-4 h-[300px] md:h-[400px] overflow-y-auto scroll-smooth rounded-lg`}
                style={{ scrollbarWidth: "thin" }}
            >
                {activeLogs.length === 0 ? (
                    <div className="text-neutral-500 text-[10px] animate-pulse uppercase tracking-widest">
                        AWAITING_SIGNAL_STREAM...
                    </div>
                ) : (
                    activeLogs.map((line, i) => (
                        <div
                            key={i}
                            className={`text-[9px] md:text-[10px] leading-relaxed mb-1 ${getLineColor(line)}`}
                        >
                            {formatLogLine(line)}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

function getLineColor(line: string): string {
    const l = line.toLowerCase();
    if (l.includes("error") || l.includes("crashed") || l.includes("fail") || l.includes("rejected") || l.includes("warn") || l.includes("rate limit") || l.includes("timeout"))
        return "text-red-500";
    if (l.includes("match") || l.includes("sniped") || l.includes("success") || l.includes("connected") || l.includes("trigger") || l.includes("found") || l.includes("added"))
        return "text-white font-bold";
    return "text-neutral-400";
}

// Strip emojis from the server action thinking bubbles/log lines
function stripEmojis(text: string): string {
    if (!text) return text;
    return text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu, "").trim();
}

function formatLogLine(line: string): string {
    let cleanLine = stripEmojis(line);
    // Strip Docker timestamp prefix (e.g. "2026-02-25T12:34:56.789Z ")
    const timestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?\s*/;
    const match = cleanLine.match(timestampRegex);
    if (match) {
        const ts = match[0].trim().split("T")[1]?.split(".")[0] || "";
        const rest = cleanLine.replace(timestampRegex, "");
        return `[${ts}] ${rest}`;
    }
    return cleanLine;
}

