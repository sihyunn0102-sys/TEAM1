"""
app/schemas/response.py  ── 응답 바디 스키마
────────────────────────────────────────────
FastAPI 엔드포인트 응답 바디를 Pydantic 모델로 정의합니다.
프론트엔드가 이 스키마를 참고해서 UI 바인딩합니다.
상세 필드 정의는 SCHEMA.md 참조.
"""
from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal, Any, Optional, List


VerdictType = Literal["hard_block", "caution", "safe", "out_of_scope"]
StyleType = Literal["safe", "marketing", "functional"]


class Violation(BaseModel):
    """위반 항목 1건. L1(keyword)·L3(phrase) 모두 이 형태로 반환됩니다."""
    phrase: str = Field(..., description="카피에서 추출한 위반 구절")
    type: str = Field(default="", description="위반 유형 (시술용어·의약품오인 등)")
    severity: Literal["hard", "medium", "low"] = "medium"
    explanation: str = ""
    # L1 호환 필드
    keyword: Optional[str] = None
    category: Optional[str] = None
    level: Optional[str] = None
    law_ref: Optional[str] = None


class RewriteSuggestion(BaseModel):
    """L4·L5가 생성·검증한 수정안 1건."""
    style: StyleType
    text: str
    verdict: VerdictType = Field(default="safe", description="L5 재검증 결과")
    retry_count: int = 0
    status: Literal["passed", "failed"] = "passed"
    changes: Optional[str] = None
    referenced_case_id: Optional[str] = None


class AnalyzeResponse(BaseModel):
    """
    /analyze/text · /analyze/image 공통 응답 스키마.
    cascade.check() 결과와 1:1 대응합니다.
    """
    model_config = ConfigDict(
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "task_id": "abc-123",
                "copy": "바르는 보톡스 크림",
                "final_verdict": "hard_block",
                "confidence": 0.99,
                "explanation": "[L1] 키워드 매칭: 바르는 보톡스 / [L3] 시술 용어는 의약품 오인",
                "violations": [
                    {
                        "phrase": "바르는 보톡스",
                        "type": "시술용어",
                        "severity": "hard",
                        "explanation": "화장품법 제13조 시술 용어 금지",
                    }
                ],
                "legal_basis": ["화장품법 제13조 제1항 제1호"],
                "verified_rewrites": [
                    {
                        "style": "safe",
                        "text": "매일 바르는 깊은 보습 크림",
                        "verdict": "safe",
                        "retry_count": 0,
                        "status": "passed",
                    }
                ],
                "total_latency_ms": 29000,
                "total_tokens": 7400,
            }
        },
    )

    task_id: str = ""
    ad_copy: str = Field(default="", alias="copy")
    final_verdict: VerdictType = "safe"
    confidence: float = 0.0
    explanation: str = ""
    violations: List[Violation] = Field(default_factory=list)
    legal_basis: List[str] = Field(default_factory=list)
    verified_rewrites: List[RewriteSuggestion] = Field(default_factory=list)
    total_latency_ms: Optional[int] = None
    total_tokens: Optional[int] = None


class HistoryItem(BaseModel):
    """GET /history 응답의 이력 항목 1건."""
    task_id: str
    verdict: str
    risk_summary: str
    sponsored_missing: bool
    timestamp: str
    text_preview: Optional[str] = None


class HistoryResponse(BaseModel):
    """GET /history 응답."""
    items: List[HistoryItem]
    total: int
