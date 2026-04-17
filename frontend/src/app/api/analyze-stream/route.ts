import { NextRequest } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, product_type } = body;

    const params = new URLSearchParams({ text, product_type });
    const backendRes = await fetch(
      `${BACKEND_URL}/analyze/stream?${params.toString()}`,
      {
        method: "GET",
        headers: { Accept: "text/event-stream" },
      }
    );

    if (!backendRes.ok || !backendRes.body) {
      return new Response(
        JSON.stringify({ error: "백엔드 연결 실패" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 백엔드 SSE 스트림을 프론트로 그대로 전달
    return new Response(backendRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "서버 오류" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
