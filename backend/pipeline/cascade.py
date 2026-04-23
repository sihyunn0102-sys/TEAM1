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
import os
import time
import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path

# 같은 폴더 모듈 import
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rule_engine import RuleEngine
from retriever import Retriever
from judge import Judge
from l4_rewriter import Rewriter
from l5_rejudge import ReJudge
from product_context import ProductContext, ProductType


# ═══════════════════ 응답 캐시 설정 ═══════════════════
# JSON으로 저장 (pickle 금지 — untrusted content deserialization 위험)
_ROOT = Path(__file__).resolve().parent.parent
_CACHE_PATH = _ROOT / "data" / "cache" / "response_cache.json"
_CACHE_TTL_SECONDS = 24 * 3600
# 운영 배포 시 끌 수 있게 환경변수로 제어 (기본 on)
_CACHE_ENABLED = os.getenv("ADGUARD_CACHE_ENABLED", "1") != "0"


def _l1_matches_to_violations(matched_keywords: list[dict], severity: str = "hard") -> tuple[list[dict], set]:
    """
    L1 rule_engine의 raw matched_keywords를 L3-style violations 스키마로 정규화.

    D12+: Fast Mode·explain 조립·최상위 violations 복제 등 여러 곳에서
    L1 raw를 파싱하던 중복 코드를 이 함수 하나로 통합.

    Args:
        matched_keywords: L1 check()의 matched_keywords 필드
        severity: 생성할 violation의 severity ("hard"/"medium"/"low")

    Returns:
        (violations[dict], legal_bases[set])
    """
    violations: list[dict] = []
    legal_bases: set = set()
    for m in matched_keywords:
        term = m.get("keyword") or m.get("matched", "?")
        violations.append({
            "phrase": term,
            "type": m.get("category", "?"),
            "severity": severity,
            "explanation": m.get("reason", "L1 Rule Engine 감지"),
        })
        for lb in m.get("legal_basis", []):
            legal_bases.add(lb)
    return violations, legal_bases


def _compute_source_hash() -> str:
    """
    캐시 무효화 키 — cases/copies/prompts/blocklist가 바뀌면 mtime이 달라져
    해시가 바뀌므로 이전 캐시가 자동 무효화됨.
    """
    paths = [
        _ROOT / "data" / "fewshot" / "cases.jsonl",
        _ROOT / "data" / "fewshot" / "copies.jsonl",
        _ROOT / "data" / "fewshot" / "copies_selection.jsonl",
        _ROOT / "data" / "fewshot" / "styles.jsonl",
        _ROOT / "prompts" / "judge" / "grounded.txt",
        _ROOT / "prompts" / "rewriter" / "v3_dynamic.txt",
        _ROOT / "configs" / "blocklist.yaml",
    ]
    h = hashlib.sha1()
    for p in paths:
        if p.exists():
            h.update(f"{p.name}:{p.stat().st_mtime}".encode())
    return h.hexdigest()[:12]


class AdGuardCascade:
    """L1 Rule → L2 RAG → L3 Judge → L4 Rewriter → L5-lite 파이프라인."""

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
        # L5-medium: judge 인스턴스 주입으로 수정안 L3-lite 재판정 가능
        self.rejudge = ReJudge(rule_engine=self.rule_engine, judge=self.judge)

        # 응답 캐시 (데이터/프롬프트 mtime이 포함된 source_hash가 바뀌면 자동 무효화)
        self._source_hash = _compute_source_hash()
        self._cache: dict = self._load_cache()
        self._cache_writes_since_save = 0

    def _load_cache(self) -> dict:
        if not _CACHE_ENABLED or not _CACHE_PATH.exists():
            return {}
        try:
            with _CACHE_PATH.open("r", encoding="utf-8") as f:
                data = json.load(f)
            # 만료 항목 정리
            now = time.time()
            return {k: v for k, v in data.items() if v.get("expires_at", 0) > now}
        except Exception:
            return {}

    def _save_cache(self) -> None:
        if not _CACHE_ENABLED:
            return
        try:
            _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            with _CACHE_PATH.open("w", encoding="utf-8") as f:
                json.dump(self._cache, f, ensure_ascii=False)
            self._cache_writes_since_save = 0
        except Exception:
            pass

    def _cache_key(self, copy: str, context: ProductContext) -> str:
        text = (copy or "").strip()
        pt = context.product_type.value if context else "general_cosmetic"
        cert_no = (context.certification_no or "") if context else ""
        certs = "|".join(sorted(context.certified_claims or [])) if context else ""
        raw = f"{text}\x1f{pt}\x1f{cert_no}\x1f{certs}\x1f{self._source_hash}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

    def check(
        self,
        copy: str,
        context: ProductContext | None = None,
        skip_l3_if_hard_block: bool | None = None,
        run_rewriter: bool = True,
    ) -> dict:
        """
        광고 카피 전체 판정 (L1 → L5-lite).

        Args:
            copy: 판정할 광고 카피
            skip_l3_if_hard_block:
                None(기본, 권장) — context 기반 자동 결정.
                    기능성 화장품은 False(맥락 판단 필요),
                    일반 화장품은 True(Fast Mode로 비용 절감).
                True/False — 호출자가 명시적으로 override할 때만 사용.
            run_rewriter: L4/L5-lite 수정안 생성 여부 (기본 True)

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

        # skip_l3_if_hard_block 자동 결정: 기능성 화장품은 L3 맥락 판단 필요
        if skip_l3_if_hard_block is None:
            skip_l3_if_hard_block = not context.is_functional

        # ========== 응답 캐시 lookup ==========
        # run_rewriter=False 같은 옵션 변형까지 포함하려면 키에 추가해야 하나,
        # 현재 호출 경로는 항상 run_rewriter=True이므로 생략.
        cache_key = self._cache_key(copy, context) if _CACHE_ENABLED else None
        if cache_key and cache_key in self._cache:
            entry = self._cache[cache_key]
            if entry.get("expires_at", 0) > time.time():
                cached = dict(entry["result"])
                cached["from_cache"] = True
                cached["total_latency_ms"] = round((time.perf_counter() - start) * 1000)
                return cached

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
                "optimization_hints": [],  # 의약품 out_of_scope 경로는 힌트 대상 아님
                "total_latency_ms": round((time.perf_counter() - start) * 1000),
                "total_tokens": 0,
                "from_cache": False,
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
                "recovery_hint": "제품 유형을 '일반 화장품' 또는 '기능성 화장품'으로 다시 선택해주세요.",
            }

        # ============ L1: Rule Engine ============
        l1 = self.rule_engine.check(copy)
        result["layers"]["l1"] = l1

        # ============ Fast Mode ============
        # L1 hard_block + Fast Mode → L2/L3 스킵하고 L4로 직행
        # 단, 기능성 화장품이 인증받은 효능 키워드로 잡힌 경우는 L3로 넘김
        l1_fast_mode = False
        if l1["verdict"] == "hard_block" and skip_l3_if_hard_block:
            if context.is_functional and context.certified_claims:
                l1_keywords = [
                    (m.get("keyword") or m.get("matched", "")).lower()
                    for m in l1.get("matched_keywords", [])
                ]
                has_certified_overlap = any(
                    claim in kw or kw in claim
                    for claim in context.certified_claims
                    for kw in l1_keywords
                )
                l1_fast_mode = not has_certified_overlap
            else:
                l1_fast_mode = True

        # L5-medium에서 재사용할 L2 chunks 보관소 (Fast Mode에서는 비어있음)
        l2_chunks_for_rejudge: list[dict] = []

        if l1_fast_mode:
            result["layers"]["l2"] = None
            result["layers"]["l3"] = None

            # L1 → L3-style 정규화 (공통 함수 사용)
            violations, legal_bases = _l1_matches_to_violations(
                l1.get("matched_keywords", [])[:5],
                severity="hard",
            )

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
            # L5-medium 재사용을 위해 chunks 보관
            l2_chunks_for_rejudge = l2["chunks"]
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

            # 방어 로직: 프롬프트가 legal_basis를 배열로 응답하도록 수정됐지만,
            # 혹시라도 구 스키마(law_citation 단일 문자열)가 올 경우 배열로 변환
            if not l3.get("legal_basis"):
                law_cite = l3.get("law_citation")
                if law_cite:
                    l3["legal_basis"] = [law_cite] if isinstance(law_cite, str) else list(law_cite)
                else:
                    l3["legal_basis"] = []

            result["layers"]["l3"] = l3

            # 최종 verdict 결정 (D12 C-lite: L1은 hard_block/pass 2-state)
            #   - L1 hard_block → Fast Mode에서 이미 final 설정됨 (여기 안 옴)
            #   - L1 pass → L3 판정을 그대로 신뢰 (caution·safe 판단은 L3 전담)
            l3_verdict = l3.get("verdict", "caution")
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

            # ============ L5-medium: L1 바이너리 + L3-lite 의미 재판정 ============
            # L2 chunks를 L5에 전달 → L3-lite가 추가 RAG 호출 없이 재판정 가능
            l5 = self.rejudge.verify(
                copy,
                l3,
                l4,
                context=context,
                l2_chunks=l2_chunks_for_rejudge,
            )
            result["layers"]["l5"] = {
                "all_safe": l5["all_safe"],
                "all_clean": l5.get("all_clean", False),
                "total_retries": l5["total_retries"],
                "latency_ms": l5["latency_ms"],
                "mode": l5.get("mode", "?"),
                "rejudge_tokens": l5.get("rejudge_tokens", 0),
            }
            result["verified_rewrites"] = l5["verified_suggestions"]
            # L5 재판정 토큰도 총합에 누적
            tokens += l5.get("rejudge_tokens", 0)
        else:
            result["layers"]["l4"] = None
            result["layers"]["l5"] = None
            result["verified_rewrites"] = []

        # 집계
        result["total_latency_ms"] = round((time.perf_counter() - start) * 1000)
        result["total_tokens"] = tokens
        result["from_cache"] = False
        result["analyzed_at"] = datetime.now(timezone.utc).isoformat()

        # optimization_hints — L3 응답에서 최상위로 복제 (프론트 편의)
        # Judge 프롬프트는 verdict 무관 3개 필수이나, 혹시 누락 시 빈 배열.
        hints = l3.get("optimization_hints") if isinstance(l3, dict) else None
        result["optimization_hints"] = hints if isinstance(hints, list) else []

        # violations / legal_basis — L3 응답을 최상위로 복제 (스키마-구현 일치, D12+)
        # 이전엔 layers.l3.violations 안에만 있어 AnalyzeResponse 스키마와 drift 발생.
        result["violations"] = l3.get("violations", []) if isinstance(l3, dict) else []
        result["legal_basis"] = l3.get("legal_basis", []) if isinstance(l3, dict) else []

        # ========== 응답 캐시 save ==========
        if cache_key:
            self._cache[cache_key] = {
                "result": result,
                "expires_at": time.time() + _CACHE_TTL_SECONDS,
            }
            self._cache_writes_since_save += 1
            if self._cache_writes_since_save >= 10:
                self._save_cache()

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
