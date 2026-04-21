"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Info,
  ArrowLeft,
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
          setError("데이터가 없습니다.");
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

  if (isLoading) {
    return (
      <div className="flex flex-col items-center min-h-screen bg-white pt-24">
        <div className="relative w-48 h-48 mb-16 flex items-center justify-center">
            <div className="absolute w-full h-full bg-blue-100 rounded-full animate-ping opacity-20"></div>
            <div className="relative w-32 h-32 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-full animate-sphere-morph shadow-xl flex items-center justify-center">
                <span className="text-white font-black text-lg">AI 분석</span>
            </div>
        </div>
        <div className="w-full max-w-4xl px-8">
            <div className="grid grid-cols-5 gap-3">
                {analysisPhases.map((phase, idx) => (
                    <div key={idx} className={`p-4 rounded-2xl border text-center transition-all duration-500 ${loadingStep === idx ? "bg-blue-600 border-blue-600 text-white scale-105 shadow-lg" : "bg-gray-50 opacity-40"}`}>
                        <div className="text-[10px] font-bold uppercase mb-1">{phase.title}</div>
                        <div className="text-xs font-black">{phase.label}</div>
                    </div>
                ))}
            </div>
        </div>
        <style dangerouslySetInnerHTML={{ __html: `@keyframes sphereMorph { 0% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; } 50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; } 100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; } } .animate-sphere-morph { animation: sphereMorph 6s ease-in-out infinite; }` }} />
      </div>
    );
  }

  if (error || !resultData) return <div className="p-20 text-center text-red-500">{error || "오류"}</div>;

  const riskBadgeMap: any = {
    High: { bg: "bg-red-50", text: "text-red-600", label: "위험" },
    Medium: { bg: "bg-yellow-50", text: "text-yellow-600", label: "주의" },
    Low: { bg: "bg-green-50", text: "text-green-600", label: "안전" },
  };
  const riskBadge = riskBadgeMap[resultData.riskLevel] || { bg: "bg-gray-50", text: "text-gray-500", label: "미확인" };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-12 px-4">
      <main className="w-full max-w-5xl bg-white rounded-[40px] shadow-2xl border border-slate-100 p-8 md:p-14 relative">
        
        {/* 상단 섹션 */}
        <div className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-3xl font-black text-slate-900">컴플라이언스 리포트</h1>
            <p className="text-slate-400 text-sm mt-1">AI 기반 광고 문구 적정성 분석 결과입니다.</p>
          </div>
          <div className={`${riskBadge.bg} ${riskBadge.text} px-6 py-2 rounded-full font-black border flex items-center gap-2`}>
            <ShieldAlert size={18} /> {riskBadge.label} 단계
          </div>
        </div>

        {/* 종합 의견 */}
        <div className="mb-12 p-6 bg-slate-50 rounded-3xl border border-slate-100 flex gap-4 items-start">
            <div className="p-2 bg-blue-600 rounded-lg text-white"><LayoutDashboard size={20}/></div>
            <div>
                <h3 className="font-bold text-slate-800 mb-1 text-md">총평</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{resultData.explanation}</p>
            </div>
        </div>

        {/* 🛠️ 좌(Before) 우(After) 레이아웃 복구 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          
          {/* 🔴 Left: Before (하이라이트 포함 발췌) */}
          <div className="bg-white border-2 border-slate-100 rounded-[32px] overflow-hidden">
            <div className="bg-red-50 px-6 py-4 border-b border-red-100 flex justify-between items-center">
                <span className="text-red-600 font-black text-sm uppercase flex items-center gap-2">
                    <AlertCircle size={14}/> Before
                </span>
                <span className="text-[10px] text-red-400 font-bold uppercase">Original Text</span>
            </div>
            <div className="p-8 min-h-[220px] leading-loose text-lg">
              {/* 위반 사항이 있는 청크 주변만 보여주거나 전체에서 하이라이트 */}
              {resultData.spellCheck.original.map((chunk: any, i: number) => (
                chunk.isError ? (
                  <span key={i} className="relative inline-block mx-0.5 group">
                    <span className="bg-red-500 text-white font-black px-1.5 py-0.5 rounded-md shadow-sm">
                      {chunk.text}
                    </span>
                    {/* 툴팁 */}
                    <span className="absolute bottom-full left-0 mb-2 hidden group-hover:block w-48 bg-slate-800 text-white text-[10px] p-2 rounded-lg z-50 shadow-xl">
                        {chunk.violation?.explanation || "수정이 필요한 문구"}
                    </span>
                  </span>
                ) : (
                  <span key={i} className="text-slate-400">{chunk.text}</span>
                )
              ))}
            </div>
          </div>

          {/* 🔵 Right: After (수정 제안) */}
          <div className="bg-white border-2 border-blue-100 rounded-[32px] overflow-hidden shadow-sm">
            <div className="bg-blue-50 px-6 py-4 border-b border-blue-100 flex justify-between items-center">
                <span className="text-blue-600 font-black text-sm uppercase flex items-center gap-2">
                    <CheckCircle2 size={14}/> After
                </span>
                <span className="text-[10px] text-blue-400 font-bold uppercase">AI Refined</span>
            </div>
            <div className="p-8 min-h-[220px] flex flex-col justify-center">
                <p className="text-slate-800 font-bold text-xl leading-relaxed italic">
                    "{editedText}"
                </p>
                <div className="mt-6 flex items-center gap-2 text-blue-500 text-[11px] font-bold">
                    <ArrowRight size={14}/> 법적 준수 사항이 모두 반영되었습니다.
                </div>
            </div>
          </div>
        </div>

        {/* 위반 상세 내역 테이블 */}
        <section className="mb-14">
          <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <AlertCircle className="text-red-500" size={24} /> 위반 상세 내역 (발췌)
          </h3>
          <div className="overflow-hidden border border-slate-100 rounded-2xl shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 w-1/4 uppercase tracking-tighter">위반 문구</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 w-1/4 uppercase tracking-tighter">유형</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-tighter">상세 분석</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {resultData.violations.map((v: any, idx: number) => (
                  <tr key={idx} className="hover:bg-red-50/20 transition-colors">
                    <td className="px-6 py-4 text-sm font-bold text-red-600 bg-red-50/10">"{v.phrase || v.violation_word}"</td>
                    <td className="px-6 py-4 text-[11px] font-bold text-slate-400">{v.type || "규정 위반"}</td>
                    <td className="px-6 py-4 text-xs text-slate-500 leading-relaxed">{v.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 법적 근거 */}
        <section className="mb-14">
          <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <BookOpen className="text-blue-600" size={24} /> 근거 법령 및 가이드라인
          </h3>
          <div className="space-y-3">
            {resultData.legalGrounds.map((doc: any, idx: number) => (
              <div key={idx} className="p-5 bg-slate-50/50 border border-slate-200 rounded-2xl flex gap-4 items-start">
                <FileText className="text-slate-400 shrink-0 mt-0.5" size={18} />
                <div className="text-xs text-slate-600 leading-relaxed italic">"{doc.content}"</div>
              </div>
            ))}
          </div>
        </section>

        {/* 다른 추천 제안 */}
        <section className="mb-14">
            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">✨ 다른 스타일 추천안</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {resultData.suggestions.map((item: any, idx: number) => (
                    <button key={idx} onClick={() => { setEditedText(item.text); navigator.clipboard.writeText(item.text); }}
                        className="p-6 bg-white border-2 border-slate-100 rounded-3xl hover:border-blue-500 hover:shadow-lg transition-all text-left group">
                        <div className="text-[10px] font-black text-blue-500 mb-3 uppercase tracking-widest">{item.tag}</div>
                        <p className="text-sm text-slate-700 font-bold leading-relaxed">"{item.text}"</p>
                        <div className="mt-4 flex items-center justify-end opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity"><Copy size={14}/></div>
                    </button>
                ))}
            </div>
        </section>

        <footer className="flex flex-col md:flex-row gap-4 pt-4 border-t border-slate-100">
          <Link href="/upload" className="flex-1 h-14 bg-slate-900 text-white rounded-2xl flex items-center justify-center font-bold gap-2 hover:bg-black transition-all">
            <ArrowLeft size={18} /> 이전으로
          </Link>
          <button onClick={handleDownloadPDF} className="px-10 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-bold gap-2 hover:bg-blue-700 transition-all">
            <Scale size={18} /> 리포트 저장 (PDF)
          </button>
        </footer>
      </main>
    </div>
  );
}
