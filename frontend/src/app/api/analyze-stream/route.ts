import { NextRequest } from "next/server";

const BACKEND_URL = "https://9ai-2nd-team-app-service-b0h3evedgec0dtda.eastus-01.azurewebsites.net";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const text = searchParams.get("text") || "";
    const product_type = searchParams.get("product_type") || "general_cosmetic";
    const user_id = searchParams.get("user_id") || "";

    if (!text) {
      return new Response(JSON.stringify({ error: "텍스트가 없습니다." }), {
        status: 400,
      });
    }

    const params = new URLSearchParams({ text, product_type, user_id });

    // 파이썬 백엔드(FastAPI 등)로 스트리밍 요청 전달
    const backendRes = await fetch(
      `${BACKEND_URL}/analyze/stream?${params.toString()}`,
      {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        cache: 'no-store',
      },
    );

    if (!backendRes.ok || !backendRes.body) {
      return new Response(JSON.stringify({ error: "백엔드 연결 실패" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 백엔드의 스트림 데이터를 브라우저로 그대로 전달 (Proxy)
    return new Response(backendRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // 스트리밍 끊김 방지
      },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "서버 오류" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

