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

# StyleType은 D6에서 L4 프롬프트에서 style 라벨이 제거되면서 의미 상실.
# 하위 호환을 위해 Optional 문자열로만 유지하고 Literal 제약은 해제.


class Violation(BaseModel):
    """
    위반 항목 1건.
    D12+: cascade가 L1·L3 출력을 **공통 형태로 정규화**하여 반환.
    phrase(구절), type(위반 유형), severity(강도), explanation(설명)이 기본 4필드.
    keyword/category/level/law_ref는 구 L1 raw 포맷을 쓰는 클라이언트용 하위 호환.
    """
    phrase: str = Field(..., description="카피에서 추출한 위반 구절")
    type: str = Field(default="", description="위반 유형 (시술용어·의약품오인 등)")
    severity: Literal["hard", "medium", "low"] = "medium"
    explanation: str = ""
    # 하위 호환 필드 (D13+에서 제거 예정)
    keyword: Optional[str] = None
    category: Optional[str] = None
    level: Optional[str] = None
    law_ref: Optional[str] = None


class RewriteSuggestion(BaseModel):
    """L4·L5가 생성·검증한 수정안 1건."""
    # D6에서 style 라벨이 L4 프롬프트에서 제거됨 → Optional로 하위 호환만 유지
    style: Optional[str] = Field(
        default=None,
        description="[Deprecated D6+] 구 스타일 문자열. L4는 이 필드를 더 이상 생성하지 않음.",
    )
    text: str
    verdict: VerdictType = Field(default="safe", description="L5 재검증 결과")
    retry_count: int = 0
    # L5-medium 상태 (D12 Hotfix2에서 4-state 복원):
    #   passed              — L1 clean + L3-lite safe (즉시 사용 가능)
    #   passed_with_warning — L1 clean + L3-lite caution (사용 가능, 맥락·실증 보강 권장)
    #   blocked             — L1 hard_block 또는 L3-lite hard_block (재수정 권장)
    #   failed              — 빈 텍스트 · L3-lite 호출 실패 등
    #
    # passed_with_warning이 D12 C-lite 초기에 제거됐다가 "수정안 재투입 시 caution 뜨는 문제"로
    # Hotfix2에서 복원됨. L5-medium이 L3-lite로 의미 재판정하면서 caution 잡을 수 있게 됨.
    status: Literal["passed", "passed_with_warning", "blocked", "failed"] = "passed"
    note: Optional[str] = Field(
        default=None,
        description="passed_with_warning 시 L3-lite 재판정 사유·경계 표현 상세",
    )
    warning: Optional[str] = Field(
        default=None,
        description="blocked 시 금지어 잔류·L3-lite 재판정 hard_block 사유",
    )
    caution_phrase: Optional[str] = Field(
        default=None,
        description="passed_with_warning 시 L3-lite가 짚은 경계 구절",
    )
    caution_type: Optional[str] = Field(
        default=None,
        description="passed_with_warning 시 경계 유형 (기능성 효능 암시 등)",
    )
    rejudge_source: Optional[str] = Field(
        default=None,
        description="재판정 경로 (l1 / l3_lite / l1_only / l3_lite_error)",
    )
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
    violations: List[Violation] = Field(
        default_factory=list,
        description="최상위 위반 항목 리스트. 공식 경로는 layers.l3.violations이며, 이 필드는 편의용 복제",
    )
    legal_basis: List[str] = Field(default_factory=list)
    verified_rewrites: List[RewriteSuggestion] = Field(default_factory=list)
    optimization_hints: List[str] = Field(
        default_factory=list,
        description=(
            "L3가 RAG 기반으로 생성하는 카피 전략 힌트. "
            "D12+ 생성 규칙: hard_block/caution일 때만 3개 생성, safe/out_of_scope면 빈 배열. "
            "L4 rewriter의 전략 브리핑으로 주입되며 UI는 렌더링하지 않음 (내부 전용)."
        ),
    )
    analyzed_at: Optional[str] = Field(
        default=None,
        description="ISO8601 UTC timestamp. 리포트에 '언제 기준 법령 해석인지' 명시용",
    )
    from_cache: Optional[bool] = Field(
        default=None,
        description="True면 로컬 캐시 hit (ADGUARD_CACHE_ENABLED=0으로 끌 수 있음)",
    )
    total_latency_ms: Optional[int] = None
    total_tokens: Optional[int] = None

    # ─── D12+ 추가 필드 (cascade 응답의 실제 형태에 맞춤) ───
    layers: dict = Field(
        default_factory=dict,
        description="각 레이어 원본 출력 (l1/l2/l3/l4/l5). 디버깅·프론트 상세뷰 용도.",
    )
    product_context: Optional[dict] = Field(
        default=None,
        description="요청 시 전달된 ProductContext 직렬화 (product_type / certification_no / certified_claims)",
    )
    recovery_hint: Optional[str] = Field(
        default=None,
        description="out_of_scope 등 비정상 경로에서 사용자에게 제시하는 복구 안내",
    )


class HistoryItem(BaseModel):
    """GET /history 응답의 이력 항목 1건."""
    task_id: str
    verdict: str
    risk_summary: str
    timestamp: str
    text_preview: Optional[str] = None


class HistoryResponse(BaseModel):
    """GET /history 응답."""
    items: List[HistoryItem]
    total: int
