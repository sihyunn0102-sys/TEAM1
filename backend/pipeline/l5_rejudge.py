"""
L5 Re-Judge — L4 수정안 재검증 루프

입력: 원본 카피 + L3 결과 + L4 수정안 3개
처리:
  1. 각 수정안을 L3 Judge(grounded)에 재투입
  2. safe가 아니면 L4에 "재수정 요청" (최대 max_retries회)
  3. 최종 safe 통과 수정안만 반환

출력:
  - verified_suggestions: [3스타일 × 최종 verdict]
  - retry_stats: 재시도 횟수 기록
  - all_safe: 3개 모두 safe 통과 여부
"""
from __future__ import annotations
import time
from concurrent.futures import ThreadPoolExecutor, as_completed


class ReJudge:
    """L5 Re-Judge — L4 수정안 재검증 + 재시도 루프."""

    def __init__(
        self,
        retriever,
        judge,
        rewriter,
        max_retries: int = 2,
        parallel: bool = True,
    ):
        """
        Args:
            retriever: L2 Retriever
            judge: L3 Judge (grounded)
            rewriter: L4 Rewriter
            max_retries: 실패 시 L4 재요청 최대 횟수 (기본 2)
            parallel: 3개 수정안을 병렬 재판정 (기본 True)
                - True: ThreadPoolExecutor로 동시 호출 → ~5초
                - False: 순차 호출 → ~15초
        """
        self.retriever = retriever
        self.judge = judge
        self.rewriter = rewriter
        self.max_retries = max_retries
        self.parallel = parallel

    def _rejudge_single(self, text: str, context=None) -> dict:
        """단일 수정안을 L3에 재투입 (동일 제품 컨텍스트로)."""
        retrieval = self.retriever.retrieve(text, top_k=5)
        result = self.judge.judge(text, retrieval["chunks"], context=context)
        return {
            "verdict": result.get("verdict"),
            "confidence": result.get("confidence", 0),
            "violations": result.get("violations", []),
            "matched_phrase": result.get("matched_phrase"),
            "law_citation": result.get("law_citation"),
        }

    def _verify_one_suggestion(
        self,
        original_copy: str,
        suggestion: dict,
        context=None,
    ) -> dict:
        """
        단일 수정안 1개를 검증 (재판정 + 재시도 루프).

        이 메서드를 ThreadPoolExecutor로 3개 동시 호출하면
        전체 L5 시간이 15초 → 5초로 단축.
        """
        style = suggestion.get("style", "?")
        current_text = suggestion.get("text", "")
        history = []
        local_retries = 0

        if not current_text:
            return {
                "style": style,
                "text": "",
                "verdict": "empty",
                "retry_count": 0,
                "status": "failed",
                "history": [],
                "retries_used": 0,
            }

        retry = 0
        while True:
            rejudge = self._rejudge_single(current_text, context=context)
            verdict = rejudge["verdict"]
            history.append({
                "text": current_text,
                "verdict": verdict,
                "retry": retry,
            })

            if verdict == "safe":
                return {
                    "style": style,
                    "text": current_text,
                    "verdict": "safe",
                    "retry_count": retry,
                    "status": "passed",
                    "history": history,
                    "matched_phrase": rejudge.get("matched_phrase"),
                    "law_citation": rejudge.get("law_citation"),
                    "retries_used": local_retries,
                }

            if retry >= self.max_retries:
                return {
                    "style": style,
                    "text": current_text,
                    "verdict": verdict,
                    "retry_count": retry,
                    "status": "failed",
                    "history": history,
                    "failure_reason": (
                        f"max_retries({self.max_retries}) 초과. "
                        f"최종 L3 verdict: {verdict}"
                    ),
                    "retries_used": local_retries,
                }

            retry += 1
            local_retries += 1
            current_text = self._request_rewrite(
                original_copy=original_copy,
                failed_text=current_text,
                failed_verdict=verdict,
                rejudge_info=rejudge,
                style=style,
                retry=retry,
            )

            if not current_text:
                return {
                    "style": style,
                    "text": "",
                    "verdict": "retry_failed",
                    "retry_count": retry,
                    "status": "failed",
                    "history": history,
                    "failure_reason": "L4 재생성 실패",
                    "retries_used": local_retries,
                }

    def verify(
        self,
        original_copy: str,
        l3_result: dict,
        l4_result: dict,
        context=None,
    ) -> dict:
        """
        L4 수정안 3개를 L3에 재투입하여 검증 (기본 병렬).

        Args:
            original_copy: 원본 카피
            l3_result: L3 Judge 결과 (verdict, violations 등)
            l4_result: L4 Rewriter 결과 (rewrite_suggestions 포함)

        Returns:
            {
              "verified_suggestions": [
                {"style": "safe", "text": "...", "verdict": "safe", ...},
                ...
              ],
              "all_safe": True,
              "total_retries": 0,
              "latency_ms": 5000,
              "mode": "parallel" | "sequential"
            }
        """
        start = time.perf_counter()
        suggestions = l4_result.get("rewrite_suggestions", [])

        if self.parallel and len(suggestions) > 1:
            # 병렬 실행 — ThreadPoolExecutor로 3개 동시
            verified = [None] * len(suggestions)
            with ThreadPoolExecutor(max_workers=len(suggestions)) as executor:
                future_to_idx = {
                    executor.submit(self._verify_one_suggestion, original_copy, s, context): i
                    for i, s in enumerate(suggestions)
                }
                for future in as_completed(future_to_idx):
                    idx = future_to_idx[future]
                    try:
                        verified[idx] = future.result()
                    except Exception as e:
                        print(f"  [L5] 병렬 처리 실패 idx={idx}: {e}")
                        verified[idx] = {
                            "style": suggestions[idx].get("style", "?"),
                            "text": suggestions[idx].get("text", ""),
                            "verdict": "error",
                            "retry_count": 0,
                            "status": "failed",
                            "failure_reason": str(e),
                            "retries_used": 0,
                        }
            mode = "parallel"
        else:
            # 순차 실행 (기존 방식)
            verified = [
                self._verify_one_suggestion(original_copy, s, context=context)
                for s in suggestions
            ]
            mode = "sequential"

        total_retries = sum(v.get("retries_used", 0) for v in verified)
        latency_ms = (time.perf_counter() - start) * 1000
        all_safe = all(v["status"] == "passed" for v in verified)

        return {
            "verified_suggestions": verified,
            "all_safe": all_safe,
            "total_retries": total_retries,
            "latency_ms": round(latency_ms),
            "mode": mode,
        }

    def _request_rewrite(
        self,
        original_copy: str,
        failed_text: str,
        failed_verdict: str,
        rejudge_info: dict,
        style: str,
        retry: int,
    ) -> str:
        """
        L4에 재수정 요청.

        실패한 수정안과 그 이유를 담아 L4에 다시 호출.
        반환: 새로운 수정안 텍스트 (해당 style만 추출).
        """
        # L3 재판정 정보를 가짜 judge_result로 포장
        pseudo_judge = {
            "verdict": failed_verdict,
            "confidence": rejudge_info.get("confidence", 0.8),
            "violations": rejudge_info.get("violations", []),
            "legal_basis": (
                [rejudge_info.get("law_citation")]
                if rejudge_info.get("law_citation")
                else []
            ),
            "suggested_next_step": (
                f"이전 수정안 '{failed_text}'이 {failed_verdict} 판정을 받음. "
                f"매칭 조항: {rejudge_info.get('matched_phrase') or '(없음)'}. "
                f"해당 표현을 완전히 제거하고 {style} 스타일로 다시 작성."
            ),
        }

        try:
            new_l4 = self.rewriter.rewrite(
                failed_text,  # 이전 수정안을 원본으로 취급
                pseudo_judge,
                top_k_cases=3,
            )
        except Exception as e:
            print(f"  [L5] L4 재호출 실패 (retry={retry}): {e}")
            return ""

        # 해당 style만 추출
        for s in new_l4.get("rewrite_suggestions", []):
            if s.get("style") == style:
                return s.get("text", "")

        # style이 안 나왔으면 첫 번째 사용
        if new_l4.get("rewrite_suggestions"):
            return new_l4["rewrite_suggestions"][0].get("text", "")

        return ""


# ============== 데모 ==============
if __name__ == "__main__":
    import sys
    from pathlib import Path

    sys.stdout.reconfigure(encoding="utf-8")
    sys.path.insert(0, str(Path(__file__).resolve().parent))

    from retriever import Retriever
    from judge import Judge
    from l4_rewriter import Rewriter

    print("L5 Re-Judge 테스트\n")

    retriever = Retriever()
    judge = Judge(prompt_version="grounded")
    rewriter = Rewriter(retriever, prompt_version="v3_dynamic")
    rejudge = ReJudge(retriever, judge, rewriter, max_retries=2)

    test_copies = [
        "바르는 보톡스 크림으로 14일 만에 피부가 부활합니다",
        "원데이 엑소좀 샷 앰플 — 세포 차원의 혁명",
        "98% 보송함, 완벽한 피부 변화",
    ]

    for copy in test_copies:
        print("=" * 70)
        print(f"📝 원본: \"{copy}\"")

        # L2 → L3 → L4
        retrieval = retriever.retrieve(copy, top_k=5)
        l3 = judge.judge(copy, retrieval["chunks"])
        print(f"⚖️ L3: {l3['verdict']}")

        l4 = rewriter.rewrite(copy, l3)
        print(f"✍️ L4: {len(l4['rewrite_suggestions'])}개 수정안 생성")
        for s in l4["rewrite_suggestions"]:
            print(f"   [{s['style']}] {s['text']}")

        # L5
        print(f"\n🔍 L5 Re-Judge 시작...")
        l5 = rejudge.verify(copy, l3, l4)

        print(f"\n✅ 재검증 결과 ({l5['latency_ms']}ms, 재시도 {l5['total_retries']}회)")
        print(f"   all_safe: {l5['all_safe']}")
        for v in l5["verified_suggestions"]:
            emoji = "✅" if v["status"] == "passed" else "❌"
            print(f"   {emoji} [{v['style']}] {v['verdict']} (retry {v['retry_count']})")
            print(f"      \"{v['text']}\"")
            if v["status"] == "failed":
                print(f"      ⚠ {v.get('failure_reason', '')}")
        print()
