"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, Lock, CheckCircle2, XCircle, AlertCircle, BarChart3, Activity, Calendar } from "lucide-react";

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

interface StatsData {
  system_status: SystemStatus;
  total_count: number;
  verdict_counts: VerdictCounts;
  daily_usage: DailyUsage[];
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://9ai-2nd-team-app-service-b0h3evedgec0dtda.eastus-01.azurewebsites.net";

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // 세션 확인 (페이지 재진입 시 비밀번호 유지)
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
      // 비밀번호 검증은 stats 호출로 함께 처리
      const res = await fetch(`${BACKEND_URL}/admin/stats`, {
        headers: { "X-Admin-Password": password },
      });

      if (res.status === 401) {
        setLoginError("비밀번호가 올바르지 않습니다.");
        setLoginLoading(false);
        return;
      }

      if (!res.ok) {
        setLoginError(`서버 오류 (${res.status})`);
        setLoginLoading(false);
        return;
      }

      // 성공
      sessionStorage.setItem("adguard_admin_pw", password);
      setAuthenticated(true);
    } catch (err: any) {
      setLoginError(err?.message || "연결 오류");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("adguard_admin_pw");
    setPassword("");
    setAuthenticated(false);
  };

  // ─── 로그인 화면 ─────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-white px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10">
            <div className="flex flex-col items-center mb-8">
              <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center text-white mb-4">
                <Shield className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">관리자 인증</h1>
              <p className="text-sm text-gray-500">비밀번호를 입력하세요</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호"
                  autoFocus
                  className="w-full pl-11 pr-4 py-3 rounded-2xl border border-gray-200 focus:border-gray-900 focus:outline-none transition-colors"
                />
              </div>

              {loginError && (
                <div className="text-sm text-red-500 text-center">{loginError}</div>
              )}

              <button
                type="submit"
                disabled={loginLoading || !password}
                className="w-full py-3 bg-gray-900 text-white rounded-2xl font-medium hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loginLoading ? "확인 중..." : "로그인"}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link
                href="/"
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                ← 메인으로 돌아가기
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // ─── 대시보드 화면 ───────────────────────────────────
  return <Dashboard password={password} onLogout={handleLogout} />;
}

// ═══════════════════════════════════════════════════════
// 대시보드 컴포넌트
// ═══════════════════════════════════════════════════════

function Dashboard({
  password,
  onLogout,
}: {
  password: string;
  onLogout: () => void;
}) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<7 | 30>(7);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${BACKEND_URL}/admin/stats`, {
        headers: { "X-Admin-Password": password },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`서버 오류 (${res.status})`);
      }
      const data: StatsData = await res.json();
      setStats(data);
    } catch (e: any) {
      setError(e?.message || "데이터 조회 실패");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // 필터링된 일별 데이터 (7일 or 30일)
  const filteredDaily = stats?.daily_usage
    ? filterRecentDays(stats.daily_usage, dayFilter)
    : [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">관리자 대시보드</h1>
              <p className="text-xs text-gray-500">광고청정기 모니터링</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchStats}
              disabled={loading}
              className="text-sm px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              {loading ? "새로고침 중..." : "🔄 새로고침"}
            </button>
            <button
              onClick={onLogout}
              className="text-sm px-4 py-2 text-gray-500 hover:text-gray-900 transition-colors"
            >
              로그아웃
            </button>
            <Link
              href="/"
              className="text-sm px-4 py-2 text-gray-500 hover:text-gray-900 transition-colors"
            >
              메인 →
            </Link>
          </div>
        </div>
      </div>

      {/* 본문 */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {loading && !stats && (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Activity className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">데이터를 불러오는 중...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <AlertCircle className="w-6 h-6 text-red-500 mx-auto mb-2" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {stats && (
          <div className="space-y-8">
            {/* 시스템 상태 */}
            <SystemStatusCard status={stats.system_status} />

            {/* 핵심 숫자들 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <MetricCard
                label="총 분석 건수"
                value={stats.total_count}
                icon={<BarChart3 className="w-5 h-5" />}
                colorClass="bg-gray-900 text-white"
              />
              <MetricCard
                label="🟢 안전"
                value={stats.verdict_counts.safe}
                icon={<CheckCircle2 className="w-5 h-5" />}
                colorClass="bg-green-50 text-green-700"
                subtext={pct(stats.verdict_counts.safe, stats.total_count)}
              />
              <MetricCard
                label="🟡 주의"
                value={stats.verdict_counts.caution}
                icon={<AlertCircle className="w-5 h-5" />}
                colorClass="bg-yellow-50 text-yellow-700"
                subtext={pct(stats.verdict_counts.caution, stats.total_count)}
              />
              <MetricCard
                label="🔴 위험"
                value={stats.verdict_counts.hard_block}
                icon={<XCircle className="w-5 h-5" />}
                colorClass="bg-red-50 text-red-700"
                subtext={pct(stats.verdict_counts.hard_block, stats.total_count)}
              />
            </div>

            {/* 판정 비율 바 */}
            <VerdictRatioBar counts={stats.verdict_counts} total={stats.total_count} />

            {/* 일별 사용량 차트 */}
            <DailyUsageChart
              data={filteredDaily}
              dayFilter={dayFilter}
              onChangeFilter={setDayFilter}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 시스템 상태 카드
// ═══════════════════════════════════════════════════════

function SystemStatusCard({ status }: { status: SystemStatus }) {
  const isBackendOk = status.backend === "ok" && status.cascade_loaded;
  const isStorageOk = status.storage === "ok";

  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
      <h2 className="text-sm font-bold text-gray-500 mb-4 flex items-center gap-2">
        <Activity className="w-4 h-4" />
        시스템 상태
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatusItem
          label="백엔드 API"
          ok={isBackendOk}
          detail={
            isBackendOk
              ? "정상 작동"
              : status.cascade_loaded
              ? "Cascade 로드됨"
              : "Cascade 미로드"
          }
        />
        <StatusItem
          label="Table Storage"
          ok={isStorageOk}
          detail={
            status.storage === "ok"
              ? "정상 연결"
              : status.storage === "connection_error"
              ? "연결 실패"
              : status.storage === "query_error"
              ? "쿼리 실패"
              : "확인 불가"
          }
        />
      </div>
    </div>
  );
}

function StatusItem({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
      <div>
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{detail}</div>
      </div>
      <div
        className={`w-3 h-3 rounded-full ${
          ok ? "bg-green-500" : "bg-red-500"
        } ${ok ? "shadow-[0_0_8px_rgba(34,197,94,0.5)]" : ""}`}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 숫자 카드
// ═══════════════════════════════════════════════════════

function MetricCard({
  label,
  value,
  icon,
  colorClass,
  subtext,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
  subtext?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="text-xs font-medium text-gray-500">{label}</div>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${colorClass}`}>
          {icon}
        </div>
      </div>
      <div className="text-3xl font-bold text-gray-900">
        {value.toLocaleString()}
      </div>
      {subtext && (
        <div className="text-xs text-gray-400 mt-1">{subtext}</div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════
// 판정 비율 바
// ═══════════════════════════════════════════════════════

function VerdictRatioBar({
  counts,
  total,
}: {
  counts: VerdictCounts;
  total: number;
}) {
  if (total === 0) {
    return (
      <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
        <h2 className="text-sm font-bold text-gray-500 mb-4">판정 비율</h2>
        <div className="text-center text-gray-400 py-8 text-sm">
          데이터가 아직 없습니다
        </div>
      </div>
    );
  }

  const safePct = (counts.safe / total) * 100;
  const cautionPct = (counts.caution / total) * 100;
  const blockPct = (counts.hard_block / total) * 100;
  const otherPct = (counts.other / total) * 100;

  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
      <h2 className="text-sm font-bold text-gray-500 mb-4">판정 비율</h2>
      <div className="flex h-8 rounded-full overflow-hidden">
        <div
          style={{ width: `${safePct}%` }}
          className="bg-green-500 transition-all"
          title={`안전 ${counts.safe}건`}
        />
        <div
          style={{ width: `${cautionPct}%` }}
          className="bg-yellow-500 transition-all"
          title={`주의 ${counts.caution}건`}
        />
        <div
          style={{ width: `${blockPct}%` }}
          className="bg-red-500 transition-all"
          title={`위험 ${counts.hard_block}건`}
        />
        {otherPct > 0 && (
          <div
            style={{ width: `${otherPct}%` }}
            className="bg-gray-300 transition-all"
            title={`기타 ${counts.other}건`}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-4 mt-4 text-xs text-gray-500">
        <LegendDot color="bg-green-500" label={`안전 ${safePct.toFixed(1)}%`} />
        <LegendDot color="bg-yellow-500" label={`주의 ${cautionPct.toFixed(1)}%`} />
        <LegendDot color="bg-red-500" label={`위험 ${blockPct.toFixed(1)}%`} />
        {otherPct > 0 && (
          <LegendDot color="bg-gray-300" label={`기타 ${otherPct.toFixed(1)}%`} />
        )}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span>{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 일별 사용량 차트 (세로 막대)
// ═══════════════════════════════════════════════════════

function DailyUsageChart({
  data,
  dayFilter,
  onChangeFilter,
}: {
  data: DailyUsage[];
  dayFilter: 7 | 30;
  onChangeFilter: (d: 7 | 30) => void;
}) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-bold text-gray-500 flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          일별 분석 건수
        </h2>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => onChangeFilter(7)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              dayFilter === 7
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            최근 7일
          </button>
          <button
            onClick={() => onChangeFilter(30)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              dayFilter === 30
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            최근 30일
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">
          해당 기간 데이터가 없습니다
        </div>
      ) : (
        <>
          <div className="flex items-end gap-1 h-48 overflow-x-auto pb-2">
            {data.map((d) => {
              const heightPct = (d.count / maxCount) * 100;
              return (
                <div
                  key={d.date}
                  className="flex-1 min-w-[20px] flex flex-col items-center gap-2 group"
                >
                  <div className="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    {d.count}
                  </div>
                  <div
                    style={{ height: `${heightPct}%` }}
                    className="w-full bg-gradient-to-t from-gray-900 to-gray-600 rounded-t-lg hover:from-blue-700 hover:to-blue-500 transition-colors min-h-[2px]"
                    title={`${d.date}: ${d.count}건`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1 mt-2 text-[10px] text-gray-400">
            {data.map((d, i) => (
              <div key={d.date} className="flex-1 min-w-[20px] text-center truncate">
                {i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 6) === 0
                  ? formatDateShort(d.date)
                  : ""}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 유틸
// ═══════════════════════════════════════════════════════

function pct(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function filterRecentDays(data: DailyUsage[], days: number): DailyUsage[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // 최근 days일 범위만 필터
  return data.filter((d) => {
    const date = new Date(d.date);
    return date >= cutoff && date <= now;
  });
}

function formatDateShort(iso: string): string {
  // "2026-04-21" → "04/21"
  const parts = iso.split("-");
  if (parts.length >= 3) {
    return `${parts[1]}/${parts[2]}`;
  }
  return iso;
}
