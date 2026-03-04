"use client";

import { useEffect, useState } from "react";
import { getDashboardData } from "@/app/actions/get-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LiveStats() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const refreshData = async () => {
      const result = await getDashboardData();
      if (result) setData(result);
    };
    refreshData();
    const interval = setInterval(refreshData, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return <div className="text-[10px] font-mono uppercase tracking-widest animate-pulse">Initializing_System_Link...</div>;

  const { stats } = data;

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 font-mono">
      <Card className="bg-black border-zinc-700 rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Net_PnL</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold text-white">
            {parseFloat(stats.total_pnl || 0) >= 0 ? "+" : ""}{parseFloat(stats.total_pnl || 0).toFixed(2)}%
          </div>
        </CardContent>
      </Card>

      <Card className="bg-black border-zinc-700 rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Win_Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold text-white">
            {stats.total_trades > 0 ? ((stats.wins / stats.total_trades) * 100).toFixed(1) : 0}%
          </div>
          <p className="text-[9px] text-zinc-500 uppercase mt-1">{stats.total_trades} Executions</p>
        </CardContent>
      </Card>

      <Card className="bg-black border-zinc-700 rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Avg_Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold text-white">
            {parseFloat(stats.avg_pnl || 0).toFixed(2)}%
          </div>
        </CardContent>
      </Card>

      <Card className="bg-black border-zinc-700 rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">System_State</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold text-white tracking-tighter">ACTIVE</div>
          <p className="text-[9px] text-zinc-500 uppercase mt-1">Sniper_Armed</p>
        </CardContent>
      </Card>
    </div>
  );
}