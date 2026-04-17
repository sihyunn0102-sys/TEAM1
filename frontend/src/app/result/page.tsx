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
  AlertTriangle,
  XCircle,
  HelpCircle,
} from "lucide-react";

// --- 1. 백엔드 연동용 유틸리티 ---
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

function buildOriginalChunks(copy: string, violations: any[]) {
  let chunks: { text: string; isError: boolean }[] = [
    { text: copy, isError: false },
  ];
  for (const v of violations) {
    const phrase: string = v.phrase;
    if (!phrase) continue;
    const next: { text: string; isError: boolean }[] = [];
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
      next.push({ text: phrase, isError: true });
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

const STYLE_LABELS: Record<string, string> = {
  safe: "가장 안전 🟢",
  marketing: "자연스러움 🟡",
  functional: "마케팅 강조 🔵",
};

// --- 2. 상세 분석 단계 데이터 ---
const analysisPhases = [
  {
    title: "L1",
    label: "Rule Engine",
    detail: "blacklist_v1.json 기반<br />80+ 핵심 키워드 즉시 식별",
  },
  {
    title: "L2",
    label: "RAG Retriever",
    detail: "4개 인덱스 하이브리드 검색<br />관련 법령 가이드라인 Top-K=5 추출",
  },
  {
    title: "L3",
    label: "Judge Node",
    detail: "시스템 프롬프트 + RAG 컨텍스트<br />위반 사항 및 위험도 등급 확정",
  },
  {
    title: "L4",
    label: "Rewriter Node",
    detail:
      "GPT-4o 기반 3가지 스타일 생성<br />(Safe · Marketing · Functional)",
  },
  {
    title: "L5",
    label: "Re-Judge Node",
    detail: "수정안 L1+L3 재검토<br />안전 등급 확인 및 최대 2회 재시도",
  },
];

export default function ResultPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [resultData, setResultData] = useState<any>(null);

  useEffect(() => {
    // 1. 이전 페이지(업로드)에서 저장한 분석할 텍스트와 제품 타입 가져오기
    const text = sessionStorage.getItem("analyzeText");
    const productType =
      sessionStorage.getItem("analyzeProductType") || "general_cosmetic";

    if (!text) {
      // 분석할 텍스트가 없으면 기존 결과가 있는지 확인
      const raw = localStorage.getItem("adguard_result");
      if (raw) {
        processResult(JSON.parse(raw));
        setIsLoading(false);
      } else {
        alert("분석할 데이터가 없습니다. 업로드 페이지로 이동합니다.");
        window.location.href = "/upload";
      }
      return;
    }

    // 2. 백엔드 스트리밍 API 연결
    const params = new URLSearchParams({ text, product_type: productType });
    const es = new EventSource(`/api/analyze-stream?${params.toString()}`);

    // 3. 서버에서 진행 상황(L1~L5) 신호를 보낼 때마다 로딩 단계 업데이트
    es.addEventListener("progress", (e: any) => {
      const data = JSON.parse(e.data);
      // 서버에서 보내는 step 이름(L1, L2...)을 인덱스(0, 1...)로 변환
      const stepMap: Record<string, number> = {
        L1: 0,
        L2: 1,
        L3: 2,
        L4: 3,
        L5: 4,
      };
      if (stepMap[data.step] !== undefined) {
        setLoadingStep(stepMap[data.step]);
      }
    });

    // 4. 최종 결과가 도착했을 때
    es.addEventListener("result", (e: any) => {
      const data = JSON.parse(e.data);
      localStorage.setItem("adguard_result", JSON.stringify(data)); // 결과 저장
      processResult(data); // 화면에 데이터 뿌리기
      setIsLoading(false); // 로딩 종료
      es.close(); // 연결 닫기
    });

    // 5. 에러 발생 시
    es.onerror = () => {
      console.error("연결 에러 발생");
      es.close();
    };

    return () => es.close();
  }, []);

  function processResult(backend: any) {
    const copy = backend.copy ?? backend.ad_copy ?? "";
    const rewrites = backend.verified_rewrites ?? [];
    const safeRewrite =
      rewrites.find((r: any) => r.style === "safe") ?? rewrites[0];

    setResultData({
      riskLevel: toRiskLevel(backend.final_verdict),
      explanation: backend.explanation ?? "",
      spellCheck: {
        original: buildOriginalChunks(copy, backend.violations ?? []),
        corrected: safeRewrite
          ? [{ text: safeRewrite.text, isFix: true }]
          : [{ text: "수정안 없음", isFix: false }],
      },
      suggestions: rewrites.map((r: any, i: number) => ({
        id: i + 1,
        text: r.text,
        tag: STYLE_LABELS[r.style] ?? r.style,
      })),
    });
  }

  // ✅ [기능] 추천 문구 클릭 시 After 칸에 입력
  const handleSuggestionClick = (selectedText: string) => {
    setResultData((prev: any) => ({
      ...prev,
      spellCheck: {
        ...prev.spellCheck,
        corrected: [{ text: selectedText, isFix: true }],
      },
    }));
  };

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
            <div className="flex gap-1.5 items-center">
              <span className="text-xl font-black text-white">분석 중...</span>
            </div>
          </div>
        </div>

        <div className="w-full max-w-6xl px-10 text-center">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-12">
            AI 광고 컴플라이언스 엔진 가동 중
          </h2>
          <div className="flex flex-row justify-center items-stretch gap-4">
            {analysisPhases.map((phase, index) => (
              <div
                key={index}
                className={`flex-1 transition-all duration-700 p-6 rounded-[32px] border flex flex-col items-center ${loadingStep === index ? "bg-blue-600 border-blue-400 scale-105 shadow-xl text-white" : loadingStep > index ? "bg-blue-50 border-blue-100 opacity-60" : "bg-gray-50 border-gray-100 opacity-30"}`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-black mb-4 ${loadingStep === index ? "bg-white text-blue-600" : "bg-blue-100 text-blue-600"}`}
                >
                  {loadingStep > index ? "✓" : index + 1}
                </div>
                <h4 className="font-bold text-xs mb-1">
                  {phase.title} · {phase.label}
                </h4>
                {loadingStep === index && (
                  <p
                    className="text-[10px] mt-2 bg-white/10 p-2 rounded-xl"
                    dangerouslySetInnerHTML={{ __html: phase.detail }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <style
          dangerouslySetInnerHTML={{
            __html: `@keyframes sphereMorph { 0% { border-radius: 60% 40% 30% 70%; transform: rotate(0deg); } 50% { border-radius: 30% 60% 70% 40%; transform: rotate(180deg); } 100% { border-radius: 60% 40% 30% 70%; transform: rotate(360deg); } } .animate-sphere-morph { animation: sphereMorph 8s infinite; }`,
          }}
        />
      </div>
    );
  }

  // ✅ [기능] 위험도 기호 + 색상 설정
  const riskBadgeMap: any = {
    High: {
      bg: "bg-red-50",
      text: "text-red-700",
      border: "border-red-200",
      icon: <XCircle size={18} className="text-red-600" />,
      label: "위험 단계",
    },
    Medium: {
      bg: "bg-yellow-50",
      text: "text-yellow-700",
      border: "border-yellow-200",
      icon: <AlertTriangle size={18} className="text-yellow-600" />,
      label: "주의 단계",
    },
    Low: {
      bg: "bg-green-50",
      text: "text-green-700",
      border: "border-green-200",
      icon: <CheckCircle2 size={18} className="text-green-600" />,
      label: "안전 단계",
    },
  };
  const riskBadge = riskBadgeMap[resultData.riskLevel] || {
    bg: "bg-gray-50",
    text: "text-gray-500",
    border: "border-gray-200",
    icon: <HelpCircle size={18} />,
    label: "분석 불가",
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-6">
      <main className="w-full max-w-5xl bg-white rounded-[40px] shadow-sm border border-gray-100 p-8 md:p-14 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full bg-gray-900 text-gray-400 py-2.5 px-6 text-[11px] flex justify-between items-center z-10">
          <span className="flex items-center gap-1.5 font-medium">
            <ShieldCheck size={14} className="text-blue-400" /> 본 분석은 Azure
            AI를 기반으로 하며 법적 효력이 없습니다.
          </span>
          <span className="hidden md:inline opacity-60">
            ADGUARD COMPLIANCE v1.2
          </span>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 mt-6 gap-4">
          <div>
            <span className="text-blue-600 font-bold text-xs tracking-widest uppercase mb-2 block">
              Analysis Report
            </span>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
              분석 결과 리포트
            </h1>
          </div>
          <div
            className={`${riskBadge.bg} ${riskBadge.text} ${riskBadge.border} px-5 py-2.5 rounded-full font-bold text-sm border flex items-center gap-2.5 shadow-sm`}
          >
            {riskBadge.icon}
            {riskBadge.label}
          </div>
        </div>

        {resultData.explanation && (
          <div className="mb-10 p-6 bg-blue-50/30 rounded-3xl border border-blue-100/50 text-sm text-gray-700 flex gap-3">
            <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
            <p>{resultData.explanation}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          <div className="bg-zinc-50 rounded-[32px] p-8 border border-zinc-100 relative">
            <div className="absolute top-6 right-8 text-[10px] font-black text-red-300 uppercase tracking-widest">
              Before
            </div>
            <h4 className="text-zinc-400 font-bold text-sm mb-6 text-left">
              수정 전 위반 문구
            </h4>
            <div className="h-48 overflow-y-auto text-lg text-zinc-600 text-left">
              {resultData.spellCheck.original.map((chunk: any, i: number) => (
                <span
                  key={i}
                  className={
                    chunk.isError
                      ? "bg-red-100 text-red-700 line-through mx-0.5"
                      : ""
                  }
                >
                  {chunk.text}
                </span>
              ))}
            </div>
          </div>
          <div className="bg-blue-50/30 rounded-[32px] p-8 border border-blue-100/50 relative">
            <div className="absolute top-6 right-8 text-[10px] font-black text-blue-300 uppercase tracking-widest">
              After
            </div>
            <h4 className="text-blue-600 font-bold text-sm mb-6 text-left">
              AI 정화 완료
            </h4>
            <div className="h-48 overflow-y-auto text-lg text-zinc-800 text-left">
              {resultData.spellCheck.corrected.map((chunk: any, i: number) => (
                <span
                  key={i}
                  className={
                    chunk.isFix
                      ? "bg-blue-600 text-white px-1.5 py-0.5 rounded-md font-bold mx-0.5 shadow-sm"
                      : ""
                  }
                >
                  {chunk.text}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 광고 배너 */}
        <div className="mb-12 w-full overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100 flex flex-col items-center justify-center p-6 cursor-pointer hover:shadow-md transition-all group">
          <span className="text-[10px] text-gray-400 font-bold bg-gray-200 px-2 py-0.5 rounded-sm mb-2 self-start">
            AD
          </span>
          <p className="text-gray-700 font-bold group-hover:text-blue-600 transition-colors">
            더 많은 광고 문구를 무제한으로 분석하고 싶다면? 🚀
          </p>
          <p className="text-xs text-gray-500 mt-1">
            '광고청정기 프로' 1개월 무료 체험 알아보기 &rarr;
          </p>
        </div>

        <div className="mb-12 text-left">
          <h3 className="font-bold text-zinc-800 flex items-center gap-2 mb-6">
            ✨ 다른 AI 교정 제안 둘러보기{" "}
            <span className="text-sm font-normal text-zinc-400">
              (클릭하여 위 칸에 적용)
            </span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {resultData.suggestions.map((item: any, index: number) => (
              <div
                key={item.id}
                onClick={() => handleSuggestionClick(item.text)}
                className="p-6 bg-white border border-zinc-100 rounded-[28px] hover:border-blue-400 hover:shadow-xl transition-all cursor-pointer group flex flex-col justify-between h-full active:scale-95"
              >
                <span className="text-xs font-black text-blue-600 bg-blue-50 border border-blue-100 rounded-md px-3 py-1 inline-block w-fit">
                  추천 문구 {index + 1}
                </span>
                <p className="mt-4 text-zinc-700 font-medium leading-relaxed">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        <footer className="flex flex-col md:flex-row gap-4">
          <Link
            href="/upload"
            className="flex-1 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-bold hover:bg-blue-700 shadow-lg gap-2 transition-all active:scale-95"
          >
            <ArrowLeft size={18} /> 새 이미지 검사
          </Link>
          <button className="px-10 h-14 border border-gray-200 text-gray-600 rounded-2xl flex items-center justify-center font-bold hover:bg-gray-50 transition-all gap-2">
            <Scale size={18} /> 결과 보고서 저장 (PDF)
          </button>
        </footer>
      </main>
    </div>
  );
}
