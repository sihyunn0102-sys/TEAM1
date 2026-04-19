import { NextRequest } from "next/server";

const BACKEND_URL = "http://127.0.0.1:8080";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const text = searchParams.get("text") || "";
    const product_type = searchParams.get("product_type") || "general_cosmetic";

    const params = new URLSearchParams({ text, product_type });
    const backendRes = await fetch(
      `${BACKEND_URL}/analyze/stream?${params.toString()}`,
      {
        method: "GET",
        headers: { Accept: "text/event-stream" },
      },
    );

    if (!backendRes.ok || !backendRes.body) {
      return new Response(JSON.stringify({ error: "백엔드 연결 실패" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
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
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
