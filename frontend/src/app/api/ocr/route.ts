import { NextRequest, NextResponse } from "next/server";

const ENDPOINT = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT!;
const API_KEY = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY!;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    }

    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/pdf",
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "지원하지 않는 파일 형식입니다." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();

    // Azure Document Intelligence는 표준 MIME 타입만 허용.
    // 일부 브라우저/운영체제에서 .jpg 파일이 "image/jpg"(비표준)로 전달되는 경우가 있어,
    // 이를 표준 MIME 타입인 "image/jpeg"로 정규화해줘야 OCR 요청이 성공함.
    let contentType = file.type || "application/octet-stream";
    if (contentType === "image/jpg") {
      contentType = "image/jpeg";
    }

    const analyzeRes = await fetch(
      `${ENDPOINT}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": API_KEY,
          "Content-Type": contentType,
        },
        body: arrayBuffer,
      },
    );

    if (!analyzeRes.ok) {
      const errorText = await analyzeRes.text();
      return NextResponse.json(
        { error: `OCR 요청 실패: ${analyzeRes.status} ${errorText}` },
        { status: 500 },
      );
    }

    const operationUrl = analyzeRes.headers.get("Operation-Location");
    if (!operationUrl) {
      return NextResponse.json(
        { error: "Operation-Location 헤더가 없습니다." },
        { status: 500 },
      );
    }

    let result: any;

    for (let i = 0; i < 60; i++) {
      const pollRes = await fetch(operationUrl, {
        headers: {
          "Ocp-Apim-Subscription-Key": API_KEY,
        },
      });

      result = await pollRes.json();

      if (result.status === "succeeded") {
        const lines =
          result.analyzeResult?.pages
            ?.flatMap((page: any) => page.lines || [])
            ?.map((line: any) => line.content) || [];

        return NextResponse.json({
          text: lines.join(" "),
          raw: result,
        });
      }

      if (result.status === "failed") {
        return NextResponse.json(
          { error: "OCR 분석 실패", raw: result },
          { status: 500 },
        );
      }

      await new Promise((res) => setTimeout(res, 1000));
    }

    return NextResponse.json({ error: "OCR polling timeout" }, { status: 504 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "서버 오류" },
      { status: 500 },
    );
  }
}
