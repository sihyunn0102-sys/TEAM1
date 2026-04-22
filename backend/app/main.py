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
  POST /analyze/image        : 이미지·PDF 광고 검수 (OCR → Cascade)
  GET  /analyze/stream      : 텍스트 광고 검수 SSE 실시간 진행 상황
  GET  /result/{task_id}    : 판정 결과 조회 (Table Storage)
  GET  /history             : 판정 이력 목록 조회

  [관리자]
  GET  /admin/stats          : 통계 + 레이어별 평균 레이턴시

  [솔루션]
  POST /rewrite              : L4 단독 재요청 (이미 판정된 카피 재수정)
  POST /feedback            : 사용자가 선택한 수정안 저장 (데이터 플라이휠)

  [리포트]
  GET  /report/{task_id}    : PDF 리포트 다운로드

실행:
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8080

Swagger UI: http://localhost:8080/docs
"""

from __future__ import annotations
import sys
import uuid
import os
import asyncio
import tempfile
import logging
import json
import time
from datetime import datetime, timezone
from pathlib import Path

# [보안 2단계] 정규식 검증 에러 처리를 위한 임포트
from pydantic import ValidationError

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Response
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

app = FastAPI(
    title="AdGuard API",
    version="1.0.0",
    description="화장품 광고 허위·과장 표현 자동 검수 API (5-Layer Cascade)",
)

# ── [보안 강화 1단계] CORS 설정: 외부 침입 차단 ───────────────────────────
# 알려주신 Static Web App 주소와 로컬 환경만 허용하도록 수정되었습니다.
ALLOWED_ORIGINS = [
    "https://proud-flower-0fc6d2900.7.azurestaticapps.net",
    "http://localhost:3000",
    "http://localhost:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ── [보안 강화 2단계] 데이터 무결성 검사 에러 핸들러 ──────────────────────
@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    """request.py의 block_injection 정규식 필터에 걸릴 경우 400 에러를 반환합니다."""
    return JSONResponse(
        status_code=400,
        content={
            "error": "보안 정책 위반",
            "detail": "허용되지 않는 문자열 패턴(SQL 인젝션 시도 등)이 감지되었습니다.",
            "code": 400
        }
    )

# ── [보안 강화 3단계] 최종 보호막: 보안 헤더 및 CSP 추가 ──────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    # 기본 보안 헤더
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    
    # CSP 헤더 추가: 악성 스크립트 실행 방지
    # 프론트엔드 도메인과 자기 자신(self)의 통신만 신뢰합니다.
    # 🔥 Swagger UI 동작을 위해 CDN(jsdelivr, unpkg) 허용 추가
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; "
        "img-src 'self' data: https://*.azurewebsites.net; "
        "connect-src 'self' https://proud-flower-0fc6d2900.7.azurestaticapps.net https://*.azurewebsites.net https://cdn.jsdelivr.net https://unpkg.com;"
    )
    return response

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, FastAPIHTTPException):
        raise exc
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"error": str(exc), "code": 500})

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


def _make_product_context(req: TextRequest) -> ProductContext:
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
    try:
        table = get_table_client("history")
        entity = {
            "PartitionKey": "history",
            "RowKey": task_id,
            "text": text[:500],
            "verdict": result.get("final_verdict", result.get("verdict", "")),
            "risk_summary": result.get("explanation", result.get("risk_summary", "")),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "full_result": json.dumps(result, ensure_ascii=False)[:32000],
        }
        table.create_entity(entity)
    except Exception as e:
        logger.warning(f"Table Storage 저장 오류 (판정 결과에는 영향 없음): {e}")


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health", tags=["system"])
def health():
    return {
        "status": "ok",
        "cascade_loaded": cascade is not None,
        "version": "1.0.0",
    }


@app.post("/upload", tags=["analyze"])
async def upload_file(file: UploadFile = File(...)):
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


@app.post("/analyze/text", tags=["analyze"])
async def analyze_text(req: TextRequest):
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


@app.get("/analyze/stream", tags=["analyze"])
async def analyze_stream(text: str, product_type: str = "general_cosmetic"):
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
        layer_times: dict[str, float] = {}

        try:
            yield _sse("progress", {"step": "L1", "message": "금지 키워드를 검사하고 있습니다...", "percent": 10})
            await asyncio.sleep(0)
            t0 = time.time()
            l1 = await loop.run_in_executor(None, cascade.rule_engine.check, text)
            layer_times["L1"] = round(time.time() - t0, 3)

            yield _sse("progress", {"step": "L2", "message": "관련 법령과 판례를 검색하고 있습니다...", "percent": 30})
            await asyncio.sleep(0)
            t0 = time.time()
            l2 = await loop.run_in_executor(None, lambda: cascade.retriever.retrieve(text, top_k=5))
            layer_times["L2"] = round(time.time() - t0, 3)

            yield _sse("progress", {"step": "L3", "message": "AI가 위반 여부를 판정하고 있습니다...", "percent": 55})
            await asyncio.sleep(0)
            t0 = time.time()
            l3 = await loop.run_in_executor(None, lambda: cascade.judge.judge(text, l2["chunks"], context=ctx))
            layer_times["L3"] = round(time.time() - t0, 3)

            l1_verdict = l1["verdict"]
            l3_verdict = l3.get("verdict", "caution")
            if l1_verdict == "hard_block" or l3_verdict == "hard_block":
                final = "hard_block"
            elif l1_verdict == "caution" or l3_verdict == "caution":
                final = "caution"
            else:
                final = l3_verdict

            verified_rewrites = []
            if final != "safe":
                yield _sse("progress", {"step": "L4", "message": "수정 문구를 생성하고 있습니다...", "percent": 75})
                await asyncio.sleep(0)
                t0 = time.time()
                l4 = await loop.run_in_executor(None, lambda: cascade.rewriter.rewrite(text, l3, context=ctx))
                layer_times["L4"] = round(time.time() - t0, 3)

                yield _sse("progress", {"step": "L5", "message": "수정 문구를 최종 검증하고 있습니다...", "percent": 90})
                await asyncio.sleep(0)
                t0 = time.time()
                l5 = await loop.run_in_executor(None, lambda: cascade.rejudge.verify(text, l3, l4, context=ctx))
                layer_times["L5"] = round(time.time() - t0, 3)
                verified_rewrites = l5.get("verified_suggestions", [])

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
                "layer_times": layer_times,
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


@app.post("/analyze/image", tags=["analyze"])
async def analyze_image(file: UploadFile = File(...)):
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


@app.post("/rewrite", tags=["solution"])
async def rewrite(req: TextRequest):
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
    return {"task_id": str(uuid.uuid4()), **result}


@app.get("/result/{task_id}", tags=["analyze"])
async def get_result(task_id: str):
    try:
        from azure.core.exceptions import ResourceNotFoundError
        table = get_table_client("history")
        entity = table.get_entity(partition_key="history", row_key=task_id)
        return {
            "task_id": task_id,
            "status": "completed",
            "verdict": entity.get("verdict", ""),
            "risk_summary": entity.get("risk_summary", ""),
            "timestamp": entity.get("timestamp", ""),
        }
    except Exception as e:
        if "ResourceNotFound" in type(e).__name__:
            raise HTTPException(status_code=404, detail=f"task_id '{task_id}'를 찾을 수 없습니다.")
        raise HTTPException(status_code=500, detail=f"조회 오류: {e}")


@app.get("/history", tags=["analyze"])
async def get_history(limit: int = 20):
    try:
        table = get_table_client("history")
        entities = list(table.query_entities(
            query_filter="PartitionKey eq @pk",
            parameters={"pk": "history"},
            results_per_page=limit,
        ))
        items = [
            {
                "task_id": e["RowKey"],
                "verdict": e.get("verdict", ""),
                "risk_summary": e.get("risk_summary", ""),
                "timestamp": e.get("timestamp", ""),
                "text_preview": e.get("text")[:100] if e.get("text") else None,
            }
            for e in entities
        ]
        return {"items": items, "total": len(items)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"이력 조회 오류: {e}")


@app.get("/admin/stats", tags=["admin"])
async def admin_stats(request: Request):
    """관리자 통계: 판정 이력 집계 + 레이어별 평균 레이턴시."""
    password = request.headers.get("X-Admin-Password", "")
    if password != os.environ.get("ADMIN_PASSWORD", "admin"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        table = get_table_client("history")
        entities = list(table.query_entities(query_filter="PartitionKey eq 'history'"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"이력 조회 오류: {e}")

    total_count = len(entities)
    verdict_counts = {"safe": 0, "caution": 0, "hard_block": 0, "other": 0}
    daily_usage: dict[str, int] = {}
    latency_sums = {"L1": 0.0, "L2": 0.0, "L3": 0.0, "L4": 0.0, "L5": 0.0}
    latency_count = 0

    for e in entities:
        v = e.get("verdict", "other")
        verdict_counts[v if v in verdict_counts else "other"] += 1

        ts = e.get("timestamp", "")
        if ts:
            date_str = ts[:10]
            daily_usage[date_str] = daily_usage.get(date_str, 0) + 1

        try:
            full = json.loads(e.get("full_result", "{}"))
            lt = full.get("layer_times", {})
            if lt:
                for k in latency_sums:
                    latency_sums[k] += lt.get(k, 0.0)
                latency_count += 1
        except Exception:
            pass

    latency_avg = (
        {k: round(v / latency_count, 3) for k, v in latency_sums.items()}
        if latency_count > 0 else None
    )

    try:
        get_blob_client("user-uploads")
        storage_status = "ok"
    except Exception:
        storage_status = "error"

    return {
        "system_status": {
            "backend": "ok",
            "cascade_loaded": cascade is not None,
            "storage": storage_status,
        },
        "total_count": total_count,
        "verdict_counts": verdict_counts,
        "daily_usage": [{"date": k, "count": v} for k, v in sorted(daily_usage.items())],
        "latency_avg": latency_avg,
    }


@app.post("/report", tags=["report"])
async def post_report(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON 파싱 오류")

    task_id = body.get("task_id") or str(uuid.uuid4())

    entity = {
        "text": body.get("copy") or body.get("ad_copy") or "",
        "verdict": body.get("final_verdict", ""),
        "risk_summary": body.get("explanation", ""),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "full_result": json.dumps(body, ensure_ascii=False),
    }

    try:
        from report_generator import generate_report
        pdf_path = generate_report(task_id, entity)
        return FileResponse(
            path=pdf_path,
            media_type="application/pdf",
            filename=f"adguard_report_{task_id[:8]}.pdf",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF 생성 오류: {e}")


@app.get("/report/{task_id}", tags=["report"])
async def get_report(task_id: str):
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


@app.post("/feedback", tags=["solution"])
async def feedback(req: FeedbackRequest):
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