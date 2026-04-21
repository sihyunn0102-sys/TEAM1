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
  BookOpen,
  FileText,
  LayoutDashboard,
  ShieldAlert,
  Copy,
  ChevronRight,
  ArrowRight
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

// 텍스트 하이라이팅을 위한 청크 생성 함수 (강화됨)
function buildOriginalChunks(copy: string, violations: any[]) {
  if (!copy) return [];
  let chunks: { text: string; isError: boolean; violation?: any }[] = [
    { text: copy, isError: false },
  ];

  for (const v of violations) {
    const phrase: string = (v.phrase || v.violation_word || v.keyword || "").trim();
    if (!phrase) continue;
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
      if (idx > 0) next.push({ text: chunk.text.slice(0, idx), isError: false });
      // 에러 부분: 명시적으로 isError 플래그 설정
      next.push({ text: phrase, isError: true, violation: v });
      if (idx + phrase.length < chunk.text.length) {
        next.push({ text: chunk.text.slice(idx + phrase.length), isError: false });
      }
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

const analysisPhases = [
  { title: "L1", label: "Rule Engine", desc: "금지어 식별", detail: "블랙리스트 기반 점검" },
  { title: "L2", label: "Retriever", desc: "법적 근거", detail: "가이드라인 참조" },
  { title: "L3", label: "Judge", desc: "종합 판정", detail: "GPT-4o 심층 분석" },
  { title: "L4", label: "Rewriter", desc: "수정 제안", detail: "대안 카피 생성" },
  { title: "L5", label: "Re-Judge", desc: "최종 검증", detail: "교차 검증 수행" },
];

const stepToIndex: Record<string, number> = { L1: 0, L2: 1, L3: 2, L4: 3, L5: 4 };

export default function ResultPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [resultData, setResultData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [editedText, setEditedText] = useState("");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const text = sessionStorage.getItem("analyzeText");
    const productType = sessionStorage.getItem("analyzeProductType") || "general_cosmetic";

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

    es.addEventListener("error", () => {
      setError("서버 연결에 실패했습니다.");
      setIsLoading(false);
      es.close();
    });

    return () => es.close();
  }, []);

  function processResult(backend: any) {
    const copy = backend.copy ?? backend.ad_copy ?? backend.ad_text ?? "";
    const violations = backend.violations ?? [];
    const rewrites = backend.verified_rewrites ?? [];
    const originalChunks = buildOriginalChunks(copy, violations);
    const safeRewrite = rewrites.find((r: any) => r.style === "safe") ?? rewrites[0];

    if (safeRewrite) setEditedText(safeRewrite.text);

    setResultData({
      riskLevel: toRiskLevel(backend.final_verdict),
      explanation: backend.explanation ?? "",
      violations: violations,
      legalGrounds: backend.retrieved_docs ?? [],
      spellCheck: { original: originalChunks },
      suggestions: rewrites.map((r: any, i: number) => ({
        id: i + 1,
        text: r.text,
        tag: STYLE_LABELS[r.style] ?? r.style,
      })),
    });
  }

  const handleDownloadPDF = async () => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8080";
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
      a.href = url; a.download = `adguard_report.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { alert("다운로드 오류"); }
  };

  // --- 기존 로딩 섹션 유지 ---
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
              <div key={index} className={`flex-1 transition-all duration-700 p-6 rounded-[32px] border flex flex-col items-center text-center ${loadingStep === index ? "bg-blue-600 border-blue-400 scale-105 shadow-xl text-white" : loadingStep > index ? "bg-blue-50 border-blue-100 opacity-60" : "bg-gray-50 border-gray-100 opacity-30"}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-black mb-4 ${loadingStep === index ? "bg-white text-blue-600" : "bg-blue-100 text-blue-600"}`}>{loadingStep > index ? "✓" : index + 1}</div>
                <h4 className="font-bold text-xs mb-1">{phase.title} · {phase.label}</h4>
                {loadingStep === index && <p className="text-[10px] mt-2 bg-white/10 p-2 rounded-xl animate-fade-in" dangerouslySetInnerHTML={{ __html: phase.detail }} />}
              </div>
            ))}
          </div>
        </div>
        <style dangerouslySetInnerHTML={{ __html: `@keyframes sphereMorph { 0% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(0deg) scale(1); } 50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; transform: rotate(180deg) scale(1.1); } 100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(360deg) scale(1); } } .animate-sphere-morph { animation: sphereMorph 8s ease-in-out infinite; } .animate-fade-in { animation: fadeIn 0.5s ease-out forwards; } @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }` }} />
      </div>
    );
  }

  if (error || !resultData) return <div className="p-20 text-center text-red-500 font-bold">{error || "결과 오류"}</div>;

  const riskBadgeMap: any = {
    High: { bg: "bg-red-50", text: "text-red-600", label: "위험 단계" },
    Medium: { bg: "bg-yellow-50", text: "text-yellow-600", label: "주의 단계" },
    Low: { bg: "bg-green-50", text: "text-green-600", label: "안전 단계" },
  };
  const riskBadge = riskBadgeMap[resultData.riskLevel] || { bg: "bg-gray-50", text: "text-gray-500", label: "분석 불가" };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-6">
      <main className="w-full max-w-5xl bg-white rounded-[40px] shadow-sm border border-gray-100 p-8 md:p-14 relative overflow-hidden">
        
        {/* 헤더 섹션 */}
        <div className="flex justify-between items-end mb-10 mt-6">
          <div>
            <span className="text-blue-600 font-bold text-xs tracking-widest uppercase mb-2 block">Analysis Report</span>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">분석 결과 리포트</h1>
          </div>
          <div className={`${riskBadge.bg} ${riskBadge.text} px-5 py-2 rounded-full font-bold border flex items-center gap-2`}>
            <CheckCircle2 size={16} /> {riskBadge.label}
          </div>
        </div>

        {/* 종합 판정 요약 */}
        <div className="mb-10 p-6 bg-blue-50/30 rounded-3xl border flex gap-3 text-left">
          <Info size={18} className="text-blue-500 shrink-0 mt-1" />
          <p className="text-sm text-gray-700 leading-relaxed">{resultData.explanation}</p>
        </div>

        {/* 🛠️ 좌(Before) - 우(After) 레이아웃 고정 및 하이라이트 반영 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          
          {/* 🔴 Left: Before (수정 전 위반 문구 하이라이트) */}
          <div className="flex flex-col h-full bg-white border-2 border-red-50 rounded-[32px] overflow-hidden shadow-sm">
            <div className="bg-red-50 px-6 py-4 border-b border-red-100 flex justify-between items-center">
              <span className="text-red-600 font-black text-xs uppercase flex items-center gap-2">
                <AlertCircle size={14}/> Before
              </span>
              <span className="text-[10px] text-red-400 font-bold uppercase">원본 문구</span>
            </div>
            <div className="p-8 flex-grow leading-loose text-lg text-left min-h-[260px]">
              {resultData.spellCheck.original.map((chunk: any, i: number) => (
                chunk.isError ? (
                  <span key={i} className="relative inline-block mx-0.5 group cursor-help">
                    {/* 선명한 빨간색 하이라이트 박스 */}
                    <span className="bg-red-600 text-white font-bold px-2 py-0.5 rounded-md shadow-sm border-b-2 border-red-800">
                      {chunk.text}
                    </span>
                    {/* 호버 시 설명 툴팁 */}
                    <span className="absolute bottom-full left-0 mb-2 hidden group-hover:block w-48 bg-slate-900 text-white text-[10px] p-2 rounded-lg z-50 shadow-xl leading-snug">
                      {chunk.violation?.explanation || "수정이 필요한 표현"}
                    </span>
                  </span>
                ) : (
                  <span key={i} className="text-slate-400 font-medium">{chunk.text}</span>
                )
              ))}
            </div>
          </div>

          {/* 🔵 Right: After (AI 정화 완료 문구) */}
          <div className="flex flex-col h-full bg-white border-2 border-blue-50 rounded-[32px] overflow-hidden shadow-md">
            <div className="bg-blue-50 px-6 py-4 border-b border-blue-100 flex justify-between items-center">
              <span className="text-blue-600 font-black text-xs uppercase flex items-center gap-2">
                <CheckCircle2 size={14}/> After
              </span>
              <span className="text-[10px] text-blue-400 font-bold uppercase">AI 교정 제안</span>
            </div>
            <div className="p-8 flex-grow flex items-center justify-center min-h-[260px] bg-slate-50/20">
              <p className="text-slate-800 font-extrabold text-2xl text-center leading-snug italic">
                "{editedText}"
              </p>
            </div>
          </div>
        </div>

        {/* 위반 상세 내역 테이블 */}
        <section className="mb-12">
          <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2 text-left">
            <AlertCircle className="text-red-500" size={24} /> 위반 상세 내역
          </h3>
          <div className="overflow-hidden border border-gray-200 rounded-2xl shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 w-1/4 uppercase">위반 문구</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 w-1/4 uppercase">유형</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">상세 이유</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {resultData.violations.map((v: any, idx: number) => (
                  <tr key={idx} className="hover:bg-red-50/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-bold text-red-600">"{v.phrase || v.violation_word}"</td>
                    <td className="px-6 py-4 text-[11px] font-bold text-slate-400">{v.type || "표현 부적합"}</td>
                    <td className="px-6 py-4 text-xs text-slate-500 leading-relaxed">{v.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 법적 근거 섹션 */}
        <section className="mb-12">
          <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2 text-left">
            <BookOpen className="text-blue-600" size={24} /> 관련 법령 및 근거
          </h3>
          <div className="space-y-3 text-left">
            {resultData.legalGrounds.map((doc: any, idx: number) => (
              <div key={idx} className="p-5 bg-slate-50 border border-slate-200 rounded-2xl flex gap-4 items-start">
                <FileText className="text-slate-400 shrink-0 mt-0.5" size={18} />
                <div className="text-xs text-slate-600 leading-relaxed italic">"{doc.content}"</div>
              </div>
            ))}
          </div>
        </section>

        {/* 하단 버튼 섹션 */}
        <footer className="flex flex-col md:flex-row gap-4 pt-4">
          <Link href="/upload" className="flex-1 h-14 bg-slate-900 text-white rounded-2xl flex items-center justify-center font-bold gap-2 hover:bg-black transition-all">
            <ArrowLeft size={18} /> 다시 검사하기
          </Link>
          <button onClick={handleDownloadPDF} className="px-10 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-bold gap-2 hover:bg-blue-700 transition-all">
            <Scale size={18} /> 리포트 저장 (PDF)
          </button>
        </footer>
      </main>
    </div>
  );
}
