import { NextRequest } from "next/server";

// Azure Portal의 Configuration에 등록한 그 주소입니다.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const text = searchParams.get("text") || "";
    const product_type = searchParams.get("product_type") || "general_cosmetic";

    if (!text) {
      return new Response(JSON.stringify({ error: "텍스트가 없습니다." }), { status: 400 });
    }

    const params = new URLSearchParams({ text, product_type });
    
    // 파이썬 백엔드(FastAPI 등)로 스트리밍 요청 전달
    const backendRes = await fetch(
      `${BACKEND_URL}/analyze/stream?${params.toString()}`,
      {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        cache: "no-store",
      }
    );

    if (!backendRes.ok || !backendRes.body) {
      console.error("백엔드 연결 실패:", backendRes.statusText);
      return new Response(JSON.stringify({ error: "분석 서버 연결 실패" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 백엔드의 스트림 데이터를 브라우저로 그대로 전달 (Proxy)
    return new Response(backendRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // 스트리밍 끊김 방지
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "서버 오류 발생";
    console.error("API Route 에러:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
