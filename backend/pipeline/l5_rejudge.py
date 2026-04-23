"""
L5 Re-Judge Medium — L1 바이너리 필터 + L3-lite 의미 재판정 (D12 C-lite Hotfix2+)

설계 배경:
    D12 C-lite 초기 버전(L1 바이너리만으로 L5)에서 **L4 수정안 재투입 시 caution 뜨는 문제** 발견.
    마케터가 L4 수정안을 복사해서 다시 AdGuard에 넣으면 원문 판정과 다른 verdict가 나올 수 있음
    → "통과"라고 보증한 수정안의 신뢰도 훼손.

    근본 원인: L1 바이너리는 hard_block만 체크 → 수정안 내부 caution 경계어(기능성 효능 암시,
    경계 표현)는 감지 못함. 재판정 시 L3가 맥락 보고 caution 줌.

    해결 (L5-medium): 수정안 3개를 L3-lite로 재판정하되 **L2(RAG)는 원문 판정 때 가져온 chunks 재사용**.
    추가 L2 호출 0회, L3-lite 3회 호출로 의미적 일관성 보장.

status 4-state (D12 C-lite 초기 버전에서 3-state로 줄였다가 Hotfix2에서 4-state로 복원):
    - "passed"              — L1 clean + L3-lite safe: 즉시 사용 가능
    - "passed_with_warning" — L1 clean + L3-lite caution: 사용 가능하나 맥락·실증 보강 권장
    - "blocked"             — L1 hard_block 또는 L3-lite hard_block: 사용 비권장
    - "failed"              — 빈 텍스트, 호출 에러 등

비용 영향:
    - L3-lite 호출 추가: 수정안 1건당 약 +500~800 토큰
    - 전체 건당 약 +30~50% 토큰
    - 단, blocked 판정은 L1만으로 결정되므로 L3-lite 스킵 → hard_block 많은 데모에선 증가폭 작음
"""
from __future__ import annotations
import time
from concurrent.futures import ThreadPoolExecutor


class ReJudge:
    """L5-medium (D12 Hotfix2) — L1 바이너리 + L3-lite 재판정 (병렬)."""

    def __init__(self, rule_engine, judge=None, max_parallel: int = 3, **_kwargs):
        """
        Args:
            rule_engine: L1 RuleEngine 인스턴스 (hard_block 체크용)
            judge: L3 Judge 인스턴스 (judge_lite() 호출용). None이면 L5-lite로 폴백.
            max_parallel: L3-lite 동시 호출 수 (기본 3 = 수정안 3개 병렬)
        """
        self.rule_engine = rule_engine
        self.judge = judge  # None이면 L5-lite 모드 (L1만 체크)
        self.max_parallel = max_parallel

    def verify(
        self,
        original_copy: str,
        l3_result: dict,
        l4_result: dict,
        context=None,
        l2_chunks: list[dict] | None = None,
    ) -> dict:
        """
        L4 수정안 3개를 L5-medium으로 재검증.

        Args:
            original_copy: 원문 (참고용, 현 구현에선 미사용)
            l3_result: 원문 L3 판정 결과 (참고용)
            l4_result: L4 Rewriter 결과 (rewrite_suggestions 포함)
            context: ProductContext (L3-lite에 주입)
            l2_chunks: 원문 판정 때 쓴 L2 RAG chunks (L3-lite 재판정에 재사용).
                       None이면 L3-lite가 빈 컨텍스트로 판정 (품질 저하 가능).
        """
        start = time.perf_counter()
        suggestions = l4_result.get("rewrite_suggestions", [])

        # ─── Step 1: L1 hard_block 체크를 모든 수정안에 먼저 적용 (빠름, 순차) ───
        # L1은 로컬 regex라 매우 빠름 → 병렬화 불필요.
        # 여기서 blocked 처리된 건은 L3-lite 호출 대상에서 제외하여 비용 절감.
        pre_verified: list[dict | None] = []  # 최종 결과 placeholder
        pending_for_l3: list[tuple[int, dict]] = []  # (index, suggestion)

        for idx, s in enumerate(suggestions):
            text = s.get("text", "")
            style = s.get("style", "?")

            if not text:
                pre_verified.append({
                    "style": style,
                    "text": "",
                    "verdict": "empty",
                    "retry_count": 0,
                    "status": "failed",
                })
                continue

            l1_check = self.rule_engine.check(text)
            if l1_check["verdict"] == "hard_block":
                matched = [
                    m.get("keyword") or m.get("matched", "?")
                    for m in l1_check.get("matched_keywords", [])[:3]
                ]
                pre_verified.append({
                    "style": style,
                    "text": text,
                    "verdict": "hard_block",
                    "retry_count": 0,
                    "status": "blocked",
                    "warning": f"L1 금지어 잔류: {', '.join(matched)}",
                    "rejudge_source": "l1",
                })
                continue

            # L1 clean → L3-lite 대기열에 넣음 (judge 있을 때만)
            if self.judge is None:
                # L5-lite 폴백 (judge 미주입 → L1 clean이면 passed)
                pre_verified.append({
                    "style": style,
                    "text": text,
                    "verdict": "safe",
                    "retry_count": 0,
                    "status": "passed",
                    "rejudge_source": "l1_only",
                })
                continue

            # 자리 예약 후 L3-lite 병렬 호출 대기열에 추가
            pre_verified.append(None)
            pending_for_l3.append((idx, s))

        # ─── Step 2: L3-lite를 pending 건에 대해 병렬 호출 (ThreadPoolExecutor) ───
        total_rejudge_tokens = 0
        if pending_for_l3 and self.judge is not None:
            def _run_lite(idx_sugg: tuple[int, dict]) -> tuple[int, dict]:
                idx, s = idx_sugg
                text = s.get("text", "")
                style = s.get("style", "?")
                try:
                    lite = self.judge.judge_lite(
                        rewrite_text=text,
                        rag_chunks=l2_chunks or [],
                        context=context,
                    )
                    lite_verdict = lite.get("verdict", "safe")
                    lite_usage = lite.get("usage", {}).get("total_tokens", 0)

                    entry: dict = {
                        "style": style,
                        "text": text,
                        "verdict": lite_verdict,
                        "retry_count": 0,
                        "rejudge_source": "l3_lite",
                        "rejudge_tokens": lite_usage,
                    }

                    if lite_verdict == "safe":
                        entry["status"] = "passed"
                    elif lite_verdict == "caution":
                        entry["status"] = "passed_with_warning"
                        lite_reasoning = lite.get("reasoning", "")
                        entry["note"] = (
                            f"L3 재판정 결과 경계 판정. 맥락·실증 보강 권장. "
                            f"사유: {lite_reasoning[:120]}"
                        )
                        lite_viols = lite.get("violations") or []
                        if lite_viols:
                            v = lite_viols[0]
                            entry["caution_phrase"] = v.get("phrase", "")
                            entry["caution_type"] = v.get("type", "")
                    else:  # hard_block
                        entry["status"] = "blocked"
                        entry["warning"] = (
                            f"L3 재판정 결과 hard_block. "
                            f"사유: {lite.get('reasoning', '')[:120]}"
                        )
                    return idx, entry
                except Exception as e:
                    return idx, {
                        "style": style,
                        "text": text,
                        "verdict": "unknown",
                        "retry_count": 0,
                        "status": "failed",
                        "warning": f"L3 재판정 호출 실패: {type(e).__name__}",
                        "rejudge_source": "l3_lite_error",
                    }

            # 병렬 실행
            with ThreadPoolExecutor(max_workers=self.max_parallel) as executor:
                for idx, entry in executor.map(_run_lite, pending_for_l3):
                    pre_verified[idx] = entry
                    total_rejudge_tokens += entry.get("rejudge_tokens", 0)

        verified = [v for v in pre_verified if v is not None]

        latency_ms = (time.perf_counter() - start) * 1000

        # 집계 플래그
        all_safe = all(v["status"] != "blocked" and v["status"] != "failed" for v in verified)
        all_clean = all(v["status"] == "passed" for v in verified)

        return {
            "verified_suggestions": verified,
            "all_safe": all_safe,
            "all_clean": all_clean,
            "total_retries": 0,
            "latency_ms": round(latency_ms),
            "rejudge_tokens": total_rejudge_tokens,
            "mode": "medium_d12_hotfix2" if self.judge is not None else "lite_binary",
        }
