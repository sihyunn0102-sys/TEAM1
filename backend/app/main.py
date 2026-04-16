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
from fastapi.responses import JSONResponse, FileResponse

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
