"""
app/schemas/request.py  ── 요청 바디 스키마
────────────────────────────────────────────
FastAPI 엔드포인트 요청 바디를 Pydantic 모델로 정의합니다.
자동 유효성 검사 및 Swagger UI 문서화에 사용됩니다.

ProductType은 pipeline/product_context.py의 단일 정의를 재사용합니다.
"""
from __future__ import annotations
import re                                        
from pydantic import BaseModel, Field, field_validator

# 단일 진실의 원천 — pipeline.product_context의 ProductType 재사용
from pipeline.product_context import ProductType

# SQL 인젝션 및 유해 패턴 차단을 위한 정규식 (보안 2단계)
_INJECTION_PATTERN = re.compile(
    r"(--|;|/\*|\*/|xp_|UNION\s+SELECT|DROP\s+TABLE|INSERT\s+INTO|DELETE\s+FROM"
    r"|'\s+OR\s+'|'\s+AND\s+'|OR\s+1\s*=\s*1|AND\s+1\s*=\s*1"
    r"|'\s*=\s*'|SLEEP\s*\(|BENCHMARK\s*\(|WAITFOR\s+DELAY)",
    re.IGNORECASE,
)

class TextRequest(BaseModel):
    """텍스트 분석·수정안 재요청 시 사용하는 요청 바디."""
    # 프론트엔드 호환성을 위해 text와 copy 둘 다 수용
    text: str | None = Field(default=None, max_length=2000, description="판정할 광고 카피")
    copy: str | None = Field(default=None, max_length=2000, description="판정할 광고 카피 (별칭)")
    
    product_type: ProductType = Field(
        default=ProductType.general_cosmetic,
        description="제품 유형 — general_cosmetic / functional_cosmetic / pharmaceutical",
    )
    certification_no: str | None = Field(
        default=None,
        max_length=100,                                                            
        description="기능성화장품 심사 번호 (예: 제2024-01234호)",
    )
    certified_claims: list[str] = Field(
        default_factory=list,
        description="심사 통과 효능 목록 (예: ['주름 개선', '미백'])",
    )

    # 모든 입력 필드에 대해 인젝션 패턴 검증 수행
    @field_validator("certification_no", "text", "copy", mode="before")  
    @classmethod                                                    
    def block_injection(cls, v: str | None) -> str | None:        
        if v and _INJECTION_PATTERN.search(v):                    
            raise ValueError("허용되지 않는 문자열 패턴이 포함되어 있습니다.")
        return v   

class FeedbackRequest(BaseModel):
    """사용자 수정안 선택·평가 저장 요청."""
    task_id: str = Field(..., pattern=r"^[0-9a-f-]{36}$", description="UUID 형식 task_id")
    # SyntaxError 수정을 위해 인자 순서 교정 완료
    selected_index: int | None = Field(default=None, ge=0, le=2, description="선택한 수정안 인덱스")
    selected_style: str | None = Field(default=None, max_length=50, description="선택한 스타일 이름")
    rating: int | None = Field(default=None, ge=1, le=5, description="별점 점수")
    comment: str | None = Field(default=None, max_length=500, description="사용자 피드백 의견")