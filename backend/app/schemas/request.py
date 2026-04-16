"""
app/schemas/request.py  ── 요청 바디 스키마
────────────────────────────────────────────
FastAPI 엔드포인트 요청 바디를 Pydantic 모델로 정의합니다.
자동 유효성 검사 및 Swagger UI 문서화에 사용됩니다.
"""
from __future__ import annotations
from enum import Enum
from pydantic import BaseModel, Field


class ProductType(str, Enum):
    """제품 유형 — 프론트엔드 3단계 선택과 1:1 매핑."""
    general_cosmetic = "general_cosmetic"          # 일반 화장품 (기본)
    functional_cosmetic = "functional_cosmetic"    # 기능성 화장품 (심사 완료)
    pharmaceutical = "pharmaceutical"              # 의약품 (범위 밖, 즉시 차단)


class TextRequest(BaseModel):
    """텍스트 분석·수정안 재요청 시 사용하는 요청 바디."""
    text: str = Field(..., min_length=1, max_length=2000, description="판정할 광고 카피")
    product_type: ProductType = Field(
        default=ProductType.general_cosmetic,
        description="제품 유형 — general_cosmetic / functional_cosmetic / pharmaceutical",
    )
    certification_no: str | None = Field(
        default=None,
        description="기능성화장품 심사 번호 (예: 제2024-01234호)",
    )
    certified_claims: list[str] = Field(
        default_factory=list,
        description="심사 통과 효능 목록 (예: ['주름 개선', '미백'])",
    )


class RewriteRequest(BaseModel):
    """L4 단독 재수정 요청."""
    text: str = Field(..., min_length=1, max_length=2000)
    style_hint: str | None = Field(None, description="원하는 스타일 (safe/marketing/functional)")


class FeedbackRequest(BaseModel):
    """사용자 수정안 선택·평가 저장 요청."""
    task_id: str
    selected_style: str | None = None          # safe / marketing / functional
    rating: int | None = Field(None, ge=1, le=5)
    comment: str | None = None
