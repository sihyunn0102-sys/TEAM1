"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface AnalysisStep {
  step: number;
  message: string;
  status: "pending" | "loading" | "complete" | "error";
}

export default function ResultPage() {
  const router = useRouter();
  const [text, setText] = useState<string>("");
  const [productType, setProductType] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [result, setResult] = useState<any>(null);
  
  const [steps, setSteps] = useState<AnalysisStep[]>([
    { step: 1, message: "L1: 광고 금지 표현 검사 중...", status: "pending" },
    { step: 2, message: "L2: 관련 법령 데이터 조회 중...", status: "pending" },
    { step: 3, message: "L3: 위반 여부 정밀 분석 중...", status: "pending" },
    { step: 4, message: "L4: 대체 문구 생성 및 교정 중...", status: "pending" },
    { step: 5, message: "L5: 최종 보고서 작성 중...", status: "pending" },
  ]);

  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const storedText = sessionStorage.getItem("analyzeText");
    const storedType = sessionStorage.getItem("analyzeProductType");

    if (!storedText) {
      alert("분석할 데이터가 없습니다. 메인 페이지로 이동합니다.");
      router.push("/");
      return;
    }

    setText(storedText);
    setProductType(storedType || "general_cosmetic");
  }, [router]);

  useEffect(() => {
    if (!text || !isAnalyzing) return;

    const params = new URLSearchParams({
      text: text,
      product_type: productType,
    });

    // 핵심 수정: 호출 주소를 파일 위치와 동일하게 '/api/analyze-stream'으로 고정
    const es = new EventSource(`/api/analyze-stream?${params.toString()}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.step) {
          setSteps((prev) =>
            prev.map((s) => {
              if (s.step < data.step) return { ...s, status: "complete" };
              if (s.step === data.step) return { ...s, status: "loading" };
              return s;
            })
          );
        }

        if (data.result) {
          setResult(data.result);
          setSteps((prev) => prev.map((s) => ({ ...s, status: "complete" })));
          setIsAnalyzing(false);
          es.close();
        }
      } catch (err) {
        console.error("데이터 파싱 에러:", err);
      }
    };

    es.onerror = (err) => {
      console.error("SSE 연결 에러:", err);
      setSteps((prev) =>
        prev.map((s) => (s.status === "loading" ? { ...s, status: "error" } : s))
      );
      setIsAnalyzing(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [text, productType, isAnalyzing]);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-8 text-center text-gray-800">광고 문구 분석중</h1>

        <div className="bg-white rounded-2xl shadow-sm p-6 border border-gray-100 mb-8">
          <div className="space-y-4">
            {steps.map((s) => (
              <div key={s.step} className="flex items-center gap-4">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${s.status === "complete" ? "bg-green-500 text-white" : 
                    s.status === "loading" ? "bg-blue-500 text-white animate-pulse" : 
                    s.status === "error" ? "bg-red-500 text-white" : "bg-gray-200 text-gray-500"}`}
                >
                  {s.status === "complete" ? "✓" : s.step}
                </div>
                <span className={`text-sm ${s.status === "loading" ? "font-bold text-blue-600" : "text-gray-600"}`}>
                  {s.message}
                </span>
                {s.status === "loading" && (
                  <div className="ml-auto w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            ))}
          </div>
        </div>

        {!isAnalyzing && result && (
          <div className="bg-white rounded-2xl shadow-md p-8 border border-blue-100 animate-in fade-in duration-500">
            <h2 className="text-xl font-bold mb-4 text-blue-800">분석 결과 리포트</h2>
            <div className="prose prose-blue max-w-none">
              <div className="p-4 bg-blue-50 rounded-xl text-gray-700 whitespace-pre-wrap">
                {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
              </div>
            </div>
            <button 
              onClick={() => router.push("/")}
              className="w-full mt-6 py-3 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-900 transition-all"
            >
              다른 문구 분석하기
            </button>
          </div>
        )}

        {!isAnalyzing && !result && (
          <div className="text-center">
            <p className="text-red-500 mb-4">분석 중 오류가 발생했습니다. 서버 연결을 확인해주세요.</p>
            <button 
              onClick={() => router.push("/")}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg"
            >
              다시 시도하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
