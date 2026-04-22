"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { 
  Shield, Lock, CheckCircle2, XCircle, 
  AlertCircle, BarChart3, Activity, Calendar, 
  DollarSign, Clock, Zap, X, ChevronRight 
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

  // 인증되지 않은 경우 로그인 폼 표시 (에러 수정 완료)
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

  // 인증된 경우 실제 대시보드 렌더링
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
 * 대시보드 메인 컴포넌트
 */
function Dashboard({ password, onLogout }: any) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState<7 | 30>(7);

  // 관리자 통계 데이터 호출
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

  useEffect(() => {
    fetchStats();
  }, []);

  // [수정] 일일 사용량 필터링: 당일 데이터가 누락되지 않도록 문자열 비교 방식으로 개선
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
      {/* 상단 네비게이션 */}
      <nav className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
              <Shield size={20} />
            </div>
            <h1 className="text-xl font-bold text-gray-900">AdGuard Admin</h1>
          </div>
          <button 
            onClick={onLogout}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium"
          >
            로그아웃
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {loading ? (
          <div className="flex flex-col justify-center items-center py-24 gap-4">
            <Activity className="animate-spin text-blue-600" size={40} />
            <p className="text-gray-500 font-medium">데이터를 분석 중입니다...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 시스템 요약 섹션 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* 시스템 상태 카드 */}
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-6">
                  <Activity size={18} className="text-blue-600" />
                  <h3 className="font-bold text-gray-900">시스템 상태</h3>
                </div>
                <div className="space-y-4">
                  <StatusRow label="백엔드 서버" status={stats?.system_status.backend} />
                  <StatusRow label="Cascade 엔진" status={stats?.system_status.cascade_loaded ? "ok" : "error"} />
                  <StatusRow label="Azure Storage" status={stats?.system_status.storage} />
                </div>
              </div>

              {/* 레이턴시 모니터 섹션 (L1~L5 그래프) */}
              <div className="lg:col-span-2">
                <LatencyMonitor latency={stats?.latency_avg || { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 }} />
              </div>
            </div>

            {/* 통계 차트 섹션 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* 판정 비율 (Bar) */}
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-6">판정 결과 분포</h3>
                <div className="space-y-4">
                  <VerdictBar label="Safe" count={stats?.verdict_counts.safe || 0} total={stats?.total_count || 1} color="bg-green-500" />
                  <VerdictBar label="Caution" count={stats?.verdict_counts.caution || 0} total={stats?.total_count || 1} color="bg-yellow-500" />
                  <VerdictBar label="Hard Block" count={stats?.verdict_counts.hard_block || 0} total={stats?.total_count || 1} color="bg-red-500" />
                </div>
              </div>

              {/* 일일 사용량 (필터 적용된 그래프) */}
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-bold text-gray-900">일일 사용 추이</h3>
                  <div className="flex gap-2">
                    {[7, 30].map((d) => (
                      <button
                        key={d}
                        onClick={() => setDayFilter(d as any)}
                        className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                          dayFilter === d ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {d}일
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-48 flex items-end gap-2 px-2">
                  {filteredDaily.length > 0 ? (
                    filteredDaily.map((d, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-2 group relative">
                        <div 
                          className="w-full bg-blue-100 rounded-t-sm group-hover:bg-blue-600 transition-colors"
                          style={{ height: `${(d.count / Math.max(...filteredDaily.map(x => x.count), 1)) * 100}%` }}
                        />
                        <span className="text-[10px] text-gray-400 rotate-45 mt-2 origin-left whitespace-nowrap">
                          {d.date.split('-').slice(1).join('/')}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">데이터가 없습니다.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 레이턴시 모니터 (L1~L5 가로 막대 그래프)
 */
function LatencyMonitor({ latency }: { latency: any }) {
  const steps = ["L1", "L2", "L3", "L4", "L5"];
  const labels: any = { L1: "Rule", L2: "RAG", L3: "Judge", L4: "Rewrite", L5: "Verify" };

  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm h-full">
      <div className="flex items-center gap-2 mb-6">
        <Clock size={18} className="text-blue-600" />
        <h3 className="font-bold text-gray-900">단계별 평균 응답 시간 (ms)</h3>
      </div>
      <div className="space-y-5">
        {steps.map((step) => (
          <div key={step} className="space-y-1">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-gray-600">{step}. {labels[step]}</span>
              <span className="text-blue-600">{(latency[step] * 1000).toFixed(0)}ms</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.min((latency[step] / 5) * 100, 100)}%` }}
                className="h-full bg-blue-500 rounded-full"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 로그인 폼 컴포넌트
 */
function LoginForm({ onLogin }: { onLogin: (p: string) => void }) {
  const [input, setInput] = useState("");
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="inline-flex w-16 h-16 bg-blue-600 rounded-2xl items-center justify-center text-white mb-4">
          <Lock size={32} />
        </div>
        <h2 className="text-3xl font-bold text-white">관리자 인증</h2>
        <div className="bg-gray-900 p-8 rounded-3xl border border-gray-800 shadow-2xl">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onLogin(input)}
            placeholder="비밀번호를 입력하세요"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-600 transition-all outline-none mb-4"
          />
          <button 
            onClick={() => onLogin(input)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all"
          >
            접속하기
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 기타 UI 보조 컴포넌트들
 */
function StatusRow({ label, status }: { label: string, status: string }) {
  const isOk = status === "ok";
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-500">{label}</span>
      <div className={`flex items-center gap-1.5 text-sm font-bold ${isOk ? "text-green-600" : "text-red-600"}`}>
        {isOk ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
        {isOk ? "정상" : "오류"}
      </div>
    </div>
  );
}

function VerdictBar({ label, count, total, color }: any) {
  const percent = (count / total) * 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-bold">
        <span>{label}</span>
        <span>{count}건 ({percent.toFixed(1)}%)</span>
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
