"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Info,
  ThumbsUp,
  ThumbsDown,
  ArrowLeft,
  ShieldCheck,
  Scale,
} from "lucide-react";

// --- 백엔드 연동용 유틸리티 ---
function toRiskLevel(verdict: string) {
  switch (verdict) {
    case "hard_block": return "High";
    case "caution": return "Medium";
    case "safe": return "Low";
    default: return "N/A";
  }
}

function buildOriginalChunks(copy: string, violations: any[]) {
  let chunks: { text: string; isError: boolean }[] = [{ text: copy, isError: false }];
  for (const v of violations) {
    const phrase: string = v.phrase;
    if (!phrase) continue;
    const next: { text: string; isError: boolean }[] = [];
    for (const chunk of chunks) {
      if (chunk.isError) { next.push(chunk); continue; }
      const idx = chunk.text.indexOf(phrase);
      if (idx === -1) { next.push(chunk); continue; }
      if (idx > 0) next.push({ text: chunk.text.slice(0, idx), isError: false });
      next.push({ text: phrase, isError: true });
      if (idx + phrase.length < chunk.text.length)
        next.push({ text: chunk.text.slice(idx + phrase.length), isError: false });
    }
    chunks = next;
  }
  return chunks;
}

const STYLE_LABELS: Record<string, string> = {
  safe: "가장 안전 🟢",
  marketing: "자연스러움 🟡",
  functional: "마케팅 강조 🔵",
};

// 분석 단계 정의 (UI용) - 기존 디자인 유지
const analysisPhases = [
  { title: "L1", label: "Rule Engine", desc: "금지어 즉시 식별", detail: "블랙리스트 기반<br />시술/의약품 오인 용어 체크" },
  { title: "L2", label: "Retriever", desc: "법적 근거 검색", detail: "화장품법 제13조 및<br />식약처 가이드라인 참조" },
  { title: "L3", label: "Judge", desc: "AI 종합 판정", detail: "GPT-4o 기반 위반 사항<br />및 위험도 등급 확정" },
  { title: "L4", label: "Rewriter", desc: "수정 제안 생성", detail: "안전성/마케팅 톤을 고려한<br />대안 문구 작성" },
  { title: "L5", label: "Re-Judge", desc: "최종 검증", detail: "수정안에 대한<br />2차 교차 검증 수행" },
];

// SSE step 이름 → phase index 매핑
const stepToIndex: Record<string, number> = {
  L1: 0, L2: 1, L3: 2, L4: 3, L5: 4,
};

export default function ResultPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [resultData, setResultData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const text = sessionStorage.getItem("analyzeText");
    const productType = sessionStorage.getItem("analyzeProductType") || "general_cosmetic";

    // sessionStorage에 데이터 없으면 에러 (upload 페이지에서 시작해야 함)
    if (!text) {
      setError("분석 결과가 없습니다. 광고 분석을 먼저 진행해주세요.");
      setIsLoading(false);
      return;
    }

    // SSE 연결
    const params = new URLSearchParams({ text, product_type: productType });
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
      sessionStorage.removeItem("analyzeText");
      sessionStorage.removeItem("analyzeProductType");
      processResult(data);
      setIsLoading(false);
      es.close();
    });

    es.addEventListener("error", (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setError(data.message || "분석 중 오류가 발생했습니다.");
      } catch {
        setError("서버 연결에 실패했습니다.");
      }
      setIsLoading(false);
      es.close();
    });

    es.onerror = () => {
      setError("서버 연결이 끊어졌습니다. 다시 시도해주세요.");
      setIsLoading(false);
      es.close();
    };

    return () => { es.close(); };
  }, []);

  function processResult(backend: any) {
    const copy: string = backend.copy ?? backend.ad_copy ?? "";
    const violations: any[] = backend.violations ?? [];
    const rewrites: any[] = backend.verified_rewrites ?? [];

    const originalChunks = buildOriginalChunks(copy, violations);
    const safeRewrite = rewrites.find((r) => r.style === "safe") ?? rewrites[0];
    const correctedChunks = safeRewrite
      ? [{ text: safeRewrite.text, isFix: true }]
      : [{ text: "수정안 없음", isFix: false }];

    const suggestions = rewrites.map((r, i) => ({
      id: i + 1,
      text: r.text,
      tag: STYLE_LABELS[r.style] ?? r.style,
    }));

    setResultData({
      riskLevel: toRiskLevel(backend.final_verdict),
      explanation: backend.explanation ?? "",
      spellCheck: { original: originalChunks, corrected: correctedChunks },
      suggestions,
      resultId: backend.task_id || backend.result_id || "demo",
    });
  }

const handleDownloadPDF = async () => {
    try {
      const raw = localStorage.getItem("adguard_result");
      const body = raw ? JSON.parse(raw) : {};
      // Next.js API 라우트를 프록시로 사용 (로컬/배포 동일하게 동작)
      const res = await fetch(`/api/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`PDF 생성 실패: ${err.detail || res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adguard_report_${(body.task_id || "result").slice(0, 8)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("PDF 다운로드 중 오류가 발생했습니다.");
  }
};

  // 로딩 화면 UI - 기존 디자인 그대로 유지
  if (isLoading) {
    return (
      <div className="flex flex-col items-center min-h-screen bg-white font-sans overflow-hidden pt-20 pb-10">
        <div className="relative w-64 h-64 flex items-center justify-center mb-16">
          <div className="absolute w-full h-full bg-blue-400/15 blur-[80px] animate-pulse"></div>
          <div className="relative w-44 h-44 bg-gradient-to-tr from-blue-700 via-cyan-500 to-indigo-600 rounded-full animate-sphere-morph shadow-[inset_0_0_30px_rgba(255,255,255,0.3)]"></div>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[10px] font-black tracking-[0.4em] text-white/90 uppercase mb-2">Processing</span>
            <div className="flex gap-1.5 items-center">
              <span className="text-xl font-black text-white">분석 중...</span>
            </div>
          </div>
        </div>

        <div className="w-full max-w-6xl px-10">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">AI 광고 컴플라이언스 엔진 가동 중</h2>
            <p className="text-gray-500 mt-2 text-sm">현재 단계: {analysisPhases[loadingStep].title} - {analysisPhases[loadingStep].label}</p>
          </div>
          <div className="flex flex-row justify-center items-stretch gap-4">
            {analysisPhases.map((phase, index) => (
              <div key={index} className={`flex-1 transition-all duration-700 p-6 rounded-[32px] border flex flex-col items-center text-center ${
                loadingStep === index ? "bg-blue-600 border-blue-400 scale-105 shadow-xl text-white" :
                loadingStep > index ? "bg-blue-50 border-blue-100 opacity-60" : "bg-gray-50 border-gray-100 opacity-30"
              }`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-black mb-4 ${
                  loadingStep === index ? "bg-white text-blue-600" : "bg-blue-100 text-blue-600"
                }`}>
                  {loadingStep > index ? "✓" : index + 1}
                </div>
                <h4 className="font-bold text-xs mb-1">{phase.title} · {phase.label}</h4>
                {loadingStep === index && (
                  <p className="text-[10px] mt-2 bg-white/10 p-2 rounded-xl animate-fade-in" dangerouslySetInnerHTML={{ __html: phase.detail }} />
                )}
              </div>
            ))}
          </div>
        </div>
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes sphereMorph {
            0% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(0deg) scale(1); }
            50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; transform: rotate(180deg) scale(1.1); }
            100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(360deg) scale(1); }
          }
          .animate-sphere-morph { animation: sphereMorph 8s ease-in-out infinite; }
          .animate-fade-in { animation: fadeIn 0.5s ease-out forwards; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        `}} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 px-6 text-center">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <p className="text-red-500 font-semibold mb-6">{error}</p>
        <Link href="/upload" className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold">광고 분석하러 가기</Link>
      </div>
    );
  }

  const riskBadgeMap: any = {
    High: { bg: "bg-red-50", text: "text-red-600", border: "border-red-100", dot: "bg-red-600", label: "위험 단계" },
    Medium: { bg: "bg-yellow-50", text: "text-yellow-600", border: "border-yellow-100", dot: "bg-yellow-500", label: "주의 단계" },
    Low: { bg: "bg-green-50", text: "text-green-600", border: "border-green-100", dot: "bg-green-500", label: "안전 단계" },
    "N/A": { bg: "bg-gray-50", text: "text-gray-500", border: "border-gray-100", dot: "bg-gray-400", label: "분석 불가" },
  };
  const riskBadge = riskBadgeMap[resultData.riskLevel] || riskBadgeMap["N/A"];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-6">
      <main className="w-full max-w-5xl bg-white rounded-[40px] shadow-sm border border-gray-100 p-8 md:p-14 relative overflow-hidden">

        {/* 상단 면책 조항 */}
        <div className="absolute top-0 left-0 w-full bg-gray-900 text-gray-400 py-2.5 px-6 text-[11px] flex justify-between items-center z-10">
          <span className="flex items-center gap-1.5 font-medium">
            <ShieldCheck size={14} className="text-blue-400" /> 본 분석은 Azure AI를 기반으로 하며 법적 효력이 없습니다.
          </span>
          <span className="hidden md:inline opacity-60">ADGUARD COMPLIANCE v1.2</span>
        </div>

        {/* 헤더 */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 mt-6 gap-4">
          <div>
            <span className="text-blue-600 font-bold text-xs tracking-widest uppercase mb-2 block">Analysis Report</span>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">분석 결과 리포트</h1>
          </div>
          <div className={`${riskBadge.bg} ${riskBadge.text} px-5 py-2 rounded-full font-bold text-sm border ${riskBadge.border} flex items-center gap-2`}>
            <span className={`w-2 h-2 ${riskBadge.dot} rounded-full animate-pulse`}></span>
            {riskBadge.label}
          </div>
        </div>

        {/* AI 판정 설명 */}
        {resultData.explanation && (
          <div className="mb-10 p-6 bg-blue-50/30 rounded-3xl border border-blue-100/50 text-sm text-gray-700 leading-relaxed flex gap-3">
            <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
            <p>{resultData.explanation}</p>
          </div>
        )}

        {/* 비포 애프터 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="flex flex-col">
            <h4 className="text-gray-500 font-bold text-xs mb-3 px-2 uppercase tracking-wider">Before · 위반 소지</h4>
            <div className="bg-gray-50 rounded-[32px] p-8 border border-gray-200 min-h-[300px] shadow-inner">
              <div className="leading-[2] text-[17px] text-gray-600">
                {resultData.spellCheck.original.map((chunk: any, i: number) => (
                  <span key={i} className={chunk.isError ? "bg-red-100 text-red-700 px-1 rounded-md mx-0.5 font-semibold line-through decoration-red-300" : ""}>
                    {chunk.text}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col">
            <h4 className="text-blue-600 font-bold text-xs mb-3 px-2 uppercase tracking-wider">After · AI 정화 완료</h4>
            <div className="bg-blue-50/30 rounded-[32px] p-8 border border-blue-100 min-h-[300px] shadow-inner">
              <div className="leading-[2] text-[17px] text-gray-900 font-medium">
                {resultData.spellCheck.corrected.map((chunk: any, i: number) => (
                  <span key={i} className={chunk.isFix ? "bg-green-100 text-green-700 px-1.5 py-0.5 rounded-md mx-0.5 font-bold border-b-2 border-green-300" : ""}>
                    {chunk.text}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 추천안 카드 */}
        <section className="mb-12">
          <h3 className="text-sm font-bold text-gray-700 mb-6 flex items-center gap-2 px-2">
            ✨ 다른 AI 교정 제안 둘러보기 <span className="text-[10px] font-normal text-gray-400">(클릭하여 복사)</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {resultData.suggestions.map((item: any) => (
              <div
                key={item.id}
                onClick={() => {
                  navigator.clipboard.writeText(item.text);
                  alert("클립보드에 복사되었습니다!");
                }}
                className="p-6 bg-white border border-gray-100 rounded-3xl hover:border-blue-200 hover:shadow-xl transition-all flex flex-col justify-between group cursor-pointer border-b-4 hover:border-b-blue-500"
              >
                <div>
                  <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-3 py-1 rounded-full mb-4 inline-block">{item.tag}</span>
                  <p className="text-gray-700 font-medium leading-relaxed text-sm mb-6">{item.text}</p>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-gray-50 pt-4">
                  <button onClick={(e) => { e.stopPropagation(); }} className="p-1.5 rounded-full text-gray-300 hover:bg-gray-100 hover:text-blue-500 transition-colors"><ThumbsUp size={14} /></button>
                  <button onClick={(e) => { e.stopPropagation(); }} className="p-1.5 rounded-full text-gray-300 hover:bg-gray-100 hover:text-red-500 transition-colors"><ThumbsDown size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 하단 버튼 */}
        <footer className="space-y-8">
          <div className="flex items-start gap-2 text-gray-400 max-w-2xl mx-auto text-center justify-center">
            <Info size={14} className="mt-0.5 shrink-0" />
            <p className="text-[11px] leading-relaxed">
              본 서비스는 텍스트 데이터만을 분석하며, 최종 광고 시안 확정 전 반드시 법률 전문가의 검토를 거치시기 바랍니다.
            </p>
          </div>

          <div className="flex flex-col md:flex-row gap-4">
            <Link href="/upload" className="flex-1 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-bold hover:bg-blue-700 shadow-lg gap-2 transition-all active:scale-95">
              <ArrowLeft size={18} /> 새 이미지 검사
            </Link>
            <button
              onClick={handleDownloadPDF}
              className="px-10 h-14 border border-gray-200 text-gray-600 rounded-2xl flex items-center justify-center font-bold hover:bg-gray-50 transition-all gap-2"
            >
              <Scale size={18} /> 결과 보고서 저장 (PDF)
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
