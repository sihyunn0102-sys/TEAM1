"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Shield, Lock, CheckCircle2, XCircle,
  AlertCircle, BarChart3, Activity, Calendar,
  DollarSign, Clock, Zap, X, ChevronRight
} from "lucide-react";

// ─── 타입 정의 ─────────────────────────────────────────
interface SystemStatus {
  backend: string;
  cascade_loaded: boolean;
  storage: string;
}

interface VerdictCounts {
  safe: number;
  caution: number;
  hard_block: number;
  other: number;
}

interface DailyUsage {
  date: string;
  count: number;
}

interface LatencyStats {
  L1: number;
  L2: number;
  L3: number;
  L4: number;
  L5: number;
}

interface StatsData {
  system_status: SystemStatus;
  total_count: number;
  verdict_counts: VerdictCounts;
  daily_usage: DailyUsage[];
  latency_avg?: LatencyStats;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://9ai-2nd-team-app-service-b0h3evedgec0dtda.eastus-01.azurewebsites.net";

// ─────────────────────────────────────────────
// 📊 Daily Usage Chart (FIX: 0~100% normalized)
// ─────────────────────────────────────────────
function DailyUsageChart({ data, dayFilter, onChangeFilter }: any) {
  const maxCount = useMemo(() => Math.max(...data.map((d: any) => d.count), 1), [data]);

  const normalized = useMemo(() => {
    return data.map((d: any) => ({
      ...d,
      percent: (d.count / maxCount) * 100,
    }));
  }, [data, maxCount]);

  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm h-full flex flex-col">

      {/* header */}
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
          <Calendar className="w-4 h-4" /> 트래픽 모니터링
        </h2>

        <div className="flex gap-1 bg-gray-50 rounded-xl p-1 border border-gray-100">
          {[7, 30].map(d => (
            <button
              key={d}
              onClick={() => onChangeFilter(d)}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                dayFilter === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-400"
              }`}
            >
              {d === 7 ? "WEEKLY" : "MONTHLY"}
            </button>
          ))}
        </div>
      </div>

      {/* chart area */}
      <div className="flex flex-1">

        {/* y axis */}
        <div className="flex flex-col justify-between pr-3 text-[9px] text-gray-300 font-bold">
          <span>100%</span>
          <span>75%</span>
          <span>50%</span>
          <span>25%</span>
          <span>0%</span>
        </div>

        {/* bars */}
        <div className="flex items-end gap-2 flex-1 h-52 px-2 border-l border-gray-100">

          {normalized.length > 0 ? normalized.map((d: any, idx: number) => (
            <div key={idx} className="group relative flex-1 flex flex-col items-center">

              <div className="absolute -top-6 opacity-0 group-hover:opacity-100 transition text-[9px] font-black bg-white border px-2 py-0.5 rounded shadow">
                {d.count}건 ({d.percent.toFixed(0)}%)
              </div>

              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${d.percent}%` }}
                transition={{ delay: idx * 0.02 }}
                className="w-full bg-gray-900 rounded-t-lg min-h-[2px] hover:bg-blue-600"
              />

              <span className="text-[8px] text-gray-300 font-bold mt-3 rotate-45 origin-left">
                {d.date.slice(5)}
              </span>
            </div>
          )) : (
            <div className="w-full flex items-center justify-center text-gray-300 text-xs font-bold">
              데이터가 없습니다.
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// (나머지는 기존 그대로 유지)
// ─────────────────────────────────────────────

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");

  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState<7 | 30>(7);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND_URL}/admin/stats`, {
        headers: { "X-Admin-Password": password },
      });
      if (res.ok) setStats(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

  const filteredDaily = useMemo(() => {
    if (!stats?.daily_usage) return [];
    const now = new Date();
    const cutoff = new Date(now.setDate(now.getDate() - dayFilter))
      .toISOString().split("T")[0];

    return stats.daily_usage
      .filter(d => d.date >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [stats?.daily_usage, dayFilter]);

  return (
    <div className="p-10 bg-gray-50 min-h-screen">

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* 기존 카드 */}
        <div className="bg-white p-6 rounded-3xl border">
          <h1 className="font-black text-xl">Dashboard</h1>
          <p className="text-gray-400 text-sm">Admin Panel</p>
        </div>

        {/* 🔥 트래픽 차트 (수정됨) */}
        <DailyUsageChart
          data={filteredDaily}
          dayFilter={dayFilter}
          onChangeFilter={setDayFilter}
        />

      </div>
    </div>
  );
}
