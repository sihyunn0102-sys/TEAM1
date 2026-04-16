"""
L3 Judge — GPT-4o 위반 판정

입력: 광고 카피 + RAG 컨텍스트 (L2 결과)
출력: 구조화된 판정 {verdict, confidence, reasoning, violations, legal_basis, ...}

프롬프트: prompts/judge/grounded.txt
"""
from __future__ import annotations
import os
import json
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import AzureOpenAI


PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts" / "judge"


class Judge:
    """L3 Judge — GPT-4o 기반 위반 판정."""

    def __init__(self, env_path: Path | None = None, prompt_version: str = "grounded"):
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
        self.system_prompt = prompt_path.read_text(encoding="utf-8")
        self.prompt_version = prompt_version

    def _format_context(self, chunks: list[dict]) -> str:
        """RAG 청크를 LLM에 넣을 컨텍스트로 포맷."""
        if not chunks:
            return "(검색된 관련 문서 없음)"

        lines = []
        for i, c in enumerate(chunks, 1):
            header_parts = [f"[{i}] source_id: {c.get('source_id', '?')}"]
            header_parts.append(f"type: {c.get('type', '?')}")
            header_parts.append(f"source: {c.get('source', '?')}")

            if c.get("law_name") and c.get("article_no"):
                header_parts.append(
                    f"법령: {c['law_name']} {c['article_no']} ({c.get('article_title', '')})"
                )
            if c.get("decision_no"):
                case_title = c.get("case_title") or ""
                header_parts.append(
                    f"의결: {c['decision_no']} {case_title[:30]}"
                )

            rerank = c.get("rerank_score", 0)
            header_parts.append(f"rerank={rerank:.2f}")

            lines.append(" | ".join(header_parts))
            content = c.get("content", "")[:1200]
            lines.append(content)
            lines.append("")

        return "\n".join(lines)

    def judge(
        self,
        copy: str,
        rag_chunks: list[dict],
        context=None,  # ProductContext | None
    ) -> dict:
        """
        광고 카피 판정.

        Args:
            copy: 판정할 광고 카피
            rag_chunks: L2 Retriever가 반환한 청크 리스트

        Returns:
            {
              "verdict": "hard_block" | "caution" | "safe",
              "confidence": 0.0~1.0,
              "reasoning": "...",
              "violations": [...],
              "legal_basis": [...],
              "referenced_sources": [...],
              "suggested_next_step": "...",
              "latency_ms": 2345,
              "usage": {"prompt_tokens": 1200, "completion_tokens": 400},
              "prompt_version": "grounded"
            }
        """
        start = time.perf_counter()

        rag_context_text = self._format_context(rag_chunks)

        # 제품 컨텍스트 블록 (일반/기능성 구분 시 판정 기준 조정)
        product_ctx_block = ""
        if context is not None:
            product_ctx_block = f"\n{context.to_prompt_block()}\n"

        user_message = f"""## 판정 대상 카피

"{copy}"
{product_ctx_block}
## 검색된 관련 문서 (RAG)

{rag_context_text}

## 판정

위 카피를 화장품법·표시광고법·식약처 지침·KCIA 자문기준에 따라 판정하세요.
검색된 문서를 근거로 활용하세요.
제품 컨텍스트가 제공된 경우, 해당 완화·엄격 원칙을 반영하세요.
JSON 스키마대로만 응답하세요."""

        response = self.client.chat.completions.create(
            model=self.deployment,
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": user_message},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=1500,
        )

        content = response.choices[0].message.content
        result = json.loads(content)

        latency_ms = (time.perf_counter() - start) * 1000

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
    from retriever import Retriever

    retriever = Retriever()
    judge = Judge()

    test_copies = [
        "바르는 보톡스로 피부가 부활한다, 14일의 기적을 경험하세요",
        "매일의 작은 습관이 피부를 빛나게 합니다",
        "주름 개선 30% 입증된 기능성 크림",
    ]

    for copy in test_copies:
        print("=" * 70)
        print(f"카피: \"{copy}\"")
        print()

        # L2: 검색
        retrieval = retriever.retrieve(copy, top_k=5)
        print(f"🔍 L2 RAG 검색: {len(retrieval['chunks'])}개 청크 ({retrieval['latency_ms']}ms)")

        # L3: 판정
        verdict = judge.judge(copy, retrieval["chunks"])
        emoji = {"hard_block": "🔴", "caution": "🟡", "safe": "🟢"}.get(verdict["verdict"], "❓")
        print(f"{emoji} {verdict['verdict'].upper()} (confidence {verdict['confidence']:.2f})")
        print(f"   {verdict.get('reasoning', '')}")

        if verdict.get("violations"):
            print(f"\n위반 ({len(verdict['violations'])}개):")
            for v in verdict["violations"]:
                print(f"  - [{v.get('type')}/{v.get('severity')}] \"{v.get('phrase')}\"")
                print(f"      {v.get('explanation')}")

        if verdict.get("legal_basis"):
            print(f"\n법적 근거: {', '.join(verdict['legal_basis'])}")

        print(f"\n⏱ {verdict['latency_ms']:.0f}ms, 토큰 {verdict['usage']['total_tokens']}")
        print()
