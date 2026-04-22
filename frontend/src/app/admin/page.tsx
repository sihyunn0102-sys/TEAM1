"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Shield, Lock, CheckCircle2, XCircle,
  AlertCircle, BarChart3, Activity, Calendar,
  DollarSign, Clock, ChevronRight, RefreshCw, LogOut
} from "lucide-react";

// ─── 타입 정의 ─────────────────────────────────────────
interface SystemStatus {
  backend: string;
  cascade_loaded: boolean;
  storage: string;
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
  verdict_counts: { safe: number; caution: number; hard_block: number; other: number };
  daily_usage: { date: string; count: number }[];
  latency_avg: LatencyStats; // 백엔드에서 새로 추가된 필드
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://your-backend-api.azurewebsites.net";

// ─── 1. 레이어별 속도 모니터링 (수정 핵심) ──────────────────
function LatencyMonitor({ latency }: { latency: LatencyStats }) {
  const layers = [
    { id: "L1", label: "Rule Engine", val: latency.L1 || 0, color: "bg-blue-400" },
    { id: "L2", label: "RAG Search", val: latency.L2 || 0, color: "bg-indigo-400" },
    { id: "L3", label: "AI Judge", val: latency.L3 || 0, color: "bg-purple-500" },
    { id: "L4", label: "Rewriter", val: latency.L4 || 0, color: "bg-pink-400" },
    { id: "L5", label: "Verifier", val: latency.L5 || 0, color: "bg-rose-400" },
  ];

  const totalSec = layers.reduce((acc, curr) => acc + curr.val, 0);
  const maxVal = Math.max(...layers.map(l => l.val), 0.1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm h-full flex flex-col justify-between"
    >
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-sm font-bold text-gray-500 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-500" /> 레이어별 평균 소요 시간
        </h2>
        <div className="flex items-end gap-1">
          <span className="text-3xl font-black text-blue-700 tracking-tighter">{totalSec.toFixed(2)}s</span>
          <span className="text-[10px] text-gray-400 mb-1 font-bold">TOTAL</span>
        </div>
      </div>

      <div className="space-y-5 flex-1 flex flex-col justify-center">
        {layers.map((layer) => (
          <div key={layer.id} className="group">
            <div className="flex justify-between text-[10px] font-black mb-1.5 uppercase tracking-tight">
              <span className="text-gray-400">{layer.id} · {layer.label}</span>
              <span className="text-gray-900 group-hover:text-blue-600 transition-colors">{layer.val.toFixed(3)}s</span>
            </div>
            <div className="w-full h-2 bg-gray-50 rounded-full overflow-hidden border border-gray-50">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(layer.val / maxVal) * 100}%` }}
                className={`h-full rounded-full ${layer.color}`}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-6 text-center italic">
        * AI 엔진(L3)의 응답 속도가 전체 레이턴시의 약 {((latency.L3 / totalSec) * 100 || 0).toFixed(0)}%를 차지합니다.
      </p>
    </motion.div>
  );
}

// ─── 2. 메인 대시보드 컴포넌트 ───────────────────────────────
export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = async (pw: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/admin/stats`, {
        headers: { "X-Admin-Password": pw },
      });
      if (res.ok) {
        setStats(await res.json());
        setAuthenticated(true);
        sessionStorage.setItem("adguard_pw", pw);
      } else {
        alert("인증에 실패했습니다.");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("adguard_pw");
    if (saved) { fetchStats(saved); setPassword(saved); }
  }, []);

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md bg-white rounded-[40px] shadow-2xl p-12 text-center border border-gray-100">
          <div className="w-20 h-20 bg-gray-900 rounded-[28px] flex items-center justify-center text-white mx-auto mb-8 shadow-xl"><Shield size={40} /></div>
          <h1 className="text-3xl font-black text-gray-900 mb-2">Admin Portal</h1>
          <p className="text-gray-400 text-sm mb-10 font-medium">관리자 암호를 입력하여 시스템에 접속하세요.</p>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-6 py-4 rounded-2xl bg-gray-50 border border-gray-100 focus:bg-white focus:border-gray-900 outline-none mb-4 font-mono transition-all" placeholder="••••••••" />
          <button onClick={() => fetchStats(password)} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black hover:bg-black transition-all shadow-lg">접속하기</button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      {/* 상단 바 */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white"><Shield size={20} /></div>
            <span className="font-black text-xl tracking-tighter">ADGUARD <span className="text-gray-300 font-light">OPS</span></span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => fetchStats(password)} className="p-2 rounded-xl hover:bg-gray-100 transition-all">{loading ? <RefreshCw className="animate-spin text-blue-600" /> : <RefreshCw size={20} />}</button>
            <button onClick={() => { sessionStorage.clear(); location.reload(); }} className="flex items-center gap-2 text-xs font-black text-red-500 hover:bg-red-50 px-4 py-2 rounded-xl transition-all"><LogOut size={16} /> LOGOUT</button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-8">
        {/* 요약 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <MetricCard title="전체 분석 건수" value={stats?.total_count || 0} icon={<BarChart3 />} color="text-gray-900" />
          <MetricCard title="안전 판정" value={stats?.verdict_counts.safe || 0} icon={<CheckCircle2 />} color="text-green-600" />
          <MetricCard title="수정 권고" value={stats?.verdict_counts.caution || 0} icon={<AlertCircle />} color="text-yellow-600" />
          <MetricCard title="위반 판정" value={stats?.verdict_counts.hard_block || 0} icon={<XCircle />} color="text-red-600" />
        </div>

        {/* 핵심 차트 구간 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 h-full">
            <SystemStatusCard status={stats?.system_status} />
          </div>
          <div className="lg:col-span-2 h-full">
            <LatencyMonitor latency={stats?.latency_avg || { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 }} />
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── 유틸리티 컴포넌트 ──────────────────────────────────────
function MetricCard({ title, value, icon, color }: any) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
      <div className="flex justify-between items-start mb-4 text-gray-400 uppercase text-[10px] font-black tracking-widest">
        {title} <span className={color}>{icon}</span>
      </div>
      <div className="text-3xl font-black tabular-nums tracking-tighter">{value.toLocaleString()}</div>
    </div>
  );
}

function SystemStatusCard({ status }: any) {
  const items = [
    { label: "AI Inference", ok: status?.backend === "ok" },
    { label: "Azure Storage", ok: status?.storage === "ok" },
    { label: "Cascade Logic", ok: status?.cascade_loaded },
  ];

  return (
    <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm h-full">
      <h2 className="text-sm font-bold text-gray-500 mb-8 uppercase tracking-widest flex items-center gap-2"><Activity size={16} /> 인프라 상태</h2>
      <div className="space-y-4">
        {items.map((it, i) => (
          <div key={i} className="flex justify-between items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
            <span className="text-xs font-black text-gray-600 uppercase">{it.label}</span>
            <div className={`w-3 h-3 rounded-full ${it.ok ? "bg-green-500 animate-pulse shadow-[0_0_10px_green]" : "bg-red-500"}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
