"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Shield, Lock, CheckCircle2, XCircle,
  Activity, Clock
} from "lucide-react";

interface StatsData {
  system_status: {
    backend: string;
    cascade_loaded: boolean;
    storage: string;
  };
  total_count: number;
  verdict_counts: {
    safe: number;
    caution: number;
    hard_block: number;
    other: number;
  };
  daily_usage: { date: string; count: number }[];
  latency_avg?: {
    L1: number;
    L2: number;
    L3: number;
    L4: number;
    L5: number;
  };
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");

  if (!authenticated) {
    return (
      <LoginForm
        onLogin={(inputPass: string) => {
          setPassword(inputPass);
          setAuthenticated(true);
        }}
      />
    );
  }

  return (
    <Dashboard
      password={password}
      onLogout={() => {
        setAuthenticated(false);
        setPassword("");
      }}
    />
  );
}

function Dashboard({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState<7 | 30>(7);
  const [localTotalMs, setLocalTotalMs] = useState<number | null>(null);

  const readLocalMs = () => {
    try {
      const raw = localStorage.getItem("adguard_result");
      if (raw) {
        const data = JSON.parse(raw);
        if (data._totalMs != null) setLocalTotalMs(data._totalMs);
      }
    } catch {}
  };

  useEffect(() => {
    readLocalMs();
    document.addEventListener("visibilitychange", readLocalMs);
    window.addEventListener("focus", readLocalMs);
    return () => {
      document.removeEventListener("visibilitychange", readLocalMs);
      window.removeEventListener("focus", readLocalMs);
    };
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND_URL}/admin/stats`, {
        headers: { "X-Admin-Password": password },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.error("통계 로드 실패:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

  const filteredDaily = useMemo(() => {
    if (!stats?.daily_usage) return [];
    const now = new Date();
    const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayFilter);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    return [...stats.daily_usage]
      .filter(d => d.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [stats?.daily_usage, dayFilter]);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
              <Shield size={20} />
            </div>
            <h1 className="text-xl font-bold text-gray-900">AdGuard Admin</h1>
          </div>
          <button onClick={onLogout} className="text-sm text-gray-500 hover:text-gray-700 font-medium">
            로그아웃
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {loading ? (
          <div className="flex flex-col justify-center items-center py-24 gap-4">
            <Activity className="animate-spin text-blue-600" size={40} />
            <p className="text-gray-500 font-medium">데이터 로드 중...</p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-6">
                  <Activity size={18} className="text-blue-600" />
                  <h3 className="font-bold text-gray-900">시스템 상태</h3>
                </div>
                <div className="space-y-4">
                  <StatusRow label="백엔드 서버" status={stats?.system_status?.backend || "error"} />
                  <StatusRow label="Cascade 엔진" status={stats?.system_status?.cascade_loaded ? "ok" : "error"} />
                  <StatusRow label="Azure Storage" status={stats?.system_status?.storage || "error"} />
                </div>
              </div>

              <div className="lg:col-span-2">
                {stats?.latency_avg ? (
                  <LatencyMonitor latency={stats.latency_avg} localTotalMs={localTotalMs} />
                ) : (
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-center h-full text-gray-400 text-sm">
                    분석 데이터가 쌓이면 레이턴시가 표시됩니다.
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm text-center">
                <p className="text-xs text-gray-400 font-bold uppercase mb-2">총 분석</p>
                <p className="text-3xl font-black text-gray-900">{stats?.total_count ?? 0}</p>
              </div>
              <div className="bg-green-50 p-6 rounded-2xl border border-green-100 shadow-sm text-center">
                <p className="text-xs text-green-600 font-bold uppercase mb-2">Safe</p>
                <p className="text-3xl font-black text-green-700">{stats?.verdict_counts?.safe ?? 0}</p>
              </div>
              <div className="bg-yellow-50 p-6 rounded-2xl border border-yellow-100 shadow-sm text-center">
                <p className="text-xs text-yellow-600 font-bold uppercase mb-2">Caution</p>
                <p className="text-3xl font-black text-yellow-700">{stats?.verdict_counts?.caution ?? 0}</p>
              </div>
              <div className="bg-red-50 p-6 rounded-2xl border border-red-100 shadow-sm text-center">
                <p className="text-xs text-red-600 font-bold uppercase mb-2">Block</p>
                <p className="text-3xl font-black text-red-700">{stats?.verdict_counts?.hard_block ?? 0}</p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-gray-900">일별 분석 현황</h3>
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                  {([7, 30] as const).map(d => (
                    <button key={d} onClick={() => setDayFilter(d)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${dayFilter === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-400"}`}>
                      {d}일
                    </button>
                  ))}
                </div>
              </div>
              {filteredDaily.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">데이터 없음</p>
              ) : (
                <div className="flex items-end gap-1 h-32">
                  {filteredDaily.map((d) => {
                    const max = Math.max(...filteredDaily.map(x => x.count), 1);
                    return (
                      <div key={d.date} className="flex-1 bg-blue-500 rounded-t-sm min-h-[2px]"
                        style={{ height: `${(d.count / max) * 100}%` }} title={`${d.date}: ${d.count}건`} />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LoginForm({ onLogin }: { onLogin: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl shadow-xl p-10 border border-gray-100">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center text-white mb-4">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Login</h1>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onLogin(pw); }} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="Password" autoFocus
              className="w-full pl-11 pr-4 py-3 rounded-2xl border border-gray-200 focus:border-gray-900 outline-none" />
          </div>
          <button type="submit" disabled={!pw}
            className="w-full py-3 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black disabled:opacity-50">
            Login
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function StatusRow({ label, status }: { label: string; status: string }) {
  const ok = status === "ok";
  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 size={16} className="text-green-500" /> : <XCircle size={16} className="text-red-500" />}
        <span className={`text-xs font-bold ${ok ? "text-green-600" : "text-red-600"}`}>{ok ? "정상" : "오류"}</span>
      </div>
    </div>
  );
}

function LatencyMonitor({ latency, localTotalMs }: { latency: NonNullable<StatsData["latency_avg"]>; localTotalMs: number | null }) {
  const layers = [
    { id: "L1", name: "Rule Engine", value: latency.L1, color: "bg-blue-500" },
    { id: "L2", name: "RAG Search",  value: latency.L2, color: "bg-indigo-500" },
    { id: "L3", name: "AI Verdict",  value: latency.L3, color: "bg-purple-500" },
    { id: "L4", name: "Rewriter",    value: latency.L4, color: "bg-emerald-500" },
    { id: "L5", name: "Verifier",    value: latency.L5, color: "bg-slate-500" },
  ];
  const serverTotal = Object.values(latency).reduce((acc, v) => acc + (v || 0), 0);

  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm h-full flex flex-col">
      <div className="flex items-center gap-2 mb-6">
        <Clock size={18} className="text-blue-500" />
        <h3 className="font-bold text-gray-900">레이어별 평균 분석 시간</h3>
      </div>
      <div className="space-y-4 flex-1">
        {layers.map((layer) => (
          <div key={layer.id}>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="font-bold text-gray-700">{layer.id}. {layer.name}</span>
              <span className="text-gray-400 font-mono">{(layer.value || 0).toFixed(2)}s</span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: serverTotal > 0 ? `${((layer.value || 0) / serverTotal) * 100}%` : "0%" }}
                transition={{ duration: 1 }}
                className={`h-full ${layer.color}`}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 pt-4 border-t border-gray-100 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-400 font-bold uppercase">Avg Server Time</span>
          <span className="text-sm font-black text-gray-900">{serverTotal.toFixed(2)}s</span>
        </div>
        {localTotalMs != null && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400 font-bold uppercase">Last Total (client)</span>
            <span className="text-sm font-black text-gray-900">{(localTotalMs / 1000).toFixed(2)}s</span>
          </div>
        )}
      </div>
    </div>
  );
}
