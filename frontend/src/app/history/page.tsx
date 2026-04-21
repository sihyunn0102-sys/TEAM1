"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";

interface RewriteSuggestion {
  style: string;
  text: string;
  verdict?: string;
}

interface HistoryItem {
  task_id: string;
  verdict: string;
  risk_summary: string;
  timestamp: string;
  text_preview: string;
  verified_rewrites: RewriteSuggestion[];
}

const VERDICT_MAP: Record<string, { label: string; color: string }> = {
  hard_block: { label: "위험", color: "bg-red-100 text-red-600" },
  caution: { label: "주의", color: "bg-yellow-100 text-yellow-600" },
  safe: { label: "안전", color: "bg-green-100 text-green-600" },
  out_of_scope: { label: "범위 외", color: "bg-gray-100 text-gray-500" },
};

const STYLE_LABELS: Record<string, string> = {
  safe: "가장 안전 🟢",
  marketing: "자연스러움 🟡",
  functional: "마케팅 강조 🔵",
};

function formatDate(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adguard_history");
      setItems(raw ? JSON.parse(raw) : []);
    } catch {
      setItems([]);
    }
  }, []);

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const clearHistory = () => {
    if (confirm("검사 이력을 모두 삭제할까요?")) {
      localStorage.removeItem("adguard_history");
      setItems([]);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-50 px-6 py-12">
      <main className="w-full max-w-2xl">
        <div className="flex items-end justify-between mb-2">
          <h1 className="text-2xl font-extrabold text-gray-900">검사 이력</h1>
          {items.length > 0 && (
            <button
              onClick={clearHistory}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              전체 삭제
            </button>
          )}
        </div>
        <p className="text-sm text-gray-400 mb-8">이 브라우저에서 검사한 내역입니다.</p>

        {items.length === 0 && (
          <div className="text-center text-gray-400 py-20">
            <p className="text-4xl mb-4">📭</p>
            <p>검사 이력이 없습니다.</p>
            <Link
              href="/upload"
              className="mt-4 inline-block text-blue-500 hover:underline text-sm"
            >
              첫 번째 광고 검사하기 →
            </Link>
          </div>
        )}

        <div className="space-y-4">
          {items.map((item) => {
            const badge = VERDICT_MAP[item.verdict] ?? {
              label: item.verdict || "알 수 없음",
              color: "bg-gray-100 text-gray-500",
            };
            const isOpen = expanded[item.task_id];

            return (
              <div
                key={item.task_id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
              >
                {/* 헤더 행 */}
                <button
                  type="button"
                  onClick={() => toggle(item.task_id)}
                  className="w-full flex items-start gap-4 p-5 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 mb-1">
                      {formatDate(item.timestamp)}
                    </p>
                    <p className="text-sm font-medium text-gray-800 leading-snug line-clamp-2">
                      {item.text_preview || "(텍스트 없음)"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 mt-0.5">
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-full ${badge.color}`}
                    >
                      {badge.label}
                    </span>
                    {isOpen ? (
                      <ChevronUp size={16} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-400" />
                    )}
                  </div>
                </button>

                {/* 상세 영역 */}
                {isOpen && (
                  <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                    {/* 판정 요약 */}
                    {item.risk_summary && (
                      <div className="bg-blue-50/40 rounded-xl p-4">
                        <p className="text-xs font-bold text-blue-600 mb-1">판정 요약</p>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {item.risk_summary}
                        </p>
                      </div>
                    )}

                    {/* 개선안 */}
                    {item.verified_rewrites && item.verified_rewrites.length > 0 ? (
                      <div>
                        <p className="text-xs font-bold text-gray-500 mb-2">AI 개선안</p>
                        <div className="space-y-2">
                          {item.verified_rewrites.map((r, i) => (
                            <div
                              key={i}
                              className="bg-gray-50 rounded-xl p-3 border border-gray-100"
                            >
                              <span className="text-[11px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-md">
                                {STYLE_LABELS[r.style] ?? r.style}
                              </span>
                              <p className="mt-2 text-sm text-gray-700 leading-relaxed">
                                {r.text}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      item.verdict === "safe" && (
                        <p className="text-sm text-green-600 font-medium">
                          위반 사항이 없어 개선안이 없습니다.
                        </p>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Link
          href="/"
          className="mt-10 block text-center text-sm text-gray-400 hover:text-gray-700 transition-colors"
        >
          ← 메인으로 돌아가기
        </Link>
      </main>
    </div>
  );
}
