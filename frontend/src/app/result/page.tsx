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

function buildOriginalChunks(copy: string, violations: any[], explanation: string) {
  if (!copy) return [];

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

  if (candidates.length === 0) {
    return [{ text: copy, isError: false }];
  }

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

function parseExplanation(explanation: string): {
  l1Keywords: string[];
  l3Phrases: string[];
  reasoning: string;
} {
  const l1Keywords: string[] = [];
  const l3Phrases: string[] = [];
  let reasoning = "";

  if (!explanation) return { l1Keywords, l3Phrases, reasoning };

  const l1Match = explanation.match(/\[L1\][^/\n]*키워드[^:：]*[:：]\s*([^/\[]+)/i);
  if (l1Match) {
    const raw = l1Match[1].trim();
    const quoted = raw.match(/['''""]([^''""\n]{1,30})['''""]/g) || [];
    if (quoted.length > 0) {
      l1Keywords.push(...quoted.map((q) => q.replace(/^['''""]|['''"""]$/g, "").trim()));
    } else {
      raw.split(/[,，]\s*/).forEach((k) => {
        const t = k.trim();
        if (t) l1Keywords.push(t);
      });
    }
  }

  const l3SectionMatch = explanation.match(/\[L3\]([^.。]+)/i);
  if (l3SectionMatch) {
    const l3Raw = l3SectionMatch[1];
    const quoted = l3Raw.match(/['''""]([^''""\n]{1,60})['''""]/g) || [];
    l3Phrases.push(
      ...quoted.map((q) => q.replace(/^['''""]|['''"""]$/g, "").trim()),
    );
  }

  const reasoningMatch = explanation.match(
    /등의\s*표현[은이]\s*([\s\S]+)$|[^\[\]]+(?:됩니다|합니다|있습니다)[^[]*$/,
  );
  if (reasoningMatch) {
    reasoning = reasoningMatch[0].replace(/^등의\s*표현[은이]\s*/, "").trim();
  } else {
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
  const [feedbackMap, setFeedbackMap] = useState<Record<number, "up" | "down" | null>>({});
  const [violationMeta, setViolationMeta] = useState<{
    legalBasis: string;
    safeKeywordsUsed: string[];
  }>({ legalBasis: "", safeKeywordsUsed: [] });
  const esRef = useRef<EventSource | null>(null);
  const startTimeRef = useRef<number>(0);
  const [totalMs, setTotalMs] = useState<number | null>(null);

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
        const cached = JSON.parse(raw);
        if (cached._totalMs != null) setTotalMs(cached._totalMs);
        processResult(cached);
        setIsLoading(false);
      } catch {
        setError("데이터 로드 오류");
        setIsLoading(false);
      }
      return;
    }

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
    startTimeRef.current = Date.now();
    const es = new EventSource(`/api/analyze-stream?${params.toString()}`);
    esRef.current = es;

    es.addEventListener("progress", (e: any) => {
      const data = JSON.parse(e.data);
      const idx = stepToIndex[data.step];
      if (idx !== undefined) setLoadingStep(idx);
    });

    es.addEventListener("result", (e: any) => {
      const data = JSON.parse(e.data);
      const elapsed = Date.now() - startTimeRef.current;
      setTotalMs(elapsed);
      localStorage.setItem("adguard_result", JSON.stringify({ ...data, _totalMs: elapsed }));

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

    const originalChunks =
      riskLevel === "Low"
        ? []
        : buildOriginalChunks(copy, violations, explanation);

    const safeRewrite =
      rewrites.find((r: any) => r.style === "safe") ?? rewrites[0];

    if (safeRewrite) setEditedText(safeRewrite.text ?? "");

    const legalBasis =
      violations[0]?.legal_basis ||
      violations[0]?.law ||
      backend.legal_basis ||
      "화장품법 제13조 위반";

    const safeText = safeRewrite?.text ?? "";
    const candidates = [
      "개선에 도움", "효과적으로 관리", "관리", "완화", "도움", "촉촉", "케어",
    ];
    const safeKws = candidates.filter((kw) => safeText.includes(kw));

    const phraseToTooltip: Record<string, string> = {};
    if (riskLevel !== "Low") {
      const sentences = explanation.split(/(?<=[。.！!?？])\s*|\n/);
      for (const sentence of sentences) {
        const matches = sentence.match(/['''""]([^''""\n]{1,40})['''""]/g) || [];
        for (const m of matches) {
          const phrase = m.replace(/^['''""]|['''"""]$/g, "").trim();
          if (phrase && copy.includes(phrase)) {
            phraseToTooltip[phrase] = sentence.trim();
          }
        }
      }

      for (const v of violations) {
        const phrase = (v.phrase || v.violation_word || v.keyword || "").trim();
        if (phrase && !phraseToTooltip[phrase] && v.explanation) {
          phraseToTooltip[phrase] = v.explanation;
        }
      }

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
      suggestions: rewrites.map((r: any, i: number) => ({
        id: i + 1,
        text: r.text,
        tag: STYLE_LABELS[r.style] ?? r.style,
      })),
    });
  }

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

  // ── 로딩 화면 ──────────────────────────────────────────────
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
    Medium: { bg: "bg-yellow-50", text: "text-yellow-600", label: "주의 단계" },
    Low: { bg: "bg-green-50", text: "text-green-600", label: "안전 단계" },
  };
  const riskBadge = riskBadgeMap[resultData.riskLevel] || {
    bg: "bg-gray-50",
    text: "text-gray-500",
    label: "분석 불가",
  };

  const afterChunks = buildAfterChunks(editedText);

  // ── 결과 화면 ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-6">
      <main className="w-full max-w-5xl bg-white rounded-[40px] shadow-sm border border-gray-100 p-8 md:p-14 relative overflow-hidden">

        {/* 헤더 */}
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

        {/* 총 분석 시간 */}
        {totalMs != null && (
          <div className="inline-flex items-center gap-2 mb-10 px-4 py-2 bg-blue-50 border border-blue-100 rounded-full">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-xs font-bold text-blue-500 uppercase tracking-widest">총 분석 시간</span>
            <span className="text-sm font-black text-blue-700 tabular-nums">
              {totalMs >= 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`}
            </span>
            <span className="text-xs text-blue-400">· L1 → L5</span>
          </div>
        )}

        {/* 설명 박스 */}
        {(() => {
          const { l1Keywords, l3Phrases, reasoning } = parseExplanation(
            resultData.explanation,
          );
          const hasStructured = l1Keywords.length > 0 || l3Phrases.length > 0;

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
              {l1Keywords.length > 0 && (
                <div className="flex items-start gap-3 px-6 py-4 border-b border-blue-100">
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

        {/* Before / After */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12 text-left items-stretch">
          <div className="relative bg-red-50 rounded-3xl p-7 border border-red-100 flex flex-col">
            <span className="absolute top-5 right-5 bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
              수정 전 (위반 사례)
            </span>
            <div className="flex items-center gap-2 mb-5 mt-1">
              <AlertCircle size={17} className="text-red-500 shrink-0" />
              <h3 className="text-base font-extrabold text-red-600">
                위반 의심 문구
              </h3>
            </div>
            <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-red-100 flex-1">
              <p className="text-base leading-[2] italic">
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
                        <span key={i} className="inline-block">
                          <span className="bg-red-100 text-red-600 font-extrabold not-italic px-1 py-0.5 rounded border-b-[3px] border-red-500 underline decoration-red-400 decoration-wavy underline-offset-2">
                            {chunk.text}
                          </span>
                        </span>
                      ) : (
                        <span key={i} className="text-slate-400">
                          {chunk.text}
                        </span>
                      ),
                  )
                )}
              </p>
            </div>
            {resultData.riskLevel !== "Low" && (
              <p className="mt-4 text-xs text-red-500 font-medium leading-relaxed">
                * {violationMeta.legalBasis}
              </p>
            )}
          </div>

          <div className="relative bg-blue-50 rounded-3xl p-7 border border-blue-100 flex flex-col">
            <span className="absolute top-5 right-5 bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
              광고청정기 제안
            </span>
            <div className="flex items-center gap-2 mb-5 mt-1">
              <CheckCircle2 size={17} className="text-blue-500 shrink-0" />
              <h3 className="text-base font-extrabold text-blue-600">
                안전한 수정안
              </h3>
            </div>
            <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-blue-100 flex-1">
              <p className="text-base leading-[2] italic">
                {afterChunks.map((chunk, i) =>
                  chunk.isNew ? (
                    <span key={i} className="text-blue-600 font-extrabold not-italic">
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

        {/* AI 수정 제안 */}
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

        {/* 하단 버튼 */}
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

        {/* Microsoft AI School 배너 */}
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

        {/* 면책 문구 */}
        <p className="mt-5 text-center text-[11px] text-gray-400 leading-relaxed">
          본 서비스의 분석 결과는 AI 기반 참고용 정보이며, 법적 효력을 갖지 않습니다.
          실제 광고 집행 전 반드시 전문가 또는 관련 기관의 검토를 받으시기 바랍니다.
          광고청정기는 분석 결과로 인한 법적 책임을 지지 않습니다.
        </p>
      </main>
    </div>
  );
}
