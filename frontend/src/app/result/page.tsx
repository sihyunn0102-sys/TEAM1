"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function ResultPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [resultData, setResultData] = useState<any>(null);

  useEffect(() => {
    const fetchMockData = async () => {
      // 1. AI 분석 연출 (2.5초 대기)
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // 🚨 시현님이 목요일에 보내줄 가상의 데이터 (이게 통문장일 수도 있고 배열일 수도 있음)
      const rawDataFromBackend = {
        riskLevel: "High",
        // 상황 A: 시현님이 통문장으로 주는 경우
        original_sentence: "단 1회 사용만으로 안면 리프팅 100% 보장!",
        corrected_sentence: "꾸준한 사용으로 피부 탄력 개선에 도움을 줍니다.",
        // 상황 B: 시현님이 단어별 배열로 주는 경우 (이게 있으면 이걸 우선 사용)
        /* spellCheck: {
          original: [{ text: "단 1회", isError: true }, { text: " 사용", isError: false }],
          corrected: [{ text: "꾸준한", isFix: true }, { text: " 사용", isFix: false }]
        }, */
        suggestions: [
          {
            id: 1,
            text: "꾸준한 사용으로 피부 탄력 개선에 도움을 줄 수 있습니다.",
            tag: "가장 안전 🟢",
          },
          {
            id: 2,
            text: "피부 탄력 케어에 도움을 주는 성분이 함유되어 있습니다.",
            tag: "자연스러움 🟡",
          },
          {
            id: 3,
            text: "일시적인 피부 리프팅 효과를 경험해 보세요.",
            tag: "마케팅 강조 🔵",
          },
        ],
      };

      // 🛡️ [유경님의 방어 로직 시작]
      let processedSpellCheck = { original: [], corrected: [] };

      // 만약 시현님이 이미 '배열(spellCheck)'로 데이터를 잘 줬다면?
      if (rawDataFromBackend.spellCheck) {
        processedSpellCheck = rawDataFromBackend.spellCheck;
      }
      // 만약 '통문장'으로만 왔다면? -> 유경님이 만든 UI에서 쓸 수 있게 배열로 강제 변환!
      else {
        processedSpellCheck = {
          original: [
            {
              text: rawDataFromBackend.original_sentence || "데이터 없음",
              isError: true,
            },
          ],
          corrected: [
            {
              text: rawDataFromBackend.corrected_sentence || "데이터 없음",
              isFix: true,
            },
          ],
        };
      }

      // 최종적으로 우리 UI가 좋아하는 형식으로 세팅
      setResultData({
        ...rawDataFromBackend,
        spellCheck: processedSpellCheck,
      });

      setIsLoading(false);
    };

    fetchMockData();
  }, []);

  // 로딩 화면 (AI 스피어)
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white font-sans overflow-hidden">
        <div className="relative w-80 h-80 flex items-center justify-center">
          <div className="absolute w-full h-full bg-gradient-to-tr from-blue-400/20 to-purple-400/20 blur-[100px] animate-pulse"></div>
          <div className="relative w-48 h-48 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-full blur-[2px] shadow-[0_0_50px_rgba(59,130,246,0.3)] animate-morphing overflow-hidden">
            <div className="absolute inset-0 bg-white/10 backdrop-blur-sm opacity-50"></div>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[10px] font-black tracking-[0.3em] text-blue-700/60 uppercase mb-2">
              Analyzing
            </span>
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:0.2s]"></div>
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:0.4s]"></div>
            </div>
          </div>
        </div>
        <div className="mt-8 text-center z-10 px-6">
          <h2 className="text-2xl font-black text-zinc-900 tracking-tight">
            AI 광고 청정기 가동 중
          </h2>
          <p className="text-zinc-400 mt-2 font-medium">
            허위 광고 문구를 정화하고 있습니다...
          </p>
        </div>
        <style
          dangerouslySetInnerHTML={{
            __html: `
          @keyframes morphing {
            0% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(0deg); }
            50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; transform: rotate(180deg); }
            100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: rotate(360deg); }
          }
          .animate-morphing { animation: morphing 8s ease-in-out infinite; }
        `,
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center py-12 px-6">
      <main className="w-full max-w-5xl bg-white rounded-[40px] shadow-2xl border border-zinc-100 p-10 md:p-14">
        {/* 헤더 & 신호등 배지 */}
        <div className="flex justify-between items-end mb-12">
          <div className="text-left">
            <span className="text-blue-600 font-black text-xs tracking-widest uppercase mb-2 block font-bold">
              Analysis Report
            </span>
            <h1 className="text-4xl font-black text-zinc-900 tracking-tighter">
              분석 결과 리포트
            </h1>
          </div>
          {resultData.riskLevel === "High" && (
            <div className="bg-red-50 text-red-600 px-6 py-2 rounded-full font-black text-sm border border-red-100 flex items-center gap-2">
              <span className="w-2 h-2 bg-red-600 rounded-full animate-pulse"></span>
              위험 단계
            </div>
          )}
        </div>

        {/* 비포 애프터 비교 박스 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12 text-left">
          <div className="bg-zinc-50 rounded-[32px] p-8 border border-zinc-100 relative">
            <div className="absolute top-6 right-8 text-[10px] font-black text-red-300 tracking-widest uppercase">
              Before
            </div>
            <h4 className="text-zinc-400 font-bold text-sm mb-6">
              수정 전 위반 문구
            </h4>
            <div className="h-48 overflow-y-auto leading-relaxed text-lg text-zinc-600 pr-2">
              {resultData.spellCheck.original.map((chunk: any, i: number) => (
                <span
                  key={i}
                  className={
                    chunk.isError
                      ? "bg-red-100 text-red-700 px-1 rounded-md line-through decoration-red-300 decoration-2 mx-0.5"
                      : ""
                  }
                >
                  {chunk.text}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-blue-50/30 rounded-[32px] p-8 border border-blue-100/50 relative">
            <div className="absolute top-6 right-8 text-[10px] font-black text-blue-300 tracking-widest uppercase">
              After
            </div>
            <h4 className="text-blue-600 font-bold text-sm mb-6">
              AI 정화 완료
            </h4>
            <div className="h-48 overflow-y-auto leading-relaxed text-lg text-zinc-800 pr-2">
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

        {/* 추천안 카드 3개 */}
        <div className="mb-12 text-left">
          <h3 className="font-bold text-zinc-800 flex items-center gap-2 mb-6">
            ✨ 다른 AI 교정 제안 둘러보기{" "}
            <span className="text-sm font-normal text-zinc-400">
              (클릭하여 복사)
            </span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {resultData.suggestions.map((item: any) => (
              <div
                key={item.id}
                className="p-6 bg-white border border-zinc-100 rounded-[28px] hover:border-blue-200 hover:shadow-xl transition-all cursor-pointer group flex flex-col justify-between h-full"
              >
                <span className="text-[10px] font-black tracking-widest text-zinc-400 group-hover:text-blue-500 transition-colors uppercase border border-zinc-100 rounded-full px-3 py-1 inline-block w-fit">
                  {item.tag}
                </span>
                <p className="mt-4 text-zinc-700 font-medium leading-relaxed">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* 내비게이션 버튼 */}
        <div className="flex gap-4">
          <Link
            href="/upload"
            className="flex-1 h-16 bg-zinc-900 text-white rounded-2xl flex items-center justify-center font-bold hover:bg-zinc-800 transition-all text-lg shadow-lg"
          >
            새 이미지 검사
          </Link>
          <Link
            href="/"
            className="px-10 h-16 border-2 border-zinc-100 text-zinc-400 rounded-2xl flex items-center justify-center font-bold hover:bg-zinc-50 transition-all text-lg"
          >
            홈
          </Link>
        </div>
      </main>
    </div>
  );
}
