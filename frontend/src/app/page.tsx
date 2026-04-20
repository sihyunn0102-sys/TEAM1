"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ShieldCheck, Zap, History, AlertCircle, CheckCircle2, ChevronRight } from "lucide-react";

export default function Home() {
  // 애니메이션 변수 정의
  const fadeInUp = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.6 }
  };

  return (
    <div className="flex flex-col items-center bg-white overflow-hidden">
      {/* 1. Hero Section: 비주얼 및 가독성 강화 */}
      <section className="relative w-full py-24 md:py-40 flex flex-col items-center text-center px-4">
        {/* 배경 장식 요소 */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10 opacity-10">
          <div className="absolute top-20 left-1/4 w-72 h-72 bg-blue-400 rounded-full blur-[120px]" />
          <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-indigo-300 rounded-full blur-[120px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <span className="inline-block px-4 py-1.5 mb-6 text-sm font-semibold text-blue-600 bg-blue-50 rounded-full">
            AI 기반 광고 심의 솔루션
          </span>
          <h1 className="text-4xl md:text-7xl font-extrabold tracking-tight text-gray-900 mb-8 leading-[1.1]">
            광고 심의, <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              더 깨끗하고 확실하게
            </span>
          </h1>
          <p className="text-lg md:text-xl text-gray-600 max-w-3xl mb-12 leading-relaxed">
            게시 전에 AI가 먼저 검토합니다. 화장품법, 식약처, 공정위 기준을 <br className="hidden md:block" />
            실시간으로 탐지하여 <span className="font-bold text-red-500">최대 500만원의 과태료</span> 리스크를 방지하세요.
          </p>
        </motion.div>

        <motion.div 
          className="flex flex-col sm:flex-row gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <Link
            href="/upload"
            className="group flex items-center justify-center rounded-xl bg-blue-600 px-10 py-5 text-lg font-bold text-white transition-all hover:bg-blue-700 hover:shadow-xl active:scale-95"
          >
            지금 시작하기
            <ChevronRight className="ml-2 w-5 h-5 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            href="/history"
            className="flex items-center justify-center rounded-xl border border-gray-200 bg-white px-10 py-5 text-lg font-bold text-gray-700 transition-all hover:bg-gray-50 hover:border-gray-300"
          >
            이전 검사 기록
          </Link>
        </motion.div>
      </section>

      {/* 2. Before & After Section: 신뢰도 증명 */}
      <section className="w-full py-24 bg-white px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeInUp} className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">단속 사례로 보는 분석 결과</h2>
            <p className="text-gray-500">AI가 어떻게 위반 문구를 찾아내고 수정안을 제시하는지 확인해보세요.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Before Card */}
            <motion.div 
              {...fadeInUp}
              className="p-8 rounded-3xl bg-red-50 border border-red-100 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 px-4 py-2 bg-red-500 text-white text-sm font-bold rounded-bl-2xl">
                수정 전 (위반 사례)
              </div>
              <div className="flex items-center gap-2 mb-4 text-red-600 font-bold text-lg">
                <AlertCircle className="w-6 h-6" /> 위반 의심 문구
              </div>
              <div className="bg-white p-6 rounded-2xl border border-red-200 text-gray-800 leading-relaxed italic shadow-sm">
                &quot;바르기만 해도 <span className="bg-red-200 px-1 rounded text-red-700 font-bold underline decoration-2">피부 재생 100% 보장</span>, <br />
                기미 주근깨가 <span className="bg-red-200 px-1 rounded text-red-700 font-bold underline decoration-2">완벽히 박멸</span>됩니다.&quot;
              </div>
              <p className="mt-6 text-sm text-red-600 font-medium">
                * 과대광고: 의학적 효능 표방 및 절대적 표현 사용 금지 (화장품법 제13조 위반)
              </p>
            </motion.div>

            {/* After Card */}
            <motion.div 
              {...fadeInUp}
              className="p-8 rounded-3xl bg-blue-50 border border-blue-100 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 px-4 py-2 bg-blue-500 text-white text-sm font-bold rounded-bl-2xl">
                광고청정기 제안
              </div>
              <div className="flex items-center gap-2 mb-4 text-blue-600 font-bold text-lg">
                <CheckCircle2 className="w-6 h-6" /> 안전한 수정안
              </div>
              <div className="bg-white p-6 rounded-2xl border border-blue-200 text-gray-800 leading-relaxed shadow-sm">
                &quot;사용 후 <span className="text-blue-600 font-bold">피부 컨디션 개선에 도움</span>을 주며, <br />
                기미와 주근깨를 <span className="text-blue-600 font-bold">효과적으로 관리</span>해줍니다.&quot;
              </div>
              <p className="mt-6 text-sm text-blue-600 font-medium">
                ✓ 권장 표현: 개선에 도움, 관리, 완화 등의 표현 사용
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 3. Service Features Section: 아이콘 및 레이아웃 개선 */}
      <section className="w-full py-24 bg-gray-50 px-8">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeInUp} className="text-center mb-16 font-bold text-3xl">
            간편하고 강력한 기능
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <motion.div 
              {...fadeInUp}
              whileHover={{ y: -10 }}
              className="bg-white p-10 rounded-[2.5rem] shadow-sm flex flex-col items-center text-center"
            >
              <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 mb-8">
                <ShieldCheck className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold mb-4 text-gray-900">AI 기반 정밀 분석</h3>
              <p className="text-gray-500 leading-relaxed">
                최신 법령 데이터를 학습한 AI가 이미지와 텍스트 속 미세한 위반 요소까지 놓치지 않습니다.
              </p>
            </motion.div>

            <motion.div 
              {...fadeInUp}
              transition={{ delay: 0.2 }}
              whileHover={{ y: -10 }}
              className="bg-white p-10 rounded-[2.5rem] shadow-sm flex flex-col items-center text-center"
            >
              <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 mb-8">
                <Zap className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold mb-4 text-gray-900">30초 안에 수정안까지</h3>
              <p className="text-gray-500 leading-relaxed">
                단순히 틀린 곳을 찾는 것을 넘어, 법적 기준을 준수하는 최적의 대안 문구를 즉시 제안합니다.
              </p>
            </motion.div>

            <motion.div 
              {...fadeInUp}
              transition={{ delay: 0.4 }}
              whileHover={{ y: -10 }}
              className="bg-white p-10 rounded-[2.5rem] shadow-sm flex flex-col items-center text-center"
            >
              <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 mb-8">
                <History className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold mb-4 text-gray-900">히스토리 관리</h3>
              <p className="text-gray-500 leading-relaxed">
                팀 전체의 검토 기록을 안전하게 보관하여 마케팅 자산으로 활용하고 일관된 톤앤매너를 유지하세요.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 4. Bottom CTA: 일관성 있는 마무리 */}
      <section className="w-full py-32 text-center px-4 overflow-hidden relative">
        <motion.div {...fadeInUp} className="max-w-4xl mx-auto relative z-10">
          <h2 className="text-3xl md:text-5xl font-bold mb-8 text-gray-900 leading-tight">
            과태료 걱정 없는 마케팅,<br />지금 광고청정기와 시작하세요.
          </h2>
          <p className="text-xl text-gray-500 mb-12">
            이미 500개 이상의 브랜드가 광고청정기로 리스크를 예방하고 있습니다.
          </p>
          <Link
            href="/upload"
            className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-12 py-6 text-xl font-bold text-white transition-all hover:bg-black hover:shadow-2xl active:scale-95"
          >
            무료로 분석 시작하기
          </Link>
        </motion.div>
        
        {/* 장식용 원형 소스 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border border-gray-100 rounded-full -z-10" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-gray-50 rounded-full -z-10" />
      </section>
    </div>
  );
}
