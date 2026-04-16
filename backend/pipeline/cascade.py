"""
AdGuard Cascade Pipeline — L1 → L2 → L3 연결

사용:
    from cascade import AdGuardCascade
    ag = AdGuardCascade()
    result = ag.check("바르는 보톡스 크림")

    # CLI:
    python adguard/pipeline/cascade.py "카피 내용"
    python adguard/pipeline/cascade.py  # 기본 테스트 10개
"""
from __future__ import annotations
import sys
import time
import json
from pathlib import Path

# 같은 폴더 모듈 import
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rule_engine import RuleEngine
from retriever import Retriever
from judge import Judge
from l4_rewriter import Rewriter
from l5_rejudge import ReJudge
from product_context import ProductContext, ProductType


class AdGuardCascade:
    """L1 Rule → L2 RAG → L3 Judge → L4 Rewriter → L5 Re-Judge 파이프라인."""

    def __init__(
        self,
        judge_prompt: str = "grounded",
        rewriter_prompt: str = "v3_dynamic",
        max_retries: int = 2,
    ):
        self.rule_engine = RuleEngine()
        self.retriever = Retriever()
        self.judge = Judge(prompt_version=judge_prompt)
        self.rewriter = Rewriter(self.retriever, prompt_version=rewriter_prompt)
        self.rejudge = ReJudge(self.retriever, self.judge, self.rewriter, max_retries=max_retries)

    def check(
        self,
        copy: str,
        context: ProductContext | None = None,
        skip_l3_if_hard_block: bool = False,
        run_rewriter: bool = True,
    ) -> dict:
        """
        광고 카피 전체 판정 (L1 → L5).

        Args:
            copy: 판정할 광고 카피
            skip_l3_if_hard_block: L1이 hard_block이면 L3 건너뜀 (비용 절감)
            run_rewriter: L4/L5 수정안 생성 여부 (기본 True)

        Returns:
            {
              "copy": "...",
              "final_verdict": "hard_block" | "caution" | "safe",
              "confidence": 0.0~1.0,
              "layers": {
                "l1": {...},  # Rule Engine
                "l2": {...},  # RAG 요약
                "l3": {...},  # Judge
                "l4": {...},  # Rewriter (3 스타일 생성)
                "l5": {...}   # Re-Judge (재검증)
              },
              "verified_rewrites": [
                {"style": "safe", "text": "...", "verdict": "safe", "retry_count": 0},
                ...
              ],
              "total_latency_ms": 1234,
              "total_tokens": 4500,
              "explanation": "..."
            }
        """
        start = time.perf_counter()

        # 컨텍스트 기본값 = 일반 화장품
        if context is None:
            context = ProductContext()

        result = {
            "copy": copy,
            "product_context": context.to_dict(),
            "layers": {},
        }

        # ============ L0: Product Router ============
        # 의약품은 우리 시스템 범위 밖 → 즉시 종료
        if context.is_pharmaceutical:
            return {
                "copy": copy,
                "product_context": context.to_dict(),
                "final_verdict": "out_of_scope",
                "confidence": 1.0,
                "explanation": (
                    "⚠️ 의약품 광고는 약사법 및 의약품 등의 안전에 관한 규칙에 따라 "
                    "식약처의 별도 심의를 받아야 합니다. "
                    "AdGuard는 화장품 광고 판정 전용 시스템입니다."
                ),
                "layers": {"l0": "stopped_pharmaceutical"},
                "verified_rewrites": [],
                "total_latency_ms": round((time.perf_counter() - start) * 1000),
                "total_tokens": 0,
                "recovery_hint": "제품 유형을 '일반 화장품' 또는 '기능성 화장품'으로 다시 선택해주세요.",
            }

        # ============ L1: Rule Engine ============
        l1 = self.rule_engine.check(copy)
        result["layers"]["l1"] = l1

        # ============ Fast Mode ============
        # L1이 hard_block이고 fast_mode 옵션이면 L2/L3 스킵하고 L4로 직행
        # - L1 키워드 정보를 L4에 fake_l3로 전달
        # - L4/L5는 여전히 실행 (수정안 필요)
        l1_fast_mode = False
        if l1["verdict"] == "hard_block" and skip_l3_if_hard_block:
            l1_fast_mode = True
            result["layers"]["l2"] = None
            result["layers"]["l3"] = None

            # L1 키워드를 L4가 이해할 수 있는 형태로 변환
            violations = []
            legal_bases = set()
            for m in l1.get("matched_keywords", [])[:5]:
                term = m.get("keyword") or m.get("matched", "?")
                violations.append({
                    "phrase": term,
                    "type": m.get("category", "?"),
                    "severity": "hard",
                    "explanation": m.get("reason", "L1 Rule Engine 감지"),
                })
                for lb in m.get("legal_basis", []):
                    legal_bases.add(lb)

            l3 = {
                "verdict": "hard_block",
                "confidence": 0.99,
                "reasoning": (
                    f"L1 Rule Engine에서 "
                    f"{len(l1.get('matched_keywords', []))}개 금지 표현 감지 "
                    f"(Fast Mode: L2/L3 스킵)"
                ),
                "violations": violations,
                "legal_basis": list(legal_bases),
                "suggested_next_step": (
                    "L1 감지 키워드를 제거하고 해당 영역의 안전한 표현으로 재작성"
                ),
                "usage": {"total_tokens": 0},
            }
            result["layers"]["l3"] = l3
            # 아래 "최종 verdict 결정" 블록을 건너뛰기 위해 final 미리 설정
            final = "hard_block"
            # L4/L5는 아래에서 계속 실행됨

        # ============ L2 + L3 (Fast Mode 아닐 때만) ============
        if not l1_fast_mode:
            # L2: RAG Retrieval
            l2 = self.retriever.retrieve(copy, top_k=5)
            result["layers"]["l2"] = {
                "latency_ms": l2["latency_ms"],
                "chunk_count": len(l2["chunks"]),
                "top_sources": [
                    {
                        "source_id": c["source_id"],
                        "type": c["type"],
                        "rerank_score": c["rerank_score"],
                    }
                    for c in l2["chunks"][:3]
                ],
            }

            # L3: Judge (제품 컨텍스트 주입)
            l3 = self.judge.judge(copy, l2["chunks"], context=context)
            result["layers"]["l3"] = l3

            # 최종 verdict 결정
            l1_verdict = l1["verdict"]
            l3_verdict = l3.get("verdict", "caution")

            if l1_verdict == "hard_block":
                final = "hard_block"
            elif l3_verdict == "hard_block":
                final = "hard_block"
            elif l1_verdict == "caution" or l3_verdict == "caution":
                final = "caution"
            elif l1_verdict == "functional_conditional":
                final = l3_verdict
            else:
                final = l3_verdict

        result["final_verdict"] = final
        result["confidence"] = l3.get("confidence", 0.8)

        # 설명 조립
        explain_parts = []
        if l1["matched_keywords"]:
            kws = ", ".join(
                (m.get("keyword") or m.get("matched", "?"))
                for m in l1["matched_keywords"][:3]
            )
            explain_parts.append(f"[L1] 키워드 매칭: {kws}")
        if l3.get("reasoning"):
            explain_parts.append(f"[L3] {l3['reasoning']}")
        result["explanation"] = " / ".join(explain_parts)

        # ============ L4: Rewriter (safe가 아닐 때만) ============
        tokens = l3.get("usage", {}).get("total_tokens", 0)
        if run_rewriter and final != "safe":
            l4 = self.rewriter.rewrite(copy, l3, context=context)
            result["layers"]["l4"] = {
                "rewrite_suggestions": l4.get("rewrite_suggestions", []),
                "rewriter_notes": l4.get("rewriter_notes", ""),
                "few_shot_used": l4.get("few_shot_used", {}),
                "latency_ms": l4.get("latency_ms", 0),
                "tokens": l4.get("usage", {}).get("total_tokens", 0),
                "prompt_version": l4.get("prompt_version"),
            }
            tokens += l4.get("usage", {}).get("total_tokens", 0)

            # ============ L5: Re-Judge ============
            l5 = self.rejudge.verify(copy, l3, l4, context=context)
            result["layers"]["l5"] = {
                "all_safe": l5["all_safe"],
                "total_retries": l5["total_retries"],
                "latency_ms": l5["latency_ms"],
                "mode": l5.get("mode", "?"),
            }
            result["verified_rewrites"] = l5["verified_suggestions"]
        else:
            result["layers"]["l4"] = None
            result["layers"]["l5"] = None
            result["verified_rewrites"] = []

        # 집계
        result["total_latency_ms"] = round((time.perf_counter() - start) * 1000)
        result["total_tokens"] = tokens

        return result


def print_result(result: dict, verbose: bool = True):
    """결과를 예쁘게 출력."""
    verdict = result["final_verdict"]
    emoji = {"hard_block": "🔴", "caution": "🟡", "safe": "🟢"}.get(verdict, "❓")

    print("=" * 70)
    print(f"📝 카피: \"{result['copy']}\"")
    print()
    print(f"{emoji} 최종 판정: {verdict.upper()} (confidence {result['confidence']:.2f})")
    print(f"   ⏱ {result['total_latency_ms']}ms, 토큰 {result['total_tokens']}")
    print()

    # L1
    l1 = result["layers"]["l1"]
    print(f"▶ L1 Rule Engine ({l1['latency_ms']}ms): {l1['verdict']}")
    for m in l1["matched_keywords"][:5]:
        term = m.get("keyword") or m.get("matched", "?")
        print(f"    - [{m['level']}/{m['category']}] \"{term}\"")

    # L2
    l2 = result["layers"]["l2"]
    if l2:
        print(f"\n▶ L2 RAG ({l2['latency_ms']}ms): {l2['chunk_count']}개 청크")
        for src in l2["top_sources"]:
            print(f"    - rerank={src['rerank_score']:.2f}  [{src['type']}]  {src['source_id'][:60]}")

    # L3
    l3 = result["layers"]["l3"]
    if l3 and verbose:
        print(f"\n▶ L3 Judge ({l3['latency_ms']}ms): {l3['verdict']}")
        print(f"    사유: {l3.get('reasoning', '')}")
        if l3.get("violations"):
            print(f"    위반 {len(l3['violations'])}개:")
            for v in l3["violations"]:
                print(f"      • [{v.get('type')}/{v.get('severity')}] \"{v.get('phrase')}\"")
        if l3.get("legal_basis"):
            print(f"    법적 근거: {', '.join(l3['legal_basis'])}")
        if l3.get("suggested_next_step"):
            print(f"    다음 단계: {l3['suggested_next_step']}")

    # L4 + L5 (수정안 + 재검증)
    l4 = result["layers"].get("l4")
    verified = result.get("verified_rewrites", [])
    if l4 and verified:
        l5 = result["layers"].get("l5", {})
        print(f"\n▶ L4 Rewriter + L5 Re-Judge ({l4['latency_ms']}+{l5.get('latency_ms', 0)}ms)")
        print(f"    few_shot: cases={l4.get('few_shot_used', {}).get('cases', [])}")
        print(f"    all_safe: {l5.get('all_safe')}, 재시도: {l5.get('total_retries')}회")
        print()
        for v in verified:
            style_emoji = {"safe": "🟢", "marketing": "🟡", "functional": "🔵"}.get(v["style"], "❓")
            status_emoji = "✅" if v["status"] == "passed" else "❌"
            print(f"    {style_emoji} [{v['style']}] {status_emoji} ({v['verdict']}, retry {v['retry_count']})")
            print(f"       \"{v['text']}\"")
    print()


# ============== CLI ==============
if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    cascade = AdGuardCascade()

    if len(sys.argv) > 1:
        # 단일 카피 검사
        copy = " ".join(sys.argv[1:])
        result = cascade.check(copy)
        print_result(result)
    else:
        # 10개 기본 테스트 세트
        test_set = [
            # Expected: hard_block
            "바르는 보톡스로 피부가 부활하는 14일의 기적",
            "셀룰라이트 제거 + 지방 분해 바디 크림",
            "엑소좀 마이크로니들 앰플로 세포 재생",
            "여드름 치료에 효과적인 의사 추천 화장품",
            "탈모 치료 샴푸 100% 보장",
            # Expected: caution
            "피부의 운명을 바꾸는 2주의 기적",
            "14일 만에 완벽한 피부 변화",
            # Expected: functional 또는 safe
            "주름 개선 기능성화장품 보고 완료",
            # Expected: safe
            "갈증은 우리를 빛나게 하니까",
            "매일 쓰는 촉촉한 크림, 나에게 집중",
        ]

        results = []
        for copy in test_set:
            r = cascade.check(copy)
            print_result(r, verbose=False)
            results.append(r)

        # 최종 요약
        print("=" * 70)
        print("📊 최종 요약")
        print("=" * 70)
        counts = {}
        total_latency = 0
        total_tokens = 0
        for r in results:
            v = r["final_verdict"]
            counts[v] = counts.get(v, 0) + 1
            total_latency += r["total_latency_ms"]
            total_tokens += r["total_tokens"]

        for v, c in counts.items():
            print(f"  {v}: {c}")
        print(f"  평균 지연: {total_latency // len(results)}ms")
        print(f"  총 토큰: {total_tokens}")
        print(f"  예상 비용: ~${total_tokens * 2.5 / 1_000_000:.4f}")
