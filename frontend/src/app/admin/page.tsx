"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { 
  Shield, Lock, CheckCircle2, XCircle, 
  Activity, Clock 
} from "lucide-react";

/**
 * 관리자 대시보드 통계 데이터 인터페이스
 */
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

/**
 * 대시보드 메인 컴포넌트 (Props 타입 정의 추가)
 */
function Dashboard({ password, onLogout }: any) {
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

  const fetchStats = async () => { ... };

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
                  {/* 핵심 수정: 모든 status에 확실한 string 기본값 보장 */}
                  <StatusRow label="백엔드 서버" status={stats?.system_status?.backend || "error"} />
                  <StatusRow label="Cascade 엔진" status={stats?.system_status?.cascade_loaded ? "ok" : "error"} />
                  <StatusRow label="Azure Storage" status={stats?.system_status?.storage || "error"} />
                </div>
              </div>

              <div className="lg:col-span-2">
                <LatencyMonitor latency={stats
