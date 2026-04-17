"""
app/main.py  ── FastAPI 진입점
────────────────────────────────────────────────────────────
AdGuard 백엔드 API 서버.
HTTP 요청만 처리하며, 실제 AI 로직은 pipeline/ Cascade에 위임합니다.

엔드포인트:
  [분석]
  GET  /health              : 서버 상태 확인
  POST /upload              : 이미지·PDF Blob 업로드 → blob_url 반환
  POST /analyze/text        : 텍스트 광고 검수 (L0~L5 Cascade)
  POST /analyze/image       : 이미지·PDF 광고 검수 (OCR → Cascade)
  GET  /analyze/stream      : 텍스트 광고 검수 SSE 실시간 진행 상황
  GET  /result/{task_id}    : 판정 결과 조회 (Table Storage)
  GET  /history             : 판정 이력 목록 조회

  [솔루션]
  POST /rewrite             : L4 단독 재요청 (이미 판정된 카피 재수정)
  POST /feedback            : 사용자가 선택한 수정안 저장 (데이터 플라이휠)

  [리포트]
  GET  /report/{task_id}    : PDF 리포트 다운로드

실행:
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Swagger UI: http://localhost:8000/docs
"""

from __future__ import annotations
import sys
import uuid
import os
import asyncio
import tempfile
import logging
import json
from datetime import datetime, timezone
from pathlib import Path

# 루트 디렉터리를 sys.path에 추가 (report_generator 등 루트 모듈 임포트용)
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")   # .env를 다른 모든 import 전에 로드

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.exceptions import HTTPException as FastAPIHTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse

from app.schemas.request import TextRequest, FeedbackRequest
from app.schemas.response import AnalyzeResponse
from app.clients.storage_client import get_blob_client, get_table_client
from app.clients.docintel_client import get_document_client
from pipeline.cascade import AdGuardCascade
from pipeline.product_context import ProductContext, ProductType

logger = logging.getLogger(__name__)

# ── 앱 초기화 ──────────────────────────────────────────────────────────
app = FastAPI(
    title="AdGuard API",
    version="1.0.0",
    description="화장품 광고 허위·과장 표현 자동 검수 API (5-Layer Cascade)",
)

# ── CORS ───────────────────────────────────────────────────────────────
# 개발 환경 전체 허용. 프로덕션 배포 시 allow_origins를 도메인으로 제한 필요
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 보안 헤더 미들웨어 ────────────────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

# ── 전역 에러 핸들러 ──────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, FastAPIHTTPException):
        raise exc
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"error": str(exc), "code": 500})

# ── Cascade 싱글톤 (앱 시작 시 1회 로드) ─────────────────────────────
cascade: AdGuardCascade | None = None

@app.on_event("startup")
async def startup_event():
    global cascade
    cascade = AdGuardCascade(
        judge_prompt="grounded",
        rewriter_prompt="v3_dynamic",
        max_retries=2,
    )
    logger.info("AdGuardCascade 로드 완료")


# ── 공통 유틸 ─────────────────────────────────────────────────────────

def _make_product_context(req: TextRequest) -> ProductContext:
    """TextRequest → ProductContext 변환."""
    try:
        product_type = ProductType(req.product_type)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=(
                f"잘못된 product_type: '{req.product_type}'. "
                "허용: general_cosmetic, functional_cosmetic, pharmaceutical"
            ),
        )
    return ProductContext(
        product_type=product_type,
        certification_no=req.certification_no,
        certified_claims=req.certified_claims,
    )


def _save_history(task_id: str, text: str, result: dict) -> None:
    """판정 결과를 Azure Table Storage history 테이블에 저장합니다."""
    try:
        table = get_table_client("history")
        entity = {
            "PartitionKey": "history",
            "RowKey": task_id,
            "text": text[:500],
            # cascade.check()는 final_verdict 반환 → verdict 필드로 저장
            "verdict": result.get("final_verdict", result.get("verdict", "")),
            "risk_summary": result.get("explanation", result.get("risk_summary", "")),
            "sponsored_missing": str(result.get("sponsored_missing", False)),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            # PDF 리포트 생성용 전체 결과 (최대 32000자)
            "full_result": json.dumps(result, ensure_ascii=False)[:32000],
        }
        table.create_entity(entity)
    except Exception as e:
        logger.warning(f"Table Storage 저장 오류 (판정 결과에는 영향 없음): {e}")


# ── SSE 이벤트 포맷 헬퍼 ─────────────────────────────────────────────
def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ════════════════════════════════════════════════════════════════════════
#  엔드포인트
# ════════════════════════════════════════════════════════════════════════

# ── GET /health ────────────────────────────────────────────────────────
@app.get("/health", tags=["system"])
def health():
    """서버 정상 작동 여부 확인. 배포 직후 첫 번째로 호출하세요."""
    return {
        "status": "ok",
        "cascade_loaded": cascade is not None,
        "version": "1.0.0",
    }


# ── POST /upload ────────────────────────────────────────────────────────
@app.post("/upload", tags=["analyze"])
async def upload_file(file: UploadFile = File(...)):
    """
    이미지·PDF 파일을 Azure Blob Storage(user-uploads/)에 업로드합니다.
    반환된 blob_url을 /analyze/image에서 사용할 수 있습니다.
    Blob lifecycle policy에 의해 24시간 후 자동 삭제됩니다.
    """
    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix not in (".jpg", ".jpeg", ".png", ".pdf"):
        raise HTTPException(status_code=400, detail="jpg, png, pdf 파일만 허용됩니다.")

    blob_name = f"{uuid.uuid4()}{suffix}"
    data = await file.read()

    try:
        container = get_blob_client("user-uploads")
        container.upload_blob(name=blob_name, data=data, overwrite=True)
        blob_url = f"{container.url}/{blob_name}"
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Blob 업로드 오류: {e}")

    return {"blob_url": blob_url, "blob_name": blob_name}


# ── POST /analyze/text ────────────────────────────────────────────────
@app.post("/analyze/text", tags=["analyze"])
async def analyze_text(req: TextRequest):
    """
    텍스트 광고를 L0 Router → L1~L5 Cascade로 검수합니다.

    product_type:
      - general_cosmetic    : 일반 화장품 (기본, 엄격 기준)
      - functional_cosmetic : 기능성 화장품 (심사 통과 효능 완화)
      - pharmaceutical      : 의약품 (범위 밖, 즉시 out_of_scope 반환)
    """
    if cascade is None:
        raise HTTPException(status_code=503, detail="Cascade not initialized")

    task_id = str(uuid.uuid4())
    ctx = _make_product_context(req)

    result = cascade.check(
        req.text,
        context=ctx,
        skip_l3_if_hard_block=True,
        run_rewriter=True,
    )

    _save_history(task_id, req.text, result)
    return {"task_id": task_id, **result}


# ── GET /analyze/stream ── SSE 실시간 진행 상황 ───────────────────────
@app.get("/analyze/stream", tags=["analyze"])
async def analyze_stream(text: str, product_type: str = "general_cosmetic"):
    """
    텍스트 광고를 L1~L5 Cascade로 검수하며 단계별 진행 상황을 SSE로 전송합니다.

    이벤트 종류:
      - progress : 현재 단계 진행 중 { step, message, percent }
      - result   : 최종 분석 결과 전체
      - error    : 오류 발생 { message }
    """
    if cascade is None:
        async def err():
            yield _sse("error", {"message": "Cascade not initialized"})
        return StreamingResponse(err(), media_type="text/event-stream")

    try:
        product_type_enum = ProductType(product_type)
    except ValueError:
        async def err():
            yield _sse("error", {"message": f"잘못된 product_type: {product_type}"})
        return StreamingResponse(err(), media_type="text/event-stream")

    ctx = ProductContext(product_type=product_type_enum)

    async def event_generator():
        task_id = str(uuid.uuid4())
        loop = asyncio.get_event_loop()

        try:
            # ── L1: Rule Engine ──────────────────────────────────────
            yield _sse("progress", {"step": "L1", "message": "금지 키워드를 검사하고 있습니다...", "percent": 10})
            await asyncio.sleep(0)
            l1 = await loop.run_in_executor(None, cascade.rule_engine.check, text)

            # ── L2: RAG 검색 ─────────────────────────────────────────
            yield _sse("progress", {"step": "L2", "message": "관련 법령과 판례를 검색하고 있습니다...", "percent": 30})
            await asyncio.sleep(0)
            l2 = await loop.run_in_executor(None, lambda: cascade.retriever.retrieve(text, top_k=5))

            # ── L3: AI 판정 ──────────────────────────────────────────
            yield _sse("progress", {"step": "L3", "message": "AI가 위반 여부를 판정하고 있습니다...", "percent": 55})
            await asyncio.sleep(0)
            l3 = await loop.run_in_executor(None, lambda: cascade.judge.judge(text, l2["chunks"], context=ctx))

            # verdict 결정
            l1_verdict = l1["verdict"]
            l3_verdict = l3.get("verdict", "caution")
            if l1_verdict == "hard_block" or l3_verdict == "hard_block":
                final = "hard_block"
            elif l1_verdict == "caution" or l3_verdict == "caution":
                final = "caution"
            else:
                final = l3_verdict

            # ── L4: 수정안 생성 ──────────────────────────────────────
            verified_rewrites = []
            if final != "safe":
                yield _sse("progress", {"step": "L4", "message": "수정 문구를 생성하고 있습니다...", "percent": 75})
                await asyncio.sleep(0)
                l4 = await loop.run_in_executor(None, lambda: cascade.rewriter.rewrite(text, l3, context=ctx))

                # ── L5: 수정안 검증 ──────────────────────────────────
                yield _sse("progress", {"step": "L5", "message": "수정 문구를 최종 검증하고 있습니다...", "percent": 90})
                await asyncio.sleep(0)
                l5 = await loop.run_in_executor(None, lambda: cascade.rejudge.verify(text, l3, l4, context=ctx))
                verified_rewrites = l5.get("verified_suggestions", [])

            # ── 완료 ─────────────────────────────────────────────────
            yield _sse("progress", {"step": "L5", "message": "분석이 완료되었습니다!", "percent": 100})
            await asyncio.sleep(0)

            explain_parts = []
            if l1["matched_keywords"]:
                kws = ", ".join((m.get("keyword") or m.get("matched", "?")) for m in l1["matched_keywords"][:3])
                explain_parts.append(f"[L1] 키워드 매칭: {kws}")
            if l3.get("reasoning"):
                explain_parts.append(f"[L3] {l3['reasoning']}")

            result = {
                "task_id": task_id,
                "copy": text,
                "final_verdict": final,
                "confidence": l3.get("confidence", 0.8),
                "explanation": " / ".join(explain_parts),
                "violations": l3.get("violations", []),
                "legal_basis": l3.get("legal_basis", []),
                "verified_rewrites": verified_rewrites,
            }

            _save_history(task_id, text, result)
            yield _sse("result", result)

        except Exception as e:
            logger.error(f"SSE 분석 오류: {e}", exc_info=True)
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── POST /analyze/image ────────────────────────────────────────────────
@app.post("/analyze/image", tags=["analyze"])
async def analyze_image(file: UploadFile = File(...)):
    """
    이미지·PDF 파일을 OCR로 텍스트 추출 후 L0~L5 Cascade로 검수합니다.

    처리 순서:
      1. 파일 형식 검증 (jpg / png / pdf)
      2. Azure Document Intelligence(prebuilt-layout)로 텍스트 추출
      3. 추출된 텍스트를 Cascade에 전달
    """
    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix not in (".jpg", ".jpeg", ".png", ".pdf"):
        raise HTTPException(status_code=400, detail="jpg, png, pdf 파일만 허용됩니다.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        client = get_document_client()
        with open(tmp_path, "rb") as f:
            poller = client.begin_analyze_document("prebuilt-layout", body=f)
            ocr_result = poller.result()

        lines = [line.content for page in ocr_result.pages for line in page.lines]
        text = " ".join(lines) if lines else ""
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR 오류: {e}")
    finally:
        os.unlink(tmp_path)

    if not text.strip():
        raise HTTPException(status_code=422, detail="이미지에서 텍스트를 추출하지 못했습니다.")

    if cascade is None:
        raise HTTPException(status_code=503, detail="Cascade not initialized")

    task_id = str(uuid.uuid4())
    result = cascade.check(text, run_rewriter=True)
    _save_history(task_id, text, result)
    return {"task_id": task_id, "ocr_text": text, **result}


# ── POST /rewrite ─────────────────────────────────────────────────────
@app.post("/rewrite", tags=["solution"])
async def rewrite(req: TextRequest):
    """
    이미 판정된 카피에 대해 L4 Rewriter만 단독 재호출합니다.
    (L3 판정 없이 caution으로 가정하고 L4만 실행)
    """
    if cascade is None:
        raise HTTPException(status_code=503, detail="Cascade not initialized")

    fake_judge = {
        "verdict": "caution",
        "confidence": 0.5,
        "violations": [],
        "legal_basis": [],
        "suggested_next_step": "사용자 요청으로 재수정",
    }
    result = cascade.rewriter.rewrite(req.text, fake_judge)
    return {
        "task_id": str(uuid.uuid4()),
        **result,
    }


# ── GET /result/{task_id} ─────────────────────────────────────────────
@app.get("/result/{task_id}", tags=["analyze"])
async def get_result(task_id: str):
    """
    task_id로 판정 결과를 조회합니다.
    Table Storage(history 테이블)에서 결과를 가져옵니다.
    """
    try:
        from azure.core.exceptions import ResourceNotFoundError
        table = get_table_client("history")
        entity = table.get_entity(partition_key="history", row_key=task_id)
        return {
            "task_id": task_id,
            "status": "completed",
            "verdict": entity.get("verdict", ""),
            "risk_summary": entity.get("risk_summary", ""),
            "sponsored_missing": entity.get("sponsored_missing", "False") == "True",
            "timestamp": entity.get("timestamp", ""),
        }
    except Exception as e:
        if "ResourceNotFound" in type(e).__name__:
            raise HTTPException(status_code=404, detail=f"task_id '{task_id}'를 찾을 수 없습니다.")
        raise HTTPException(status_code=500, detail=f"조회 오류: {e}")


# ── GET /history ──────────────────────────────────────────────────────
@app.get("/history", tags=["analyze"])
async def get_history(limit: int = 20):
    """판정 이력 목록을 최신순으로 반환합니다. limit으로 건수 제한 (기본 20건)."""
    try:
        table = get_table_client("history")
        entities = list(table.query_entities(
            query_filter="PartitionKey eq 'history'",
            results_per_page=limit,
        ))
        items = [
            {
                "task_id": e["RowKey"],
                "verdict": e.get("verdict", ""),
                "risk_summary": e.get("risk_summary", ""),
                "sponsored_missing": e.get("sponsored_missing", "False") == "True",
                "timestamp": e.get("timestamp", ""),
                "text_preview": e.get("text", "")[:100] if e.get("text") else None,
            }
            for e in entities
        ]
        return {"items": items, "total": len(items)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"이력 조회 오류: {e}")


# ── GET /report/{task_id} ─────────────────────────────────────────────
@app.get("/report/{task_id}", tags=["report"])
async def get_report(task_id: str):
    """
    판정 결과를 PDF 리포트로 생성해 다운로드합니다.
    포함 내용: 원문 · 위반 항목 · 수정안 3가지 · 참고 법령 · 면책 문구
    """
    try:
        from azure.core.exceptions import ResourceNotFoundError
        table = get_table_client("history")
        entity = table.get_entity(partition_key="history", row_key=task_id)
    except Exception as e:
        if "ResourceNotFound" in type(e).__name__:
            raise HTTPException(status_code=404, detail=f"task_id '{task_id}'를 찾을 수 없습니다.")
        raise HTTPException(status_code=500, detail=f"이력 조회 오류: {e}")

    try:
        from report_generator import generate_report
        pdf_path = generate_report(task_id, dict(entity))
        return FileResponse(
            path=pdf_path,
            media_type="application/pdf",
            filename=f"adguard_report_{task_id[:8]}.pdf",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF 생성 오류: {e}")


# ── POST /feedback ────────────────────────────────────────────────────
@app.post("/feedback", tags=["solution"])
async def feedback(req: FeedbackRequest):
    """
    사용자가 선택한 수정안·평가를 저장합니다. (데이터 플라이휠)
    저장 데이터는 추후 L4 Rewriter의 few-shot 개선에 활용됩니다.
    """
    try:
        table = get_table_client("feedback")
        entity = {
            "PartitionKey": "feedback",
            "RowKey": str(uuid.uuid4()),
            "task_id": req.task_id,
            "selected_style": req.selected_style or "",
            "rating": req.rating or 0,
            "comment": req.comment or "",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        table.create_entity(entity)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"피드백 저장 오류: {e}")
