import { NextRequest } from "next/server";

const BACKEND_URL = "https://9ai-2nd-team-app-service-b0h3evedgec0dtda.eastus-01.azurewebsites.net";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const user_id = searchParams.get("user_id") || "";
    const limit = searchParams.get("limit") || "20";

    const params = new URLSearchParams({ user_id, limit });
    const res = await fetch(`${BACKEND_URL}/history?${params.toString()}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      let detail = "히스토리 조회 실패";
      try {
        const body = await res.json();
        detail = body.detail || body.error || detail;
      } catch {}
      return new Response(JSON.stringify({ error: detail }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "서버 오류" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
