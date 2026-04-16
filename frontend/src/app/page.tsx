import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center">
      {/* Hero Section */}
      <section className="w-full py-20 md:py-32 flex flex-col items-center text-center">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-gray-900 mb-6">
          광고 심의, <br className="md:hidden" />
          <span className="text-blue-600">더 깨끗하고 확실하게</span>
        </h1>
        <p className="text-lg md:text-xl text-gray-600 max-w-2xl mb-10 px-4">
          광고청정기는 AI 기술을 활용하여 광고 위반 요소를 실시간으로 탐지하고
          <br />
          안전한 광고 문화를 만들어갑니다. 복잡한 심의 기준을 한 번에
          확인하세요.
        </p>
        <div className="flex gap-4">
          <Link
            href="/upload"
            className="rounded-full bg-blue-600 px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-blue-700 hover:shadow-lg"
          >
            지금 시작하기
          </Link>
          <Link
            href="/history"
            className="rounded-full border border-gray-300 bg-white px-8 py-4 text-lg font-semibold text-gray-700 transition-all hover:bg-gray-50"
          >
            기록 확인하기
          </Link>
        </div>
      </section>

      {/* Service Features Section */}
      <section className="w-full py-20 bg-gray-50 rounded-3xl px-8">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center text-3xl mb-6">
              🔍
            </div>
            <h3 className="text-xl font-bold mb-3">정밀 탐지</h3>
            <p className="text-gray-500 leading-relaxed">
              이미지와 텍스트 속의 광고 위반 문구를 <br /> AI가 정밀하게
              분석합니다.
            </p>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center text-3xl mb-6">
              ⚡
            </div>
            <h3 className="text-xl font-bold mb-3">빠른 결과</h3>
            <p className="text-gray-500 leading-relaxed">
              업로드와 동시에 결과를 확인하여 <br /> 마케팅 효율을 높일 수
              있습니다.
            </p>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center text-3xl mb-6">
              📁
            </div>
            <h3 className="text-xl font-bold mb-3">이력 관리</h3>
            <p className="text-gray-500 leading-relaxed">
              지난 검토 내역을 히스토리 페이지에서 <br /> 언제든 다시 조회할 수
              있습니다.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="w-full py-24 text-center">
        <h2 className="text-3xl font-bold mb-8">준비되셨나요?</h2>
        <p className="text-gray-600 mb-10">
          지금 바로 광고 이미지를 업로드하고 위반 여부를 확인해 보세요.
        </p>
        <Link
          href="/upload"
          className="text-blue-600 font-bold text-xl hover:underline"
        >
          광고 분석하러 가기 &rarr;
        </Link>
      </section>
    </div>
  );
}
