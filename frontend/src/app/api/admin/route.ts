import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://9ai-2nd-team-app-service-b0h3evedgec0dtda.eastus-01.azurewebsites.net";

export async function GET(req: NextRequest) {
  try {
    const password = req.headers.get("x-admin-password") || "";
    const res = await fetch(`${BACKEND_URL}/admin/stats`, {
      headers: { "X-Admin-Password": password },
      cache: "no-store",
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "서버 오류" },
      { status: 500 },
    );
  }
}
