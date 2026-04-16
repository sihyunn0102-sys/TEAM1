"""
L1 Rule Engine v2 — Substring + Regex + Negation + Functional 예외

개선 사항 (v1 → v2):
    1. 정규식 패턴 지원 (수치·시점·발모 등 동적 표현)
    2. 각 카테고리에 법령 매핑 (legal_basis, reason)
    3. 부정 맥락 감지 ("보톡스 없는 크림" → safe)
    4. 긍정 플래그 (기능성화장품 보고 완료 → functional_approved)
    5. 심각도 다운그레이드 로직

입력: 광고 카피 문자열
출력: {
  verdict: "hard_block" | "caution" | "functional_conditional" | "pass",
  matched_keywords: [
    {keyword, category, level, legal_basis, reason, match_method, downgraded, ...}
  ],
  flags: {negation_detected, functional_approved, evidence_cited},
  latency_ms: 1.2,
  rule_version: "2.0"
}
"""
from __future__ import annotations
import re
import time
import yaml
from pathlib import Path
from typing import Literal


Verdict = Literal["hard_block", "caution", "functional_conditional", "pass"]
LEVEL_ORDER = ["hard_block", "caution", "functional_conditional", "pass"]
DOWNGRADE_MAP = {
    "hard_block": "caution",
    "caution": "pass",
    "functional_conditional": "pass",
    "pass": "pass",
}


class RuleEngine:
    """v2 Rule Engine — 하이브리드 매칭 + 법령 매핑 + 부정 맥락."""

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

        # Substring 패턴 — (level, category, keyword, legal_basis, reason)
        self.substring_rules: list[dict] = []
        for level in ["hard_block", "caution", "functional_conditional"]:
            groups = data.get("substring_patterns", {}).get(level, {})
            for category, info in groups.items():
                legal_basis = info.get("legal_basis", [])
                reason = info.get("reason", "")
                for kw in info.get("keywords", []):
                    self.substring_rules.append({
                        "level": level,
                        "category": category,
                        "keyword": kw.lower(),
                        "legal_basis": legal_basis,
                        "reason": reason,
                        "method": "substring",
                    })
        # 긴 키워드 우선 (바르는 보톡스 > 보톡스)
        self.substring_rules.sort(key=lambda x: len(x["keyword"]), reverse=True)

        # Regex 패턴
        self.regex_rules: list[dict] = []
        for level in ["hard_block", "caution", "functional_conditional"]:
            groups = data.get("regex_patterns", {}).get(level, {})
            for category, patterns in groups.items():
                for p in patterns:
                    self.regex_rules.append({
                        "level": level,
                        "category": category,
                        "pattern": re.compile(p["pattern"], re.IGNORECASE),
                        "legal_basis": p.get("legal_basis", []),
                        "reason": p.get("reason", ""),
                        "example": p.get("example", ""),
                        "method": "regex",
                    })

        # 부정 감지
        neg = data.get("negation", {})
        self.neg_window = neg.get("window", 15)
        self.neg_patterns = [
            re.compile(p) for p in neg.get("patterns", [])
        ]

        # 긍정 플래그
        flags = data.get("positive_flags", {})
        self.functional_approved_patterns = [
            re.compile(p) for p in flags.get("functional_approved", {}).get("patterns", [])
        ]
        self.evidence_patterns = [
            re.compile(p) for p in flags.get("evidence_cited", {}).get("patterns", [])
        ]

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

    # -------------------- 부정 맥락 --------------------

    def _is_negated(self, text: str, start: int, end: int) -> bool:
        """매칭 위치 주변 window 내 부정 표현 검색."""
        left = max(0, start - self.neg_window)
        right = min(len(text), end + self.neg_window)
        neighborhood = text[left:right]
        return any(p.search(neighborhood) for p in self.neg_patterns)

    # -------------------- 긍정 플래그 --------------------

    def _check_functional_approved(self, text: str) -> bool:
        return any(p.search(text) for p in self.functional_approved_patterns)

    def _check_evidence_cited(self, text: str) -> bool:
        return any(p.search(text) for p in self.evidence_patterns)

    # -------------------- 메인 --------------------

    def check(self, copy: str) -> dict:
        start_time = time.perf_counter()
        text_lower = copy.lower()

        # 1. 매칭 수집
        all_matches = self._match_substring(text_lower) + self._match_regex(copy)

        # 2. 부정 맥락 → 다운그레이드
        negation_count = 0
        for m in all_matches:
            if self._is_negated(copy, m["start"], m["end"]):
                original_level = m["level"]
                m["level"] = DOWNGRADE_MAP[original_level]
                m["downgraded"] = True
                m["downgrade_reason"] = "negation_detected"
                negation_count += 1
            else:
                m["downgraded"] = False

        # 3. 긍정 플래그 (기능성 승인 → functional_conditional → safe)
        functional_approved = self._check_functional_approved(copy)
        if functional_approved:
            for m in all_matches:
                if m["level"] == "functional_conditional":
                    m["level"] = "pass"
                    m["downgraded"] = True
                    m["downgrade_reason"] = "functional_approved"

        # 4. 실증 언급 플래그 (caution 수치·시점 → pass 고려)
        evidence_cited = self._check_evidence_cited(copy)
        if evidence_cited:
            for m in all_matches:
                if m["level"] == "caution" and m["category"] in {
                    "수치주장", "시점단정", "배수표현"
                }:
                    m["level"] = "pass"
                    m["downgraded"] = True
                    m["downgrade_reason"] = "evidence_cited"

        # 5. 최종 verdict 결정
        levels_present = {m["level"] for m in all_matches}
        if not levels_present or levels_present == {"pass"}:
            verdict = "pass"
        else:
            for level in LEVEL_ORDER:
                if level in levels_present:
                    verdict = level
                    break

        # 6. 결과 포맷 (pass 제외한 유의미한 매치만 반환)
        significant = [m for m in all_matches if m["level"] != "pass"]
        # pass로 다운그레이드된 것도 "투명성 위해" 별도 리스트로
        downgraded = [m for m in all_matches if m.get("downgraded")]

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        return {
            "verdict": verdict,
            "matched_keywords": significant,
            "downgraded_matches": downgraded,
            "flags": {
                "negation_detected": negation_count > 0,
                "negation_count": negation_count,
                "functional_approved": functional_approved,
                "evidence_cited": evidence_cited,
            },
            "latency_ms": round(elapsed_ms, 2),
            "rule_version": self.version,
        }


# ============== 데모 및 회귀 테스트 ==============
if __name__ == "__main__":
    engine = RuleEngine()
    print(f"Rule Engine v{engine.version}")
    print(f"  소스: {len(engine.sources)}개")
    print(f"  substring 패턴: {len(engine.substring_rules)}")
    print(f"  regex 패턴: {len(engine.regex_rules)}")
    print(f"  negation 패턴: {len(engine.neg_patterns)}")
    print()

    # ========== 기본 케이스 (v1 회귀 확인) ==========
    print("━" * 60)
    print("📋 v1 회귀 테스트 — 기존 14개")
    print("━" * 60)
    v1_cases = [
        ("바르는 보톡스로 피부가 부활한다", "hard_block"),
        ("탈모 방지 샴푸", "hard_block"),
        ("셀룰라이트 제거 크림", "hard_block"),
        ("엑소좀 마이크로니들 앰플", "hard_block"),
        ("여드름 치료 솔루션", "hard_block"),
        ("피부의 운명을 바꾸는 14일의 기적", "caution"),
        ("100% 만족, 완벽한 피부", "caution"),
        ("2주 만에 피부 환생", "caution"),
        ("주름 개선 크림", "functional_conditional"),
        ("미백 에센스", "functional_conditional"),
        ("탈모 증상 완화 샴푸", "functional_conditional"),
        ("갈증은 우리를 빛나게 하니까", "pass"),
        ("매일 쓰는 촉촉한 크림", "pass"),
        ("나에게 집중, 보습에 집중", "pass"),
    ]

    # ========== v2 신규 엣지 케이스 ==========
    v2_cases = [
        # 부정 맥락
        ("보톡스 효과가 없는 자연 크림", "pass"),  # hard_block → downgrade
        ("셀룰라이트 제거가 아닌 순한 보습 크림", "caution"),  # hard → caution
        # 긍정 플래그 (기능성 보고 완료)
        ("주름 개선 기능성화장품 보고 완료", "pass"),  # functional → pass
        ("미백 기능성화장품 심사 완료 에센스", "pass"),
        # 실증 언급
        ("인체적용시험 결과 2주 후 피부톤 개선", "pass"),  # caution → pass
        ("자사 설문 n=100, 98% 만족 시험 결과", "pass"),
        # 신규 정규식 패턴
        ("속눈썹이 자라는 신비한 앰플", "hard_block"),  # regex 발모성장
        ("21일 만에 드라마틱한 변화", "caution"),  # regex 시점단정
        ("87% 개선 입증", "caution"),  # regex 수치주장
        ("5배 더 좋은 효과", "caution"),  # regex 배수
        ("3kg 감량 보장", "hard_block"),  # regex 체중감량
    ]

    all_cases = [("v1", v1_cases), ("v2 신규", v2_cases)]

    passed = 0
    failed = 0
    for group_name, cases in all_cases:
        print(f"\n━━━ {group_name} ({len(cases)}개) ━━━")
        for copy, expected in cases:
            result = engine.check(copy)
            verdict = result["verdict"]
            ok = verdict == expected
            if ok:
                passed += 1
            else:
                failed += 1
            emoji = "✅" if ok else "❌"
            flags = result["flags"]
            flag_str = ""
            if flags["negation_detected"]:
                flag_str += " 🚫neg"
            if flags["functional_approved"]:
                flag_str += " 🔵func"
            if flags["evidence_cited"]:
                flag_str += " 📊evid"

            print(
                f"  {emoji} exp={expected:23s} got={verdict:23s}"
                f"{flag_str}  \"{copy}\""
            )
            if not ok and result["matched_keywords"]:
                for m in result["matched_keywords"][:3]:
                    print(
                        f"       → [{m['level']}/{m['category']}] \"{m['matched']}\""
                    )

    print()
    print("━" * 60)
    print(f"✅ 통과: {passed}  |  ❌ 실패: {failed}  |  정확도: {passed/(passed+failed)*100:.0f}%")
    print("━" * 60)
