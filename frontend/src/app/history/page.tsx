import Link from "next/link";

export default function HistoryPage() {
  // 임시 데이터
  const historyItems = [
    { id: 1, date: "2026-04-14", title: "수분 크림 광고", status: "🔴 위험" },
    { id: 2, date: "2026-04-13", title: "다이어트 보조제", status: "🟡 주의" },
    { id: 3, date: "2026-04-12", title: "비타민 영양제", status: "🟢 안전" },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 p-8 font-sans">
      <main className="flex flex-col gap-6 bg-white p-10 rounded-3xl shadow-xl border border-zinc-200 max-w-2xl w-full">
        <h1 className="text-2xl font-bold text-zinc-900 mb-4">📜 검사 이력</h1>

        <div className="space-y-3">
          {historyItems.map((item) => (
            <div
              key={item.id}
              className="flex justify-between items-center p-4 border border-zinc-100 rounded-2xl hover:bg-zinc-50 transition-colors cursor-pointer"
            >
              <div>
                <div className="font-bold text-zinc-800">{item.title}</div>
                <div className="text-sm text-zinc-400">{item.date}</div>
              </div>
              <span className="font-bold">{item.status}</span>
            </div>
          ))}
        </div>

        <Link
          href="/"
          className="mt-6 text-center text-zinc-500 hover:text-zinc-800 font-medium transition-colors"
        >
          ← 메인으로 돌아가기
        </Link>
      </main>
    </div>
  );
}
