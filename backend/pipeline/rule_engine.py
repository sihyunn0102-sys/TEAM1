"""
L1 Rule Engine — 확정 위반(hard_block) 전용 바이너리 필터 (D12+)

설계 원칙 (D12 리팩터):
    L1의 책임은 **명백한 위반을 빠르게 차단**하는 것만으로 축소.
    맥락 판단·부정 감지·기능성 승인·실증 확인 같은 **semantic 판단은 전부 L3로 이전**.

출력 verdict: 2-state
    - "hard_block": 확정 위반어가 매칭됨 (보톡스·지방분해·셀룰라이트 제거 등)
    - "pass":      매칭 없음. L3에게 맥락 판단을 위임

이전 구조 대비 제거된 것 (D12):
    - caution / functional_conditional 출력 (→ L3가 담당)
    - 부정 맥락 다운그레이드 (→ L3 grounded.txt 지침)
    - 긍정 플래그 (functional_approved / evidence_cited) (→ L3 grounded.txt)
    - DOWNGRADE_MAP / LEVEL_ORDER

blocklist.yaml도 동일하게 hard_block 섹션만 유지되도록 D12에서 정리됨.
"""
from __future__ import annotations
import re
import time
import yaml
from pathlib import Path
from typing import Literal


Verdict = Literal["hard_block", "pass"]


class RuleEngine:
    """L1 Rule Engine — hard_block 전용 바이너리 필터."""

    def __init__(self, blocklist_path: Path | None = None):
        if blocklist_path is None:
            blocklist_path = (
                Path(__file__).resolve().parent.parent / "configs" / "blocklist.yaml"
            )
        self.blocklist_path = blocklist_path
        self._load()

    def _load(self):
        with self.blocklist_path.open(encoding="utf-8") as f:
            data = yaml.safe_load(f)

        self.version = data.get("version", "unknown")
        self.sources = data.get("sources", [])

        # Substring 패턴 — hard_block만 로드
        self.substring_rules: list[dict] = []
        groups = data.get("substring_patterns", {}).get("hard_block", {})
        for category, info in groups.items():
            legal_basis = info.get("legal_basis", [])
            reason = info.get("reason", "")
            for kw in info.get("keywords", []):
                self.substring_rules.append({
                    "level": "hard_block",
                    "category": category,
                    "keyword": kw.lower(),
                    "legal_basis": legal_basis,
                    "reason": reason,
                    "method": "substring",
                })
        # 긴 키워드 우선 (바르는 보톡스 > 보톡스)
        self.substring_rules.sort(key=lambda x: len(x["keyword"]), reverse=True)

        # Regex 패턴 — hard_block만 로드
        self.regex_rules: list[dict] = []
        groups = data.get("regex_patterns", {}).get("hard_block", {})
        for category, patterns in groups.items():
            for p in patterns:
                self.regex_rules.append({
                    "level": "hard_block",
                    "category": category,
                    "pattern": re.compile(p["pattern"], re.IGNORECASE),
                    "legal_basis": p.get("legal_basis", []),
                    "reason": p.get("reason", ""),
                    "example": p.get("example", ""),
                    "method": "regex",
                })

    # -------------------- 매칭 함수 --------------------

    def _match_substring(self, text_lower: str) -> list[dict]:
        matches = []
        seen = set()
        for rule in self.substring_rules:
            kw = rule["keyword"]
            if kw in text_lower and kw not in seen:
                start = text_lower.index(kw)
                matches.append({
                    **rule,
                    "matched": kw,
                    "start": start,
                    "end": start + len(kw),
                })
                seen.add(kw)
        return matches

    def _match_regex(self, text: str) -> list[dict]:
        matches = []
        for rule in self.regex_rules:
            for m in rule["pattern"].finditer(text):
                matches.append({
                    **rule,
                    "matched": m.group(0),
                    "start": m.start(),
                    "end": m.end(),
                    "pattern": rule["pattern"].pattern,
                })
        return matches

    # -------------------- 메인 --------------------

    def check(self, copy: str) -> dict:
        """
        광고 카피에서 hard_block 위반어를 매칭.

        Returns:
            {
              "verdict": "hard_block" | "pass",
              "matched_keywords": [{keyword, category, legal_basis, reason, ...}],
              "latency_ms": float,
              "rule_version": str,
            }
        """
        start_time = time.perf_counter()
        text_lower = copy.lower()

        # 매칭 수집
        all_matches = self._match_substring(text_lower) + self._match_regex(copy)

        verdict: Verdict = "hard_block" if all_matches else "pass"

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        return {
            "verdict": verdict,
            "matched_keywords": all_matches,
            "latency_ms": round(elapsed_ms, 2),
            "rule_version": self.version,
        }


# ============== 데모 및 회귀 테스트 ==============
if __name__ == "__main__":
    engine = RuleEngine()
    print(f"Rule Engine v{engine.version} (D12 binary filter)")
    print(f"  소스: {len(engine.sources)}개")
    print(f"  substring 패턴: {len(engine.substring_rules)}")
    print(f"  regex 패턴: {len(engine.regex_rules)}")
    print()

    # D12 바이너리 회귀 — hard_block / pass만 기대
    cases = [
        # hard_block 카테고리
        ("바르는 보톡스로 피부가 부활한다", "hard_block"),
        ("탈모 방지 샴푸", "hard_block"),
        ("셀룰라이트 제거 크림", "hard_block"),
        ("엑소좀 마이크로니들 앰플", "hard_block"),
        ("여드름 치료 솔루션", "hard_block"),
        ("속눈썹이 자라는 신비한 앰플", "hard_block"),
        ("3kg 감량 보장", "hard_block"),
        # L3가 판단할 케이스들 (L1에선 pass)
        ("피부의 운명을 바꾸는 14일의 기적", "pass"),      # 절대표현·극적변화 → L3
        ("100% 만족, 완벽한 피부", "pass"),                # 절대표현 → L3
        ("2주 만에 피부 환생", "pass"),                    # 재생은유·시점단정 → L3
        ("주름 개선 크림", "pass"),                        # 기능성 → L3
        ("미백 에센스", "pass"),                           # 기능성 → L3
        ("탈모 증상 완화 샴푸", "pass"),                   # 기능성 → L3
        ("87% 개선 입증", "pass"),                         # 수치주장 → L3
        ("5배 더 좋은 효과", "pass"),                      # 배수 → L3
        ("21일 만에 드라마틱한 변화", "pass"),             # 시점단정 → L3
        # 부정 맥락도 이제 L3 책임 → L1에선 키워드 있으면 hard_block
        ("보톡스 효과가 없는 자연 크림", "hard_block"),    # L3가 부정 맥락으로 완화 예정
        # 완전 안전
        ("갈증은 우리를 빛나게 하니까", "pass"),
        ("매일 쓰는 촉촉한 크림", "pass"),
        ("나에게 집중, 보습에 집중", "pass"),
    ]

    passed = 0
    failed = 0
    for copy, expected in cases:
        result = engine.check(copy)
        verdict = result["verdict"]
        ok = verdict == expected
        if ok:
            passed += 1
        else:
            failed += 1
        emoji = "✅" if ok else "❌"
        print(f"  {emoji} exp={expected:12s} got={verdict:12s}  \"{copy}\"")
        if not ok and result["matched_keywords"]:
            for m in result["matched_keywords"][:3]:
                print(f"       → [{m['category']}] \"{m['matched']}\"")

    print()
    print("━" * 60)
    print(f"✅ 통과: {passed}  |  ❌ 실패: {failed}  |  정확도: {passed/(passed+failed)*100:.0f}%")
    print("━" * 60)
