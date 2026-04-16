"""
L4 Rewriter — 동적 Few-shot 기반 광고 카피 수정안 생성기

입력: 원본 카피 + L3 Judge 결과 (verdict, violations, legal_basis)
출력: safe / marketing / functional 3스타일 수정안

핵심:
  - FewshotSelector로 원본 카피와 유사한 사례 동적 선별
  - 선별된 Few-shot을 프롬프트에 실시간 주입
  - GPT-4o JSON 모드로 구조화된 수정안 생성
"""
from __future__ import annotations
import os
import re
import json
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import AzureOpenAI

from fewshot_selector import FewshotSelector


# 식약처 기능성화장품 심사번호 패턴 (환각 방지)
# 예: "제2024-01234호", "2024-01234"
CERTIFICATION_NO_PATTERN = re.compile(
    r"제?\s*\d{4}\s*[-–]\s*\d{4,5}\s*호?"
)


def sanitize_rewrite_text(text: str, certification_no: str | None) -> str:
    """
    L4 출력에서 심사번호 환각 제거.

    - context.certification_no가 없는데 GPT가 심사번호 지어내면 → 플레이스홀더
    - context.certification_no가 있는데 다른 번호가 나오면 → 실제 번호로 치환

    Args:
        text: L4가 생성한 수정안 텍스트
        certification_no: 사용자가 제공한 정확한 심사번호

    Returns:
        환각이 제거·치환된 텍스트
    """
    matches = CERTIFICATION_NO_PATTERN.findall(text)
    if not matches:
        return text

    if not certification_no:
        # 사용자가 심사번호 제공 안 했는데 GPT가 지어냄 → 제거
        for match in matches:
            text = text.replace(match, "[기능성화장품 심사번호 확인 필요]")
        return text

    # 사용자가 준 심사번호가 있는데 다른 번호가 나옴 → 치환
    normalized_cert = certification_no.replace(" ", "").replace("-", "")
    for match in matches:
        normalized_match = match.replace(" ", "").replace("-", "")
        if normalized_match not in normalized_cert and normalized_cert not in normalized_match:
            text = text.replace(match, certification_no)

    return text


PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts" / "rewriter"


class Rewriter:
    """L4 Rewriter — 동적 Few-shot + GPT-4o 기반 수정안 생성."""

    def __init__(
        self,
        retriever,
        prompt_version: str = "v3_dynamic",
        env_path: Path | None = None,
    ):
        if env_path is None:
            env_path = Path(__file__).resolve().parent.parent / ".env"
        load_dotenv(env_path)

        self.client = AzureOpenAI(
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21"),
        )
        self.deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")

        prompt_path = PROMPT_DIR / f"{prompt_version}.txt"
        self.base_prompt = prompt_path.read_text(encoding="utf-8")
        self.prompt_version = prompt_version

        self.selector = FewshotSelector(retriever)

    def _format_judge_result(self, judge_result: dict) -> str:
        """L3 Judge 결과를 user message 포맷으로 변환."""
        lines = []
        lines.append(f"**L3 Judge 판정**: `{judge_result.get('verdict', '?')}`")
        lines.append(f"**confidence**: {judge_result.get('confidence', 0):.2f}")
        lines.append("")

        violations = judge_result.get("violations", [])
        if violations:
            lines.append("**위반 요소**:")
            for v in violations:
                phrase = v.get("phrase", "")
                vtype = v.get("type", "")
                severity = v.get("severity", "")
                explanation = v.get("explanation", "")
                lines.append(f"- [{vtype}/{severity}] \"{phrase}\" — {explanation}")
            lines.append("")

        legal_basis = judge_result.get("legal_basis", [])
        if legal_basis:
            lines.append(f"**법적 근거**: {', '.join(legal_basis)}")
            lines.append("")

        suggested = judge_result.get("suggested_next_step", "")
        if suggested:
            lines.append(f"**L3 수정 힌트**: {suggested}")

        return "\n".join(lines)

    def rewrite(
        self,
        copy: str,
        judge_result: dict,
        context=None,  # ProductContext | None
        top_k_cases: int = 3,
        top_k_precedents: int = 2,
    ) -> dict:
        """
        원본 카피에 대해 3스타일 수정안 생성.

        Args:
            copy: 원본 광고 카피
            judge_result: L3 Judge 결과 dict
            top_k_cases: 동적 선별할 cases 개수
            top_k_precedents: 동적 선별할 precedent 개수

        Returns:
            {
              "rewrite_suggestions": [
                {"style": "safe",       "text": "...", "changes": "...", "referenced_case_id": "..."},
                {"style": "marketing",  "text": "...", ...},
                {"style": "functional", "text": "...", ...}
              ],
              "rewriter_notes": "...",
              "few_shot_used": {"cases": [...], "precedents": [...]},
              "latency_ms": 5432,
              "usage": {"prompt_tokens": 2100, "completion_tokens": 450},
              "prompt_version": "v3_dynamic"
            }
        """
        start = time.perf_counter()

        # 1. 동적 Few-shot 선별
        fewshot = self.selector.select(
            copy,
            top_k_cases=top_k_cases,
            top_k_precedents=top_k_precedents,
        )

        # 2. 시스템 프롬프트 = base + 동적 Few-shot + (선택) 제품 컨텍스트
        fewshot_text = self.selector.format_for_prompt(fewshot)
        system_prompt = self.base_prompt + "\n\n" + fewshot_text

        if context is not None:
            system_prompt += "\n\n" + context.to_prompt_block()
            # 환각 방지 — 심사번호 제약을 명시적으로
            if context.is_functional:
                if context.certification_no:
                    system_prompt += (
                        f"\n\n🚨 심사번호 제약: functional 스타일 수정안에 심사번호를 언급할 때 "
                        f"반드시 `{context.certification_no}`만 사용. 다른 번호 지어내기 절대 금지."
                    )
                else:
                    system_prompt += (
                        "\n\n🚨 심사번호 제약: 사용자가 심사번호를 제공하지 않았습니다. "
                        "수정안에 임의의 심사번호를 지어내지 마세요. "
                        "필요하면 '[기능성화장품 심사번호 확인 필요]' 플레이스홀더를 사용."
                    )

        # 3. user 메시지 조립
        judge_text = self._format_judge_result(judge_result)
        user_message = f"""## 원본 광고 카피

"{copy}"

## L3 Judge 결과

{judge_text}

## 요청

위 원본 카피를 safe / marketing / functional 3가지 스타일로 수정해주세요.
동적 Few-shot 사례의 변환 패턴을 참고하되, 원본의 브랜드 아이덴티티는 유지하세요.
JSON 스키마대로만 응답하세요."""

        # 4. GPT-4o 호출
        response = self.client.chat.completions.create(
            model=self.deployment,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,  # 다양성 약간 허용 (safe는 0.1, L4는 창의성 필요)
            max_tokens=1200,
        )

        content = response.choices[0].message.content
        result = json.loads(content)

        # 환각 방지 — 수정안 텍스트에서 가짜 심사번호 제거·치환 (코드 레벨 이중 방어)
        cert_no = context.certification_no if context is not None else None
        for suggestion in result.get("rewrite_suggestions", []):
            original_text = suggestion.get("text", "")
            sanitized_text = sanitize_rewrite_text(original_text, cert_no)
            if sanitized_text != original_text:
                suggestion["text"] = sanitized_text
                suggestion["sanitized"] = True  # 치환 발생 마킹

        latency_ms = (time.perf_counter() - start) * 1000

        result["few_shot_used"] = {
            "cases": [c.get("id") for c in fewshot["cases"]],
            "precedents": [p.get("source_id") for p in fewshot["precedents"]],
        }
        result["latency_ms"] = round(latency_ms, 0)
        result["usage"] = {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
        }
        result["prompt_version"] = self.prompt_version

        return result


# ============== 데모 ==============
if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from retriever import Retriever
    from judge import Judge

    print("L4 Rewriter 테스트")
    print()

    retriever = Retriever()
    judge = Judge(prompt_version="grounded")
    rewriter = Rewriter(retriever)

    test_copies = [
        "바르는 보톡스 크림으로 14일 만에 피부가 부활합니다",
        "원데이 엑소좀 샷 앰플 — 세포 차원의 혁명",
        "여드름 100% 완치 보장 — 피부과 의사가 만든 크림",
    ]

    for copy in test_copies:
        print("=" * 70)
        print(f"📝 원본: \"{copy}\"")
        print()

        # L2 → L3
        retrieval = retriever.retrieve(copy, top_k=5)
        judge_result = judge.judge(copy, retrieval["chunks"])
        print(f"⚖️ L3 판정: {judge_result['verdict']}")
        if judge_result.get("violations"):
            for v in judge_result["violations"][:2]:
                print(f"    - [{v.get('type')}] \"{v.get('phrase')}\"")
        print()

        # L4
        rewrite = rewriter.rewrite(copy, judge_result)
        print(f"✍️ L4 Rewriter ({rewrite['latency_ms']}ms, {rewrite['usage']['total_tokens']} 토큰)")
        print(f"   few_shot: cases={rewrite['few_shot_used']['cases']}")
        print()

        for r in rewrite.get("rewrite_suggestions", []):
            style = r.get("style", "?")
            emoji = {"safe": "🟢", "marketing": "🟡", "functional": "🔵"}.get(style, "❓")
            text = r.get("text", "")
            changes = r.get("changes", "")
            print(f"  {emoji} [{style}]")
            print(f"     \"{text}\"")
            if changes:
                print(f"     ↳ {changes}")

        notes = rewrite.get("rewriter_notes", "")
        if notes:
            print(f"\n  📝 notes: {notes}")
        print()
