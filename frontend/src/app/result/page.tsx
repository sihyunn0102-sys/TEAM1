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

function buildOriginalChunks(copy: string, violations: any[]) {
  if (!copy) return [];
  // 위반 정보를 청크에 담도록 타입 확장
  let chunks: { text: string; isError: boolean; violation?: any }[] = [
    { text: copy, isError: false },
  ];

  for (const v of violations) {
    const phrase: string = (
      v.phrase ||
      v.violation_word ||
      v.keyword ||
      ""
    ).trim();
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
      if (idx > 0)
        next.push({ text: chunk.text.slice(0, idx), isError: false });
      // 에러 텍스트에 violation(에러 이유) 데이터 저장
      next.push({ text: phrase, isError: true, violation: v });
      if (idx + phrase.length < chunk.text.length) {
        next.push({
          text: chunk.text.slice(idx + phrase.length),
          isError: false,
        });
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
    const originalChunks = buildOriginalChunks(copy, violations);
    const safeRewrite =
      rewrites.find((r: any) => r.style === "safe") ?? rewrites[0];

    if (safeRewrite) setEditedText(safeRewrite.text);

    setResultData({
      riskLevel: toRiskLevel(backend.final_verdict),
      explanation: backend.explanation ?? "",
      spellCheck: { original: originalChunks },
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

  // 💡 여기서부터
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
                  <p
                    className="text-[10px] mt-2 bg-white/10 p-2 rounded-xl animate-fade-in"
                    dangerouslySetInnerHTML={{ __html: phase.detail }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <style
          dangerouslySetInnerHTML={{
            __html: `
          @keyframes sphereMorph {
            0% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(0deg) scale(1); }
            50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; transform: rotate(180deg) scale(1.1); }
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

  // 💡 여기서부터 return 다음에 괄호 `(`가 정상적으로 열려 있습니다.
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-6">
      <main className="w-full max-w-5xl bg-white rounded-[40px] shadow-sm border border-gray-100 p-8 md:p-14 relative overflow-hidden">
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

        <div className="mb-10 p-6 bg-blue-50/30 rounded-3xl border flex gap-3 text-left">
          <Info size={18} className="text-blue-500 shrink-0 mt-1" />
          <p className="text-sm text-gray-700 leading-relaxed">
            {resultData.explanation}
          </p>
        </div>

        {/* 🛠️ 정돈된 Before/After 섹션 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12 text-left">
          {/* 🔴 Before: 빨간색 취소선 및 툴팁 */}
          <div className="bg-zinc-50 rounded-[32px] p-8 border border-zinc-100 relative">
            <span className="text-[10px] text-gray-400 font-bold bg-gray-200 px-2 py-0.5 rounded-sm mb-2 block w-fit">
              AD
            </span>
            <div className="bg-red-500 text-white rounded-full px-4 py-1.5 w-fit mb-6 text-sm font-bold">
              수정 전 위반 문구
            </div>
            <div className="h-48 overflow-y-auto leading-relaxed text-lg text-zinc-600 pr-2 pt-8">
              {resultData.spellCheck.original.map((chunk: any, i: number) =>
                chunk.isError ? (
                  <span
                    key={i}
                    className="relative inline-block mx-1 group cursor-help mt-4"
                  >
                    {/* 위반 타입 라벨 */}
                    <span className="absolute -top-6 left-0 bg-red-100 text-red-600 border border-red-200 text-[10px] font-black px-2 py-0.5 rounded shadow-sm whitespace-nowrap z-10 flex items-center gap-1">
                      <AlertCircle size={10} />
                      {chunk.violation?.type || "금지어/주의어"}
                    </span>
                    {/* 연한 빨간색 배경 하이라이트 + 텍스트 붉은색 + 살짝 둥근 모서리 */}
                    <span className="text-red-600 font-extrabold bg-red-100 px-1.5 py-0.5 rounded-md underline decoration-red-500 underline-offset-4">
                      {chunk.text}
                    </span>
                    {/* 호버 시 뜨는 상세 설명 */}
                    <span className="absolute bottom-full left-0 mb-8 hidden group-hover:block w-max max-w-xs bg-gray-800 text-white text-xs px-3 py-2 rounded-lg shadow-xl z-20">
                      {chunk.violation?.explanation ||
                        "수정이 필요한 문구입니다."}
                    </span>
                  </span>
                ) : (
                  <span key={i}>{chunk.text}</span>
                ),
              )}
            </div>
          </div>

          {/* 🔵 After: 흰색 배경 테마 */}
          <div className="bg-blue-50/30 rounded-[32px] p-8 relative border border-blue-100">
            <div className="absolute top-6 right-8 text-[10px] font-black text-blue-300 tracking-widest uppercase">
              After
            </div>
            <div className="bg-blue-600 text-white rounded-full px-4 py-1.5 w-fit mb-6 text-sm font-bold">
              AI 정화 완료
            </div>
            <textarea
              readOnly
              value={editedText}
              className="w-full h-48 bg-white text-zinc-800 px-4 py-3 rounded-xl font-bold shadow-sm resize-none outline-none leading-relaxed text-lg pr-2 border border-blue-50"
            />
          </div>
        </div>

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
                  <span className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-md">
                    {item.tag} 추천 문구 {index + 1}
                  </span>
                  <p className="mt-4 text-zinc-700 font-medium leading-relaxed group-hover:text-blue-700">
                    {item.text}
                  </p>
                  <ChevronDown
                    size={18}
                    className="text-zinc-300 self-end mt-2"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

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
      </main>
    </div>
  );
}
