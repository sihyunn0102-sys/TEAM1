"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { 
  Shield, Lock, CheckCircle2, XCircle, 
  AlertCircle, BarChart3, Activity, Calendar, 
  DollarSign, Clock 
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
  latency_avg?: LatencyStats; // 백엔드 미수정 대비 선택적 필드로 지정
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://9ai-2nd-team-app-service-b0h3evedgec0dtda.eastus-01.azurewebsites.net";

// ─── 서브 컴포넌트: 레이어별 속도 모니터링 ──────────────────
function LatencyMonitor({ latency }: { latency: LatencyStats }) {
  const layers = [
    { id: "L1", name: "Rule Engine", value: latency.L1, color: "bg-blue-500" },
    { id: "L2", name: "RAG Search", value: latency.L2, color: "bg-indigo-500" },
    { id: "L3", name: "AI Verdict", value: latency.L3, color: "bg-purple-500" },
    { id: "L4", name: "Rewriter", value: latency.L4, color: "bg-emerald-500" },
    { id: "L5", name: "Verifier", value: latency.L5, color: "bg-slate-500" },
  ];

  const total = Object.values(latency).reduce((acc, curr) => acc + (curr || 0), 0);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm flex flex-col h-full"
    >
      <h2 className="text-sm font-bold text-gray-500 mb-6 flex items-center gap-2">
        <Clock className="w-4 h-4 text-blue-500" /> 실시간 분석 레이어 Latency
      </h2>
      <div className="space-y-4 flex-1">
        {layers.map((layer) => (
          <div key={layer.id}>
            <div className="flex justify-between text-[11px] mb-1.5">
              <span className="font-bold text-gray-700">{layer.id}. {layer.name}</span>
              <span className="text-gray-400 font-mono">{(layer.value || 0).toFixed(2)}s</span>
            </div>
            <div className="w-full h-1.5 bg-gray-50 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: total > 0 ? `${((layer.value || 0) / total) * 100}%` : "0%" }}
                transition={{ duration: 1 }}
                className={`h-full ${layer.color}`}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 pt-4 border-t border-gray-50 flex justify-between items-center">
        <span className="text-[10px] text-gray-400 font-bold uppercase">Average Total Time</span>
        <span className="text-sm font-black text-gray-900">{total.toFixed(2)}s</span>
      </div>
    </motion.div>
  );
}

// ─── 서브 컴포넌트: 비용 예측 카드 ─────────────────────────
function EstimatedCostCard({ totalCount }: { totalCount: number }) {
  const AVG_COST_PER_REQ = 0.0125; 
  const estimatedTotal = totalCount * AVG_COST_PER_REQ;
  const BUDGET_GOAL = 50.0;
  const usageRatio = Math.min((estimatedTotal / BUDGET_GOAL) * 100, 100);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm mb-8"
    >
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-sm font-bold text-gray-500 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-500" />
            운영 비용 예측 (Estimated Cost)
          </h2>
          <p className="text-[11px] text-gray-400 mt-1">GPT-4o API 호출 기반 실시간 추정치</p>
        </div>
        <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-md uppercase">USD</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
        <div>
          <div className="text-4xl font-black text-gray-900">${estimatedTotal.toFixed(3)}</div>
          <div className="text-xs text-gray-400 mt-1 font-medium italic">누적 {totalCount.toLocaleString()}건 분석</div>
        </div>
        <div className="md:col-span-2">
          <div className="flex justify-between text-xs font-bold mb-2">
            <span className={usageRatio > 80 ? "text-red-500" : "text-gray-600"}>예산 소진율 {usageRatio.toFixed(1)}%</span>
            <span className="text-gray-400">목표: ${BUDGET_GOAL}</span>
          </div>
          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${usageRatio}%` }}
              className={`h-full ${usageRatio > 80 ? "bg-red-500" : "bg-emerald-500"}`}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── 메인 페이지 컴포넌트 ───────────────────────────────────
export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("adguard_admin_pw");
    if (saved) {
      setPassword(saved);
      setAuthenticated(true);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/admin/stats`, {
        headers: { "X-Admin-Password": password },
      });
      if (res.status === 401) setLoginError("비밀번호가 올바르지 않습니다.");
      else if (!res.ok) setLoginError(`서버 오류 (${res.status})`);
      else {
        sessionStorage.setItem("adguard_admin_pw", password);
        setAuthenticated(true);
      }
    } catch (err) {
      setLoginError("서버 연결 실패");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("adguard_admin_pw");
    setPassword("");
    setAuthenticated(false);
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md bg-white rounded-3xl shadow-xl p-10 border border-gray-100">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center text-white mb-4"><Shield className="w-8 h-8" /></div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Login</h1>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoFocus className="w-full pl-11 pr-4 py-3 rounded-2xl border border-gray-200 focus:border-gray-900 outline-none" />
            </div>
            {loginError && <div className="text-sm text-red-500 text-center">{loginError}</div>}
            <button type="submit" disabled={loginLoading || !password} className="w-full py-3 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black disabled:opacity-50">
              {loginLoading ? "Authenticating..." : "Login"}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return <Dashboard password={password} onLogout={handleLogout} />;
}

// ─── 대시보드 컴포넌트 ───────────────────────────────────
function Dashboard({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState<7 | 30>(7);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND_URL}/admin/stats`, {
        headers: { "X-Admin-Password": password },
        cache: "no-store",
      });
      if (res.ok) setStats(await res.json());
    } catch (e) {
      console.error("Fetch failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

  const filteredDaily = stats?.daily_usage ? filterRecentDays(stats.daily_usage, dayFilter) : [];

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white"><Shield className="w-5 h-5" /></div>
            <h1 className="text-lg font-bold text-gray-900">AdGuard Management</h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={fetchStats} className="text-xs px-4 py-2 bg-gray-100 rounded-xl font-bold">
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button onClick={onLogout} className="text-xs text-gray-400 font-bold">Logout</button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {stats && (
          <div className="space-y-8">
            <EstimatedCostCard totalCount={stats.total_count} />
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <SystemStatusCard status={stats.system_status} />
               {/* 백엔드 데이터가 있을 때만 렌더링 */}
               {stats.latency_avg && <LatencyMonitor latency={stats.latency_avg} />}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <MetricCard label="Total Analyzed" value={stats.total_count} icon={<BarChart3 className="w-5 h-5" />} colorClass="bg-gray-900 text-white" />
              <MetricCard label="Safe" value={stats.verdict_counts.safe} icon={<CheckCircle2 className="w-5 h-5" />} colorClass="bg-green-50 text-green-700" subtext={pct(stats.verdict_counts.safe, stats.total_count)} />
              <MetricCard label="Caution" value={stats.verdict_counts.caution} icon={<AlertCircle className="w-5 h-5" />} colorClass="bg-yellow-50 text-yellow-700" subtext={pct(stats.verdict_counts.caution, stats.total_count)} />
              <MetricCard label="Block" value={stats.verdict_counts.hard_block} icon={<XCircle className="w-5 h-5" />} colorClass="bg-red-50 text-red-700" subtext={pct(stats.verdict_counts.hard_block, stats.total_count)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <VerdictRatioBar counts={stats.verdict_counts} total={stats.total_count} />
              <DailyUsageChart data={filteredDaily} dayFilter={dayFilter} onChangeFilter={setDayFilter} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 유틸리티 컴포넌트 ──────────────────────────────────────
function SystemStatusCard({ status }: { status: SystemStatus }) {
  const isBackendOk = status.backend === "ok" && status.cascade_loaded;
  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm h-full">
      <h2 className="text-sm font-bold text-gray-500 mb-6 flex items-center gap-2"><Activity className="w-4 h-4" /> Infrastructure Status</h2>
      <div className="space-y-3">
        <StatusItem label="Inference Engine" ok={isBackendOk} detail={isBackendOk ? "Active" : "Down"} />
        <StatusItem label="Storage Access" ok={status.storage === "ok"} detail={status.storage === "ok" ? "Connected" : "Error"} />
      </div>
    </div>
  );
}

function StatusItem({ label, ok, detail }: any) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100/50">
      <div className="text-xs font-bold text-gray-700 uppercase">{label}</div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-gray-400">{detail}</span>
        <div className={`w-2 h-2 rounded-full ${ok ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.3)]" : "bg-red-500"}`} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon, colorClass, subtext }: any) {
  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
      <div className="flex justify-between items-start mb-3">
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${colorClass}`}>{icon}</div>
      </div>
      <div className="text-2xl font-black text-gray-900">{value.toLocaleString()}</div>
      {subtext && <div className="text-[10px] text-gray-400 mt-1 font-bold italic">{subtext}</div>}
    </div>
  );
}

function VerdictRatioBar({ counts, total }: any) {
  if (total === 0) return null;
  const p = (v: number) => (v / total) * 100;
  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
      <h2 className="text-sm font-bold text-gray-500 mb-6">Real-time Verdict Ratio</h2>
      <div className="flex h-5 rounded-full overflow-hidden bg-gray-100">
        <div style={{ width: `${p(counts.safe)}%` }} className="bg-green-500" />
        <div style={{ width: `${p(counts.caution)}%` }} className="bg-yellow-500" />
        <div style={{ width: `${p(counts.hard_block)}%` }} className="bg-red-500" />
      </div>
      <div className="flex justify-between mt-4 text-[10px] font-black text-gray-400 tracking-widest uppercase">
        <span className="text-green-600">Safe</span>
        <span className="text-yellow-600">Caution</span>
        <span className="text-red-600">Block</span>
      </div>
    </div>
  );
}

function DailyUsageChart({ data, dayFilter, onChangeFilter }: any) {
  const maxCount = Math.max(...data.map((d: any) => d.count), 1);
  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-bold text-gray-500">Analysis Traffic</h2>
        <div className="flex gap-1 bg-gray-50 rounded-xl p-1">
          {[7, 30].map(d => (
            <button key={d} onClick={() => onChangeFilter(d)} className={`px-3 py-1 rounded-lg text-[10px] font-black ${dayFilter === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-400"}`}>{d}D</button>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-1 h-32">
        {data.map((d: any) => (
          <div key={d.date} className="flex-1 bg-gray-900 rounded-t-sm min-h-[1px]" style={{ height: `${(d.count / maxCount) * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

function pct(value: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function filterRecentDays(data: DailyUsage[], days: number): DailyUsage[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return data.filter(d => new Date(d.date) >= cutoff);
}
