"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { 
  Shield, Lock, CheckCircle2, XCircle, 
  AlertCircle, BarChart3, Activity, Calendar, 
  DollarSign, Clock, Zap, X, ChevronRight 
} from "lucide-react";

// (타입 정의는 기존과 동일하여 생략 가능하지만 구조 유지를 위해 포함)
interface StatsData {
  system_status: any;
  total_count: number;
  verdict_counts: any;
  daily_usage: { date: string; count: number }[];
  latency_avg?: any;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://your-azure-url.azurewebsites.net";

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  // ... (Login 처리부 기존 코드와 동일)

  if (!authenticated) {
    return <LoginForm onLogin={/*...*/} />; // 기존 로그인 폼
  }

  return <Dashboard password={password} onLogout={() => setAuthenticated(false)} />;
}

function Dashboard({ password, onLogout }: any) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState<7 | 30>(7);
  const [localTotalMs, setLocalTotalMs] = useState<number | null>(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND_URL}/admin/stats`, {
        headers: { "X-Admin-Password": password },
        cache: "no-store",
      });
      if (res.ok) setStats(await res.json());
    } catch (e) { console.error(e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { fetchStats(); }, []);

  // [수정 포인트] 일일 사용량 필터링 로직 보정 (오늘 데이터 포함)
  const filteredDaily = useMemo(() => {
    if (!stats?.daily_usage) return [];
    
    const now = new Date();
    // 시간을 00:00:00으로 맞춘 기준 날짜 생성
    const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayFilter);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    return stats.daily_usage
      .filter(d => d.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [stats?.daily_usage, dayFilter]);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* ... 헤더 생략 ... */}
      <div className="max-w-7xl mx-auto px-6 py-10">
        {loading ? (
          <div className="flex justify-center py-24"><Activity className="animate-spin" /></div>
        ) : (
          <div className="space-y-8">
            <EstimatedCostCard totalCount={stats?.total_count ?? 0} />
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <SystemStatusCard status={stats?.system_status} />
              <div className="lg:col-span-2">
                {/* [수정 포인트] latency_avg가 없을 경우 방어 코드 */}
                <LatencyMonitor 
                  latency={stats?.latency_avg || { L1:0, L2:0, L3:0, L4:0, L5:0 }} 
                  localTotalMs={localTotalMs} 
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
               {/* MetricCard들... */}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <VerdictRatioBar counts={stats?.verdict_counts} total={stats?.total_count} />
              <DailyUsageChart data={filteredDaily} dayFilter={dayFilter} onChangeFilter={setDayFilter} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ... (LatencyMonitor, DailyUsageChart 등 하단 컴포넌트들은 기존 디자인 코드 그대로 사용)
