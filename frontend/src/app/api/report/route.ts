import { NextRequest } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://9ai-2nd-team-app-service-b0h3evedgec0dtda.eastus-01.azurewebsites.net";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const backendRes = await fetch(`${BACKEND_URL}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!backendRes.ok) {
      const err = await backendRes.json().catch(() => ({}));
      return new Response(JSON.stringify(err), {
        status: backendRes.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const pdfBuffer = await backendRes.arrayBuffer();
    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=adguard_report.pdf",
      },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "서버 오류" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
