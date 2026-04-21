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

// ─── 서브 컴포넌트: 레이어별 속도 모니터링 ──────────────────
interface HistoryEntry {
  task_id: string;
  verdict: string;
  timestamp: string;
  text_preview: string;
  _totalMs?: number;
}

function LatencyMonitor({ latency, localTotalMs }: { latency: LatencyStats; localTotalMs: number | null }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const backendTotal = useMemo(() => Object.values(latency).reduce((acc, curr) => acc + (curr || 0), 0), [latency]);
  const displayMs = backendTotal > 0 ? backendTotal * 1000 : (localTotalMs ?? 0);
  const displayStr = displayMs >= 1000 ? `${(displayMs / 1000).toFixed(1)}s` : `${displayMs}ms`;

  const handleOpen = () => {
    try {
      const raw = localStorage.getItem("adguard_history");
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
    setOpen(true);
  };

  const verdictLabel = (v: string) => {
    if (v === "hard_block") return { text: "위험", cls: "bg-red-100 text-red-600" };
    if (v === "caution") return { text: "주의", cls: "bg-yellow-100 text-yellow-600" };
    if (v === "safe") return { text: "안전", cls: "bg-green-100 text-green-600" };
    return { text: v || "—", cls: "bg-gray-100 text-gray-500" };
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={handleOpen}
        className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm flex flex-col h-full justify-center cursor-pointer hover:shadow-md hover:border-blue-100 transition-all group"
      >
        <div className="flex items-center justify-between text-sm font-bold text-gray-500 mb-6">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" /> 평균 분석 시간
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
        </div>
        <div className="flex items-end gap-2">
          <span className="text-5xl font-black text-blue-700 tabular-nums leading-none">{displayStr}</span>
          <span className="text-xs text-gray-400 mb-1">L1 → L5</span>
        </div>
        {localTotalMs != null && backendTotal === 0 && (
          <p className="text-[10px] text-gray-400 mt-3">최근 분석 기준 (로컬 캐시) · 클릭하면 히스토리</p>
        )}
      </motion.div>

      {/* 히스토리 모달 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-3xl border border-gray-100 shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" /> 분석 히스토리
              </h3>
              <button onClick={() => setOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {history.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-12">분석 히스토리가 없습니다</div>
              ) : (
                history.map((entry, i) => {
                  const v = verdictLabel(entry.verdict);
                  const timeStr = entry._totalMs != null
                    ? entry._totalMs >= 1000 ? `${(entry._totalMs / 1000).toFixed(1)}s` : `${entry._totalMs}ms`
                    : "—";
                  const date = new Date(entry.timestamp);
                  const dateStr = `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
                  return (
                    <div key={entry.task_id || i} className="flex items-center gap-3 p-4 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700 font-medium truncate">{entry.text_preview || "—"}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{dateStr}</p>
                      </div>
                      <span className={`text-[10px] font-black px-2 py-1 rounded-lg whitespace-nowrap ${v.cls}`}>{v.text}</span>
                      <span className="text-sm font-black text-blue-700 tabular-nums whitespace-nowrap w-14 text-right">{timeStr}</span>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}

// ─── 서브 컴포넌트: 비용 예측 카드 ──────────────────────────
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
          <p className="text-[11px] text-gray-400 mt-1">GPT-4o 토큰 사용량 기반 실시간 추정치</p>
        </div>
        <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-md uppercase tracking-widest">USD</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
        <div>
          <div className="text-4xl font-black text-gray-900 tracking-tighter">${estimatedTotal.toFixed(3)}</div>
          <div className="text-xs text-gray-400 mt-1 font-bold">누적 {totalCount.toLocaleString()}건 분석</div>
        </div>
        <div className="md:col-span-2">
          <div className="flex justify-between text-[10px] font-black mb-2 uppercase tracking-tight">
            <span className={usageRatio > 80 ? "text-red-500" : "text-gray-600"}>Budget Usage {usageRatio.toFixed(1)}%</span>
            <span className="text-gray-400 text-[9px]">Goal Limit: ${BUDGET_GOAL}</span>
          </div>
          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden p-0.5 border border-gray-50">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${usageRatio}%` }}
              className={`h-full rounded-full ${usageRatio > 80 ? "bg-red-500" : "bg-emerald-500"}`}
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
      // 백엔드 연결 불가 → 로컬 모드로 진입
      sessionStorage.setItem("adguard_admin_pw", "__local__");
      setPassword("__local__");
      setAuthenticated(true);
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
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md bg-white rounded-[40px] shadow-2xl p-12 border border-gray-100">
          <div className="flex flex-col items-center mb-10">
            <div className="w-20 h-20 bg-gray-900 rounded-[28px] flex items-center justify-center text-white mb-6 shadow-xl shadow-gray-200">
              <Shield className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">Admin Portal</h1>
            <p className="text-gray-400 text-sm mt-2 font-medium">인증을 위해 관리자 암호를 입력하세요.</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="relative">
              <Lock className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoFocus
                className="w-full pl-12 pr-5 py-4 rounded-2xl border border-gray-100 bg-gray-50 focus:bg-white focus:border-gray-900 outline-none transition-all font-mono"
              />
            </div>
            {loginError && <div className="text-xs text-red-500 text-center font-bold">{loginError}</div>}
            <button
              type="submit"
              disabled={loginLoading || !password}
              className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black hover:bg-black disabled:opacity-50 transition-all shadow-lg shadow-gray-200"
            >
              {loginLoading ? "Authenticating..." : "Login System"}
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
  const [localTotalMs, setLocalTotalMs] = useState<number | null>(null);

  // localStorage에서 최근 분석 시간 읽기
  useEffect(() => {
    try {
      const raw = localStorage.getItem("adguard_result");
      if (raw) {
        const data = JSON.parse(raw);
        if (data._totalMs != null) setLocalTotalMs(data._totalMs);
      }
    } catch {}
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND_URL}/admin/stats`, {
        headers: { "X-Admin-Password": password },
        cache: "no-store",
      });
      if (res.ok) setStats(await res.json());
    } catch (e) {
      console.error("데이터 통신 오류", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

  const filteredDaily = useMemo(() => {
    if (!stats?.daily_usage) return [];
    const now = new Date();
    const cutoff = new Date(now.setDate(now.getDate() - dayFilter)).toISOString().split('T')[0];
    return stats.daily_usage.filter(d => d.date >= cutoff).sort((a,b) => a.date.localeCompare(b.date));
  }, [stats?.daily_usage, dayFilter]);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white"><Shield className="w-5 h-5" /></div>
            <h1 className="text-xl font-black text-gray-900 tracking-tighter">ADGUARD <span className="text-gray-300 font-light">|</span> OPS</h1>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={fetchStats} className="text-[11px] px-4 py-2 bg-gray-900 text-white rounded-xl font-black shadow-sm">
              {loading ? "REFRESHING..." : "새로고침"}
            </button>
            <button onClick={onLogout} className="text-[11px] text-gray-400 font-black hover:text-red-500 transition-colors uppercase">Logout</button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Activity className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">데이터를 불러오는 중...</p>
          </div>
        ) : (
          <div className="space-y-8">
            <EstimatedCostCard totalCount={stats?.total_count ?? 0} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <SystemStatusCard status={stats?.system_status ?? { backend: "error", cascade_loaded: false, storage: "error" }} />
              <div className="lg:col-span-2">
                <LatencyMonitor
                  latency={stats?.latency_avg ?? { L1:0, L2:0, L3:0, L4:0, L5:0 }}
                  localTotalMs={localTotalMs}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <MetricCard label="Total Analyzed" value={stats?.total_count ?? 0} icon={<BarChart3 className="w-5 h-5" />} colorClass="bg-gray-900 text-white" />
              <MetricCard label="Safe" value={stats?.verdict_counts.safe ?? 0} icon={<CheckCircle2 className="w-5 h-5" />} colorClass="bg-green-100 text-green-700" subtext={stats ? pct(stats.verdict_counts.safe, stats.total_count) : undefined} />
              <MetricCard label="Caution" value={stats?.verdict_counts.caution ?? 0} icon={<AlertCircle className="w-5 h-5" />} colorClass="bg-yellow-100 text-yellow-700" subtext={stats ? pct(stats.verdict_counts.caution, stats.total_count) : undefined} />
              <MetricCard label="Block" value={stats?.verdict_counts.hard_block ?? 0} icon={<XCircle className="w-5 h-5" />} colorClass="bg-red-100 text-red-700" subtext={stats ? pct(stats.verdict_counts.hard_block, stats.total_count) : undefined} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <VerdictRatioBar counts={stats?.verdict_counts ?? { safe:0, caution:0, hard_block:0, other:0 }} total={stats?.total_count ?? 0} />
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
      <h2 className="text-sm font-bold text-gray-500 mb-8 flex items-center gap-2"><Activity className="w-4 h-4 text-blue-500" /> 인프라 가동 상태</h2>
      <div className="space-y-4">
        <StatusItem label="Inference Engine" ok={isBackendOk} detail={isBackendOk ? "ONLINE" : "OFFLINE"} />
        <StatusItem label="Azure Storage" ok={status.storage === "ok"} detail={status.storage === "ok" ? "STABLE" : "ERROR"} />
      </div>
    </div>
  );
}

function StatusItem({ label, ok, detail }: any) {
  return (
    <div className="flex items-center justify-between p-5 bg-gray-50/50 rounded-2xl border border-gray-100">
      <div className="text-[11px] font-black text-gray-700 uppercase tracking-tight">{label}</div>
      <div className="flex items-center gap-3">
        <span className={`text-[10px] font-black ${ok ? "text-green-600" : "text-red-500"}`}>{detail}</span>
        <div className={`w-2.5 h-2.5 rounded-full ${ok ? "bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.4)]" : "bg-red-500"}`} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon, colorClass, subtext }: any) {
  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{label}</span>
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm ${colorClass}`}>{icon}</div>
      </div>
      <div className="text-3xl font-black text-gray-900 tracking-tighter">{value.toLocaleString()}</div>
      {subtext && <div className="text-[10px] text-gray-400 mt-2 font-black italic">{subtext}</div>}
    </div>
  );
}

function VerdictRatioBar({ counts, total }: any) {
  const p = (v: number) => total > 0 ? (v / total) * 100 : 0;
  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm">
      <h2 className="text-sm font-bold text-gray-500 mb-8 uppercase tracking-widest">분석 결과 비율</h2>
      {total === 0 ? (
        <div className="flex h-12 rounded-2xl bg-gray-50 border border-gray-100 items-center justify-center">
          <span className="text-[11px] text-gray-300 font-bold">데이터 없음</span>
        </div>
      ) : (
        <div className="flex h-12 rounded-2xl overflow-hidden bg-gray-50 p-1.5 border border-gray-100">
          <motion.div initial={{ width: 0 }} animate={{ width: `${p(counts.safe)}%` }} className="bg-green-500 rounded-l-xl mr-0.5" />
          <motion.div initial={{ width: 0 }} animate={{ width: `${p(counts.caution)}%` }} className="bg-yellow-500 mr-0.5" />
          <motion.div initial={{ width: 0 }} animate={{ width: `${p(counts.hard_block)}%` }} className="bg-red-500 rounded-r-xl" />
        </div>
      )}
      <div className="grid grid-cols-3 mt-6 text-[10px] font-black text-center tracking-tighter uppercase">
        <div className="text-green-600">Safe ({p(counts.safe).toFixed(0)}%)</div>
        <div className="text-yellow-600">Caution ({p(counts.caution).toFixed(0)}%)</div>
        <div className="text-red-600">Block ({p(counts.hard_block).toFixed(0)}%)</div>
      </div>
    </div>
  );
}

function DailyUsageChart({ data, dayFilter, onChangeFilter }: any) {
  const maxCount = useMemo(() => Math.max(...data.map((d: any) => d.count), 1), [data]);

  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-10">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
           <Calendar className="w-4 h-4" /> 트래픽 모니터링
        </h2>
        <div className="flex gap-1 bg-gray-50 rounded-xl p-1 border border-gray-100">
          {[7, 30].map(d => (
            <button
              key={d}
              onClick={() => onChangeFilter(d)}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${dayFilter === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"}`}
            >
              {d === 7 ? "WEEKLY" : "MONTHLY"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-2 h-48 px-2 flex-1">
        {data.length > 0 ? data.map((d: any, idx: number) => (
          <div key={idx} className="group relative flex-1 flex flex-col items-center">
            <div className="absolute -top-6 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-black text-gray-900 bg-white border border-gray-100 px-1.5 py-0.5 rounded shadow-sm">
              {d.count}건
            </div>
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${(d.count / maxCount) * 100}%` }}
              transition={{ delay: idx * 0.02 }}
              className="w-full bg-gray-900 rounded-t-lg min-h-[4px] hover:bg-blue-600 transition-colors"
            />
            <span className="text-[8px] text-gray-300 font-bold mt-3 rotate-45 origin-left whitespace-nowrap">{d.date.slice(5)}</span>
          </div>
        )) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs font-bold">데이터가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

function pct(value: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}% OF TOTAL`;
}
