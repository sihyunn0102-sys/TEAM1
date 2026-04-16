"""
L0 Product Context — 제품 유형 컨텍스트

프론트엔드가 사용자로부터 받은 제품 정보를 ProductContext로 포장해
L1~L5 파이프라인에 전달. 판정 기준이 제품 유형에 따라 갈라짐.

- general_cosmetic: 일반 화장품 (기본, 가장 엄격)
- functional_cosmetic: 기능성 화장품 (심사 통과 효능 범위 내 완화)
- pharmaceutical: 의약품 (우리 범위 밖, L0에서 즉시 차단)
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum


class ProductType(str, Enum):
    """
    제품 유형 — 프론트엔드 3단계 선택과 1:1 매칭.
    """
    general_cosmetic = "general_cosmetic"
    functional_cosmetic = "functional_cosmetic"
    pharmaceutical = "pharmaceutical"


@dataclass
class ProductContext:
    """
    제품 컨텍스트 — L1~L5 파이프라인 전체에 관통하는 단일 타입.

    사용 예:
        ctx = ProductContext(
            product_type=ProductType.functional_cosmetic,
            certification_no="제2024-01234호",
            certified_claims=["주름 개선"],
        )
        cascade.check(copy, context=ctx)
    """
    product_type: ProductType = ProductType.general_cosmetic
    certification_no: str | None = None
    certified_claims: list[str] = field(default_factory=list)

    # ---------- 편의 프로퍼티 ----------

    @property
    def is_general(self) -> bool:
        return self.product_type == ProductType.general_cosmetic

    @property
    def is_functional(self) -> bool:
        return self.product_type == ProductType.functional_cosmetic

    @property
    def is_pharmaceutical(self) -> bool:
        return self.product_type == ProductType.pharmaceutical

    # ---------- 프롬프트 주입 ----------

    def to_prompt_block(self) -> str:
        """
        L3 Judge / L4 Rewriter 프롬프트에 주입할 컨텍스트 블록.
        제품 유형에 따라 판정 완화 정도가 달라짐을 명시.
        """
        if self.is_general:
            return (
                "## 🏷️ 제품 컨텍스트 (사용자 제공)\n"
                "- 제품 유형: **일반 화장품**\n"
                "- 기능성화장품 심사 미등록\n"
                "- **기준**: 기능성 효능 주장(주름·미백·자외선·탈모 완화 등)은 "
                "모두 caution 또는 hard_block (기본 엄격 기준)\n"
            )

        if self.is_functional:
            claims_str = ", ".join(self.certified_claims) if self.certified_claims else "(미지정)"
            cert_no = self.certification_no or "(미제공)"
            return (
                "## 🏷️ 제품 컨텍스트 (사용자 제공)\n"
                "- 제품 유형: **기능성 화장품**\n"
                f"- 심사 번호: {cert_no}\n"
                f"- 심사 통과 효능: {claims_str}\n"
                "\n"
                "**판정 기준 완화 원칙**:\n"
                "1. 카피의 효능 주장이 `심사 통과 효능` 안이면 **caution까지 완화**\n"
                "   (예: certified=[주름 개선]이면 '주름 개선' 표현은 caution 수준으로만)\n"
                "2. 단, `심사 통과 효능` 밖의 효능 주장(예: 카피에 '미백'이 있는데 certified에 미백 없음)은 "
                "   **그대로 엄격 판정** (caution/hard_block 유지)\n"
                "3. **시술 용어, 의약품 오인, 허위 수치**는 기능성 여부와 무관하게 **항상 hard_block**\n"
                "4. ⚠️ 사용자 제공 정보는 참고용. 실제 심사 여부는 사용자 책임.\n"
            )

        # pharmaceutical은 L0에서 차단되므로 여기 도달 X
        return ""

    def to_dict(self) -> dict:
        """JSON 응답에 포함할 수 있는 직렬화 형태."""
        return {
            "product_type": self.product_type.value,
            "certification_no": self.certification_no,
            "certified_claims": self.certified_claims,
        }
