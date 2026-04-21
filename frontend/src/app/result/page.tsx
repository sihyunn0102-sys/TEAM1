"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Info,
  ArrowLeft,
  ShieldCheck,
  Scale,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";

// --- 백엔드 연동용 유틸리티 ---
function toRiskLevel(verdict: string) {
  switch (verdict) {
    case "hard_block":
      return "High";
    case "caution":
      return "Medium";
    case "safe":
      return "Low";
    default:
      return "N/A";
  }
}

/**
 * ★ 핵심 변경 함수 ★
 * 원본에서는 violations 배열의 phrase만 매칭했는데,
 * violations가 비거나 매칭 실패 시 explanation에서 따옴표 키워드를 추출해 fallback으로 사용
 */
function buildOriginalChunks(copy: string, violations: any[], explanation: string) {
  if (!copy) return [];

  // 1단계: violations 배열에서 후보 구절 수집
  const candidates: { phrase: string; violation?: any }[] = [];
  for (const v of violations) {
    const phrase: string = (
      v.phrase ||
      v.violation_word ||
      v.keyword ||
      ""
    ).trim();
    if (phrase) candidates.push({ phrase, violation: v });
  }

  // 2단계: violations가 없거나 부족하면 explanation 에서 따옴표 안 키워드 추출
  // ex) "[L1] '보톡스', '14일 만에' 표현이 문제" → ['보톡스', '14일 만에']
  if (candidates.length === 0) {
    const quoted =
      explanation.match(/['''""]([^''""\n]{1,30})['''""]/g) || [];
    for (const q of quoted) {
      const phrase = q.replace(/^['''""]|['''"""]$/g, "").trim();
      if (phrase && copy.includes(phrase)) {
        candidates.push({
          phrase,
          violation: {
            explanation: `"${phrase}" 표현은 법적으로 금지된 표현입니다.`,
          },
        });
      }
    }
  }

  // 3단계: 후보가 여전히 없으면 전체 텍스트 단일 청크 반환
  if (candidates.length === 0) {
    return [{ text: copy, isError: false }];
  }

  // 4단계: 긴 구절 먼저 매칭 (짧은 구절이 긴 구절 안을 분리하지 않도록)
  const sorted = [...candidates].sort(
    (a, b) => b.phrase.length - a.phrase.length
  );

  let chunks: { text: string; isError: boolean; violation?: any }[] = [
    { text: copy, isError: false },
  ];

  for (const { phrase, violation } of sorted) {
    const next: { text: string; isError: boolean; violation?: any }[] = [];
    for (const chunk of chunks) {
      if (chunk.isError) {
        next.push(chunk);
        continue;
      }
      const idx = chunk.text.indexOf(phrase);
      if (idx === -1) {
        next.push(chunk);
        continue;
      }
      if (idx > 0)
        next.push({ text: chunk.text.slice(0, idx), isError: false });
      next.push({ text: phrase, isError: true, violation });
      if (idx + phrase.length < chunk.text.length)
        next.push({
          text: chunk.text.slice(idx + phrase.length),
          isError: false,
        });
    }
    chunks = next;
  }
  return chunks;
}

// After 카드: 안전 키워드 파란 볼드
function buildAfterChunks(afterText: string) {
  if (!afterText) return [{ text: afterText, isNew: false }];
  const safeKeywords = [
    "개선에 도움",
    "효과적으로 관리",
    "효과적",
    "관리",
    "개선",
    "완화",
    "도움",
    "케어",
    "촉촉",
    "진정",
    "촉촉한",
  ];
  let chunks: { text: string; isNew: boolean }[] = [
    { text: afterText, isNew: false },
  ];
  for (const kw of safeKeywords) {
    const next: { text: string; isNew: boolean }[] = [];
    for (const chunk of chunks) {
      if (chunk.isNew) {
        next.push(chunk);
        continue;
      }
      const idx = chunk.text.indexOf(kw);
      if (idx === -1) {
        next.push(chunk);
        continue;
      }
      if (idx > 0) next.push({ text: chunk.text.slice(0, idx), isNew: false });
      next.push({ text: kw, isNew: true });
      if (idx + kw.length < chunk.text.length)
        next.push({ text: chunk.text.slice(idx + kw.length), isNew: false });
    }
    chunks = next;
  }
  return chunks;
}

/**
 * explanation 텍스트를 구조화된 섹션으로 파싱
 * 반환: { l1Keywords, l3Phrases, reasoning }
 * - l1Keywords : "[L1] 키워드 매칭: 최초, 4주 만에" → ["최초", "4주 만에"]
 * - l3Phrases  : "[L3] 카피에서 'XXX', 'YYY'" → ["XXX", "YYY"]
 * - reasoning  : 판단 근거 문장들 (나머지 부분)
 */
function parseExplanation(explanation: string): {
  l1Keywords: string[];
  l3Phrases: string[];
  reasoning: string;
} {
  const l1Keywords: string[] = [];
  const l3Phrases: string[] = [];
  let reasoning = "";

  if (!explanation) return { l1Keywords, l3Phrases, reasoning };

  // L1 키워드 추출: "[L1] 키워드 매칭: A, B, C" 패턴
  const l1Match = explanation.match(/\[L1\][^/\n]*키워드[^:：]*[:：]\s*([^/\[]+)/i);
  if (l1Match) {
    const raw = l1Match[1].trim();
    // 쉼표 구분 또는 따옴표 감싼 것 모두 추출
    const quoted = raw.match(/['''""]([^''""\n]{1,30})['''""]/g) || [];
    if (quoted.length > 0) {
      l1Keywords.push(...quoted.map((q) => q.replace(/^['''""]|['''"""]$/g, "").trim()));
    } else {
      // 따옴표 없으면 쉼표/공백으로 분리
      raw.split(/[,，]\s*/).forEach((k) => {
        const t = k.trim();
        if (t) l1Keywords.push(t);
      });
    }
  }

  // L3 문제 표현 추출: "[L3] 카피에서 'XXX', 'YYY' 등의 표현" 패턴
  const l3SectionMatch = explanation.match(/\[L3\]([^.。]+)/i);
  if (l3SectionMatch) {
    const l3Raw = l3SectionMatch[1];
    const quoted = l3Raw.match(/['''""]([^''""\n]{1,60})['''""]/g) || [];
    l3Phrases.push(
      ...quoted.map((q) => q.replace(/^['''""]|['''"""]$/g, "").trim()),
    );
  }

  // 판단 근거: [L1]/[L3] 태그 이후 나오는 일반 문장들
  // "등의 표현은 ~" 이후부터를 reasoning으로 사용
  const reasoningMatch = explanation.match(
    /등의\s*표현[은이]\s*([\s\S]+)$|[^\[\]]+(?:됩니다|합니다|있습니다)[^[]*$/,
  );
  if (reasoningMatch) {
    reasoning = reasoningMatch[0].replace(/^등의\s*표현[은이]\s*/, "").trim();
  } else {
    // fallback: [L1]/[L3] 태그 제거 후 남은 텍스트
    reasoning = explanation
      .replace(/\[L[0-9]\][^\n/]*/g, "")
      .replace(/\/\s*/g, "")
      .trim();
  }

  return { l1Keywords, l3Phrases, reasoning };
}

const STYLE_LABELS: Record<string, string> = {
  safe: "가장 안전 🟢",
  marketing: "자연스러움 🟡",
  functional: "마케팅 강조 🔵",
};

// ★ 원본 그대로 유지 (desc 필드 포함)
const analysisPhases = [
  {
    title: "L1",
    label: "Rule Engine",
    desc: "금지어 즉시 식별",
    detail: "블랙리스트 기반 점검",
  },
  {
    title: "L2",
    label: "Retriever",
    desc: "법적 근거 검색",
    detail: "화장품법 및 가이드라인 참조",
  },
  {
    title: "L3",
    label: "Judge",
    desc: "종합 판정",
    detail: "GPT-4o 엔진 기반 심층 분석",
  },
  {
    title: "L4",
    label: "Rewriter",
    desc: "수정 제안 생성",
    detail: "대안 카피 생성",
  },
  {
    title: "L5",
    label: "Re-Judge",
    desc: "최종 검증",
    detail: "수정안 교차 검증",
  },
];

const stepToIndex: Record<string, number> = {
  L1: 0,
  L2: 1,
  L3: 2,
  L4: 3,
  L5: 4,
};

export default function ResultPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [resultData, setResultData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [editedText, setEditedText] = useState("");
  // 수정1: 추천 문구 👍👎 피드백 상태 { [index]: "up" | "down" | null }
  const [feedbackMap, setFeedbackMap] = useState<Record<number, "up" | "down" | null>>({});
  // ★ 추가: violationMeta 상태 (Before/After 카드 하단 설명용)
  const [violationMeta, setViolationMeta] = useState<{
    legalBasis: string;
    safeKeywordsUsed: string[];
  }>({ legalBasis: "", safeKeywordsUsed: [] });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const text = sessionStorage.getItem("analyzeText");
    const productType =
      sessionStorage.getItem("analyzeProductType") || "general_cosmetic";

    if (!text) {
      try {
        const raw = localStorage.getItem("adguard_result");
        if (!raw) {
          setError("데이터가 없습니다. 분석을 먼저 진행해주세요.");
          setIsLoading(false);
          return;
        }
        processResult(JSON.parse(raw));
        setIsLoading(false);
      } catch {
        setError("데이터 로드 오류");
        setIsLoading(false);
      }
      return;
    }

    // 브라우저 고유 user_id (없으면 생성) ← 원본 유지
    let user_id = localStorage.getItem("adguard_user_id") || "";
    if (!user_id) {
      user_id = crypto.randomUUID();
      localStorage.setItem("adguard_user_id", user_id);
    }

    const params = new URLSearchParams({
      text,
      product_type: productType,
      user_id,
    });
    const es = new EventSource(`/api/analyze-stream?${params.toString()}`);
    esRef.current = es;

    es.addEventListener("progress", (e: any) => {
      const data = JSON.parse(e.data);
      const idx = stepToIndex[data.step];
      if (idx !== undefined) setLoadingStep(idx);
    });

    es.addEventListener("result", (e: any) => {
      const data = JSON.parse(e.data);
      localStorage.setItem("adguard_result", JSON.stringify(data));

      // 히스토리 누적 저장 ← 원본 유지
      try {
        const prev = JSON.parse(
          localStorage.getItem("adguard_history") || "[]",
        );
        const entry = {
          task_id: data.task_id || crypto.randomUUID(),
          verdict: data.final_verdict || "",
          risk_summary: data.explanation || "",
          timestamp: new Date().toISOString(),
          text_preview: (data.copy || data.ad_copy || "").slice(0, 200),
          verified_rewrites: data.verified_rewrites || [],
        };
        prev.unshift(entry);
        localStorage.setItem(
          "adguard_history",
          JSON.stringify(prev.slice(0, 100)),
        );
      } catch {}

      sessionStorage.removeItem("analyzeText");
      sessionStorage.removeItem("analyzeProductType");
      processResult(data);
      setIsLoading(false);
      es.close();
    });

    es.addEventListener("error", () => {
      setError("서버 연결에 실패했습니다. 배포 서버를 확인해주세요.");
      setIsLoading(false);
      es.close();
    });

    return () => es.close();
  }, []);

  function processResult(backend: any) {
    const copy = backend.copy ?? backend.ad_copy ?? backend.ad_text ?? "";
    const violations = backend.violations ?? [];
    const rewrites = backend.verified_rewrites ?? [];
    const explanation = backend.explanation ?? "";
    const riskLevel = toRiskLevel(backend.final_verdict);

    // ★ 변경: explanation을 3번째 인자로 전달해 fallback 하이라이트 활성화
    // ★ 수정사항1: 안전 단계(Low)면 청킹 자체를 빈 배열로 → Before 박스 비움
    const originalChunks =
      riskLevel === "Low"
        ? []
        : buildOriginalChunks(copy, violations, explanation);

    const safeRewrite =
      rewrites.find((r: any) => r.style === "safe") ?? rewrites[0];

    if (safeRewrite) setEditedText(safeRewrite.text ?? "");

    // 법적 근거 추출
    const legalBasis =
      violations[0]?.legal_basis ||
      violations[0]?.law ||
      backend.legal_basis ||
      "화장품법 제13조 위반";

    // 수정안에서 권장 키워드 감지
    const safeText = safeRewrite?.text ?? "";
    const candidates = [
      "개선에 도움", "효과적으로 관리", "관리", "완화", "도움", "촉촉", "케어",
    ];
    const safeKws = candidates.filter((kw) => safeText.includes(kw));

    // ★ 수정사항2: explanation에서 각 위반 구절별 설명 문장을 파싱해 매핑
    // explanation 예: "...'바르는 보톡스'는 금지된 표현... '14일 만에 피부가 부활합니다'라는 표현은..."
    // → { '바르는 보톡스': '바르는 보톡스'는 금지된 표현입니다...', '14일 만에...': '...' }
    const phraseToTooltip: Record<string, string> = {};
    if (riskLevel !== "Low") {
      // 따옴표로 감싼 구절을 기준으로 문장을 분리해 tooltip 매핑
      const sentences = explanation.split(/(?<=[。.！!?？])\s*|\n/);
      for (const sentence of sentences) {
        const matches = sentence.match(/['''""]([^''""\n]{1,40})['''""]/g) || [];
        for (const m of matches) {
          const phrase = m.replace(/^['''""]|['''"""]$/g, "").trim();
          if (phrase && copy.includes(phrase)) {
            // 해당 구절이 포함된 문장 전체를 tooltip으로 사용
            phraseToTooltip[phrase] = sentence.trim();
          }
        }
      }

      // violations 배열에도 tooltip 보강 (백엔드가 직접 준 경우 우선)
      for (const v of violations) {
        const phrase = (v.phrase || v.violation_word || v.keyword || "").trim();
        if (phrase && !phraseToTooltip[phrase] && v.explanation) {
          phraseToTooltip[phrase] = v.explanation;
        }
      }

      // originalChunks의 violation.explanation을 phraseToTooltip으로 보강
      for (const chunk of originalChunks) {
        if (chunk.isError && chunk.violation) {
          const tooltipText = phraseToTooltip[chunk.text];
          if (tooltipText) {
            chunk.violation.explanation = tooltipText;
          }
        }
      }
    }

    setViolationMeta({
      legalBasis: `과대광고: 의학적 효능 표방 및 절대적 표현 사용 금지 (${legalBasis})`,
      safeKeywordsUsed:
        safeKws.length > 0 ? safeKws : ["개선에 도움", "관리", "완화"],
    });

    setResultData({
      riskLevel,
      explanation,
      spellCheck: { original: originalChunks },
      violations,
      // ★ 원본 유지: suggestions 매핑
      suggestions: rewrites.map((r: any, i: number) => ({
        id: i + 1,
        text: r.text,
        tag: STYLE_LABELS[r.style] ?? r.style,
      })),
    });
  }

  // ★ 원본 유지: PDF 다운로드
  const handleDownloadPDF = async () => {
    const backendUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8080";
    try {
      const raw = localStorage.getItem("adguard_result");
      const body = raw ? JSON.parse(raw) : {};
      const res = await fetch(`${backendUrl}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `adguard_report.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      alert("다운로드 오류");
    }
  };

  // ── 로딩 화면 (원본 완전 유지) ──────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col items-center min-h-screen bg-white font-sans overflow-hidden pt-20 pb-10">
        <div className="relative w-64 h-64 flex items-center justify-center mb-16">
          <div className="absolute w-full h-full bg-blue-400/15 blur-[80px] animate-pulse"></div>
          <div className="relative w-44 h-44 bg-gradient-to-tr from-blue-700 via-cyan-500 to-indigo-600 rounded-full animate-sphere-morph shadow-[inset_0_0_30px_rgba(255,255,255,0.3)]"></div>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[10px] font-black tracking-[0.4em] text-white/90 uppercase mb-2">
              Processing
            </span>
            <span className="text-xl font-black text-white">분석 중...</span>
          </div>
        </div>
        <div className="w-full max-w-6xl px-10">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
              AI 광고 컴플라이언스 엔진 가동 중
            </h2>
            <p className="text-gray-500 mt-2 text-sm">
              현재 단계: {analysisPhases[loadingStep].title} -{" "}
              {analysisPhases[loadingStep].label}
            </p>
          </div>
          <div className="flex flex-row justify-center items-stretch gap-4">
            {analysisPhases.map((phase, index) => (
              <div
                key={index}
                className={`flex-1 transition-all duration-700 p-6 rounded-[32px] border flex flex-col items-center text-center ${
                  loadingStep === index
                    ? "bg-blue-600 border-blue-400 scale-105 shadow-xl text-white"
                    : loadingStep > index
                      ? "bg-blue-50 border-blue-100 opacity-60"
                      : "bg-gray-50 border-gray-100 opacity-30"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-black mb-4 ${
                    loadingStep === index
                      ? "bg-white text-blue-600"
                      : "bg-blue-100 text-blue-600"
                  }`}
                >
                  {loadingStep > index ? "✓" : index + 1}
                </div>
                <h4 className="font-bold text-xs mb-1">
                  {phase.title} · {phase.label}
                </h4>
                {loadingStep === index && (
                  <p className="text-[10px] mt-2 bg-white/10 p-2 rounded-xl animate-fade-in">
                    {phase.detail}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
        <style
          dangerouslySetInnerHTML={{
            __html: `
            @keyframes sphereMorph {
              0%   { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(0deg) scale(1); }
              50%  { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; transform: rotate(180deg) scale(1.1); }
              100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(360deg) scale(1); }
            }
            .animate-sphere-morph { animation: sphereMorph 8s ease-in-out infinite; }
            .animate-fade-in { animation: fadeIn 0.5s ease-out forwards; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
          `,
          }}
        />
      </div>
    );
  }

  if (error || !resultData)
    return (
      <div className="p-20 text-center text-red-500 font-bold">
        {error || "결과 오류"}
      </div>
    );

  const riskBadgeMap: any = {
    High: { bg: "bg-red-50", text: "text-red-600", label: "위험 단계" },
    Medium: {
      bg: "bg-yellow-50",
      text: "text-yellow-600",
      label: "주의 단계",
    },
    Low: { bg: "bg-green-50", text: "text-green-600", label: "안전 단계" },
  };
  const riskBadge = riskBadgeMap[resultData.riskLevel] || {
    bg: "bg-gray-50",
    text: "text-gray-500",
    label: "분석 불가",
  };

  const afterChunks = buildAfterChunks(editedText);

  // ── 결과 화면 ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-6">
      <main className="w-full max-w-5xl bg-white rounded-[40px] shadow-sm border border-gray-100 p-8 md:p-14 relative overflow-hidden">

        {/* 헤더 - 원본 유지 */}
        <div className="flex justify-between items-end mb-10 mt-6">
          <div>
            <span className="text-blue-600 font-bold text-xs tracking-widest uppercase mb-2 block">
              Analysis Report
            </span>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
              분석 결과 리포트
            </h1>
          </div>
          <div
            className={`${riskBadge.bg} ${riskBadge.text} px-5 py-2 rounded-full font-bold border flex items-center gap-2`}
          >
            <CheckCircle2 size={16} /> {riskBadge.label}
          </div>
        </div>

        {/* ★ 설명 박스 - 구조화된 UI로 개편 */}
        {(() => {
          const { l1Keywords, l3Phrases, reasoning } = parseExplanation(
            resultData.explanation,
          );
          const hasStructured = l1Keywords.length > 0 || l3Phrases.length > 0;

          // 파싱 실패 시 기존 plain text fallback
          if (!hasStructured) {
            return (
              <div className="mb-10 p-6 bg-blue-50/30 rounded-3xl border flex gap-3 text-left">
                <Info size={18} className="text-blue-500 shrink-0 mt-1" />
                <p className="text-sm text-gray-700 leading-relaxed">
                  {resultData.explanation}
                </p>
              </div>
            );
          }

          return (
            <div className="mb-10 rounded-3xl border border-blue-100 bg-blue-50/20 overflow-hidden text-left">
              {/* L1 행 */}
              {l1Keywords.length > 0 && (
                <div className="flex items-start gap-3 px-6 py-4 border-b border-blue-100">
                  {/* 레이블 */}
                  <span className="shrink-0 mt-0.5 bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded tracking-wide">
                    Rule Engine
                  </span>
                  <span className="shrink-0 mt-0.5 text-[10px] font-bold text-blue-500 bg-blue-100 px-2 py-0.5 rounded">
                    L1
                  </span>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                      키워드 매칭
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {l1Keywords.map((kw, i) => (
                        <span
                          key={i}
                          className="bg-orange-100 text-orange-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-orange-200"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* L3 행 */}
              {l3Phrases.length > 0 && (
                <div className="flex items-start gap-3 px-6 py-4 border-b border-blue-100">
                  <span className="shrink-0 mt-0.5 bg-purple-600 text-white text-[10px] font-black px-2 py-0.5 rounded tracking-wide">
                    Judge
                  </span>
                  <span className="shrink-0 mt-0.5 text-[10px] font-bold text-purple-500 bg-purple-100 px-2 py-0.5 rounded">
                    L3
                  </span>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                      문제 표현
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {l3Phrases.map((ph, i) => (
                        <span
                          key={i}
                          className="bg-red-50 text-red-600 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-red-200"
                        >
                          '{ph}'
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 판단 근거 행 - 수정3: 개조식으로 표현 */}
              {reasoning && (
                <div className="flex items-start gap-3 px-6 py-4">
                  <Info size={15} className="text-blue-400 shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5 w-full">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      판단 근거
                    </span>
                    <ul className="space-y-1.5">
                      {reasoning
                        .split(/(?<=[。.！!?？])\s*/)
                        .map((s) => s.trim())
                        .filter((s) => s.length > 4)
                        .map((sentence, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                            <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
                            {sentence}
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Before / After 2열 카드 ★ 디자인 변경 구간 ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12 text-left items-stretch">

          {/* BEFORE 카드 */}
          <div className="relative bg-red-50 rounded-3xl p-7 border border-red-100 flex flex-col">
            {/* 우상단 뱃지 */}
            <span className="absolute top-5 right-5 bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
              수정 전 (위반 사례)
            </span>

            {/* 헤더 */}
            <div className="flex items-center gap-2 mb-5 mt-1">
              <AlertCircle size={17} className="text-red-500 shrink-0" />
              <h3 className="text-base font-extrabold text-red-600">
                위반 의심 문구
              </h3>
            </div>

            {/* 텍스트 박스 */}
            <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-red-100 flex-1">
              <p className="text-base leading-[2] italic">
                {/* ★ 수정사항1: 안전 단계면 박스 비움 */}
                {resultData.riskLevel === "Low" ? (
                  <span className="text-gray-300 not-italic text-sm">
                    위반 문구가 발견되지 않았습니다.
                  </span>
                ) : resultData.spellCheck.original.length === 0 ? (
                  <span className="text-gray-300">원본 텍스트 없음</span>
                ) : (
                  resultData.spellCheck.original.map(
                    (chunk: any, i: number) =>
                      chunk.isError ? (
                        // 수정2: 커서 기능(hover tooltip) 제거 - 하이라이트만 유지
                        <span key={i} className="inline-block">
                          <span className="bg-red-100 text-red-600 font-extrabold not-italic px-1 py-0.5 rounded border-b-[3px] border-red-500 underline decoration-red-400 decoration-wavy underline-offset-2">
                            {chunk.text}
                          </span>
                        </span>
                      ) : (
                        // 일반 텍스트: 흐리게
                        <span key={i} className="text-slate-400">
                          {chunk.text}
                        </span>
                      ),
                  )
                )}
              </p>
            </div>

            {/* ★ 수정사항1: 안전 단계면 하단 텍스트 숨김 */}
            {resultData.riskLevel !== "Low" && (
              <p className="mt-4 text-xs text-red-500 font-medium leading-relaxed">
                * {violationMeta.legalBasis}
              </p>
            )}
          </div>

          {/* AFTER 카드 */}
          <div className="relative bg-blue-50 rounded-3xl p-7 border border-blue-100 flex flex-col">
            {/* 우상단 뱃지 */}
            <span className="absolute top-5 right-5 bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
              광고청정기 제안
            </span>

            {/* 헤더 */}
            <div className="flex items-center gap-2 mb-5 mt-1">
              <CheckCircle2 size={17} className="text-blue-500 shrink-0" />
              <h3 className="text-base font-extrabold text-blue-600">
                안전한 수정안
              </h3>
            </div>

            {/* 텍스트 박스 */}
            <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-blue-100 flex-1">
              <p className="text-base leading-[2] italic">
                {afterChunks.map((chunk, i) =>
                  chunk.isNew ? (
                    <span
                      key={i}
                      className="text-blue-600 font-extrabold not-italic"
                    >
                      {chunk.text}
                    </span>
                  ) : (
                    <span key={i} className="text-slate-400">
                      {chunk.text}
                    </span>
                  ),
                )}
              </p>
            </div>

            {/* ★ 수정사항1: 안전 단계면 안전 메시지, 위험/주의면 기존 권장 표현 */}
            {resultData.riskLevel === "Low" ? (
              <p className="mt-4 text-xs text-green-600 font-medium leading-relaxed flex items-center gap-1">
                <CheckCircle2 size={12} className="shrink-0" />
                금지 조항이나 유사 사례가 발견되지 않았습니다.
              </p>
            ) : (
              <p className="mt-4 text-xs text-blue-500 font-medium leading-relaxed">
                ✓ 권장 표현:{" "}
                {violationMeta.safeKeywordsUsed.join(", ")} 등의 표현 사용
              </p>
            )}
          </div>
        </div>

        {/* 다른 AI 수정 제안 - 원본 유지 + 수정1: 👍👎 피드백 추가 */}
        {resultData.suggestions.length > 0 && (
          <div className="mb-12 text-left">
            <h3 className="font-bold text-zinc-800 mb-6 flex items-center gap-2">
              ✨ 다른 AI 교정 제안 둘러보기{" "}
              <span className="text-sm font-normal text-zinc-400">
                (클릭 시 복사 및 적용)
              </span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {resultData.suggestions.map((item: any, index: number) => (
                <div
                  key={item.id}
                  onClick={() => {
                    navigator.clipboard.writeText(item.text);
                    setEditedText(item.text);
                  }}
                  className="p-6 bg-white border rounded-[28px] hover:border-blue-200 hover:shadow-lg transition-all cursor-pointer flex flex-col justify-between h-full group"
                >
                  <span className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-md w-fit">
                    {item.tag} 추천 문구 {index + 1}
                  </span>
                  <p className="mt-4 text-zinc-700 font-medium leading-relaxed group-hover:text-blue-700">
                    {item.text}
                  </p>
                  {/* 수정1: 피드백 버튼 👍👎 */}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                    <span className="text-[11px] text-gray-400">이 문구가 도움이 됐나요?</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFeedbackMap((prev) => ({
                            ...prev,
                            [index]: prev[index] === "up" ? null : "up",
                          }));
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-all ${
                          feedbackMap[index] === "up"
                            ? "bg-blue-500 text-white border-blue-500"
                            : "bg-white text-gray-400 border-gray-200 hover:border-blue-300 hover:text-blue-500"
                        }`}
                      >
                        👍
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFeedbackMap((prev) => ({
                            ...prev,
                            [index]: prev[index] === "down" ? null : "down",
                          }));
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-all ${
                          feedbackMap[index] === "down"
                            ? "bg-red-400 text-white border-red-400"
                            : "bg-white text-gray-400 border-gray-200 hover:border-red-300 hover:text-red-400"
                        }`}
                      >
                        👎
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 하단 버튼 - 원본 유지 */}
        <footer className="flex flex-col md:flex-row gap-4">
          <Link
            href="/upload"
            className="flex-1 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-bold gap-2 hover:bg-blue-700 transition-all"
          >
            <ArrowLeft size={18} /> 새 이미지 검사
          </Link>
          <button
            onClick={handleDownloadPDF}
            className="px-10 h-14 border rounded-2xl flex items-center justify-center font-bold gap-2 hover:bg-gray-50 text-gray-600 transition-all"
          >
            <Scale size={18} /> 결과 보고서 저장 (PDF)
          </button>
        </footer>

        {/* 수정4: Microsoft AI School 광고 배너 */}
        <div className="mt-10 rounded-2xl overflow-hidden border border-blue-100 bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 p-px">
          <div className="bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 rounded-2xl px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-white text-xl">🎓</span>
              <div>
                <p className="text-white font-black text-sm tracking-tight">
                  MICROSOFT AI SCHOOL 11기 모집
                </p>
                <p className="text-blue-100 text-xs mt-0.5">
                  Azure 기반 AI 엔지니어 육성 커리큘럼
                </p>
              </div>
            </div>
            <span className="shrink-0 bg-white text-blue-600 text-xs font-black px-4 py-2 rounded-full shadow">
              자세히 보기 →
            </span>
          </div>
        </div>

        {/* 수정5: 책임 면책 문구 */}
        <p className="mt-5 text-center text-[11px] text-gray-400 leading-relaxed">
          본 서비스의 분석 결과는 AI 기반 참고용 정보이며, 법적 효력을 갖지 않습니다.
          실제 광고 집행 전 반드시 전문가 또는 관련 기관의 검토를 받으시기 바랍니다.
          광고청정기는 분석 결과로 인한 법적 책임을 지지 않습니다.
        </p>
      </main>
    </div>
  );
}
