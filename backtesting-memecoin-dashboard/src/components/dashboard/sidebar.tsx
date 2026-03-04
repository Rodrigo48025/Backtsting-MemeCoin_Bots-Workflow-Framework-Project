"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Menu, X, Ghost, Trophy, Search, Zap } from "lucide-react";
import { useState, useEffect } from "react";

const FLEET = [
  { name: "GHOST_PROTOCOL", href: "/ghost-protocol", icon: Ghost },
  { name: "MILESTONE_PROTOCOL", href: "/milestone-protocol", icon: Trophy },
  { name: "INSIDER_PROTOCOL", href: "/insider-protocol", icon: Search },
  { name: "COPY_TRADE_PROTOCOL", href: "/copy-trade-protocol", icon: Search },
  { name: "GRADUATION_PROTOCOL", href: "/graduation-protocol", icon: Trophy },
  { name: "VOLUME_PROTOCOL", href: "/volume-protocol", icon: Zap },
  { name: "EARLY_SNIPER_PROTOCOL", href: "/early-sniper-protocol", icon: Zap },
];

const LIVE_FLEET = [
  { name: "INSIDER_PROTOCOL_LIVE", href: "/insider-protocol-live", icon: Search },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* MOBILE HAMBURGER - Visible only on mobile */}
      <div className="lg:hidden fixed top-4 left-4 z-[60]">
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-2 bg-black border border-white/10 rounded-sm text-white"
        >
          {isMobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* SIDEBAR OVERLAY - Mobile only */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <div className={cn(
        "bg-black flex flex-col h-screen font-mono border-r border-white/10 transition-all duration-300 ease-in-out z-40",
        // Desktop widths
        isCollapsed ? "lg:w-20" : "lg:w-64",
        // Mobile behavior
        "fixed inset-y-0 left-0 lg:relative lg:translate-x-0 transform transition-transform",
        isMobileOpen ? "translate-x-0 w-64 shadow-[20px_0_50px_rgba(0,0,0,0.8)]" : "-translate-x-full lg:translate-x-0"
      )}>
        {/* COLLAPSE TOGGLE - Desktop only */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden lg:flex absolute -right-3 top-12 w-6 h-6 bg-black border border-white/10 rounded-full items-center justify-center text-white/50 hover:text-white hover:border-white/30 z-50 transition-colors"
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>

        <div className={cn(
          "transition-all duration-300",
          isCollapsed ? "lg:p-6 lg:mb-4 lg:items-center" : "p-10 mb-4"
        )}>
          <div className={cn("flex flex-col gap-1", isCollapsed && "lg:items-center")}>
            {isCollapsed ? (
              <Ghost className="text-white" size={20} />
            ) : (
              <>
                <span className="font-bold tracking-[0.4em] text-xs text-white">ANTIGRAVITY</span>
                <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">v1.0.4-stable</span>
              </>
            )}
          </div>
        </div>

        <div className={cn("flex-1 px-6 transition-all duration-300 overflow-y-auto overflow-x-hidden", isCollapsed && "lg:px-2")}>
          {!isCollapsed && (
            <h3 className="px-4 text-[9px] font-bold text-zinc-400 tracking-[0.3em] mb-4 uppercase">Simulations (Paper)</h3>
          )}
          <nav className="space-y-3">
            {FLEET.map((bot) => (
              <Link
                key={bot.href}
                href={bot.href}
                className={cn(
                  "flex items-center gap-4 px-4 py-2 text-[11px] font-bold tracking-[0.1em] transition-all border-l-2",
                  isCollapsed && "lg:justify-center lg:px-0 lg:border-l-0 lg:border-b-2",
                  pathname.startsWith(bot.href) || (pathname === "/" && bot.href === "/ghost-protocol")
                    ? "text-white border-white bg-white/5"
                    : "text-zinc-500 border-transparent hover:text-white/80"
                )}
                title={isCollapsed ? bot.name : undefined}
              >
                {isCollapsed ? (
                  <span className="text-[10px] font-bold">{bot.name.charAt(0)}</span>
                ) : (
                  <span>{bot.name}</span>
                )}
              </Link>
            ))}
          </nav>

          <div className="my-6 border-t border-white/10" />

          {!isCollapsed && (
            <h3 className="px-4 text-[9px] font-bold text-[#00ff9d] tracking-[0.3em] mb-4 uppercase">Live Strategies</h3>
          )}
          <nav className="space-y-3">
            {LIVE_FLEET.map((bot) => (
              <Link
                key={bot.href}
                href={bot.href}
                className={cn(
                  "flex items-center gap-4 px-4 py-2 text-[11px] font-bold tracking-[0.1em] transition-all border-l-2",
                  isCollapsed && "lg:justify-center lg:px-0 lg:border-l-0 lg:border-b-2",
                  pathname.startsWith(bot.href)
                    ? "text-[#00ff9d] border-[#00ff9d] bg-[#00ff9d]/5"
                    : "text-zinc-500 border-transparent hover:text-[#00ff9d]/80"
                )}
                title={isCollapsed ? bot.name : undefined}
              >
                {isCollapsed ? (
                  <span className="text-[10px] font-bold">{bot.name.charAt(0)}</span>
                ) : (
                  <span>{bot.name}</span>
                )}
              </Link>
            ))}
          </nav>
        </div>

        <div className={cn(
          "transition-all duration-300 text-zinc-600 font-bold uppercase tracking-[0.5em] mt-auto",
          isCollapsed ? "lg:p-6 lg:text-[7px] lg:text-center lg:tracking-normal" : "p-10 text-[8px]"
        )}>
          {isCollapsed ? "AUTH" : "SYS_AUTH: VERIFIED"}
        </div>
      </div>
    </>
  );
}