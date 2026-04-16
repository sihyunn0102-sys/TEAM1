"""
L2 Retriever — Azure AI Search 하이브리드 검색 래퍼.

입력: 광고 카피
출력: Top-K 관련 청크 [{source_id, content, type, source, score, rerank_score, ...}]

특징:
  - BM25 + Vector + Semantic Ranker 하이브리드
  - 쿼리 임베딩 자동 생성
  - 필터 지원 (type, source 등)
"""
from __future__ import annotations
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from openai import AzureOpenAI


# 기본 검색 필드 (L3 Judge에 넘길 정보)
DEFAULT_SELECT_FIELDS = [
    "source_id",
    "content",
    "type",
    "source",
    "topic",
    "source_file",
    "law_name",
    "article_no",
    "article_title",
    "chapter",
    "decision_no",
    "case_title",
    "respondent",
    "decision_date",
    "section_name",
]


class Retriever:
    """Azure AI Search 하이브리드 검색."""

    def __init__(self, env_path: Path | None = None):
        if env_path is None:
            env_path = Path(__file__).resolve().parent.parent / ".env"
        load_dotenv(env_path)

        self.aoai = AzureOpenAI(
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version=os.getenv("AZURE_OPENAI_EMBEDDING_API_VERSION", "2023-05-15"),
        )
        self.embed_deployment = os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-large")

        self.search = SearchClient(
            endpoint=os.getenv("AZURE_SEARCH_ENDPOINT"),
            index_name=os.getenv("AZURE_SEARCH_INDEX_NAME", "adguard-main"),
            credential=AzureKeyCredential(os.getenv("AZURE_SEARCH_API_KEY")),
        )

    def _embed(self, text: str) -> list[float]:
        resp = self.aoai.embeddings.create(model=self.embed_deployment, input=[text])
        return resp.data[0].embedding

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        filter_expr: str | None = None,
        use_semantic: bool = True,
    ) -> dict:
        """
        하이브리드 검색 실행.

        반환:
            {
              "query": "...",
              "chunks": [{source_id, content, type, source, score, rerank_score, ...}],
              "latency_ms": 123.4,
              "total_tokens": 450
            }
        """
        start = time.perf_counter()

        # 쿼리 임베딩
        query_vector = self._embed(query)

        # 벡터 쿼리
        vector_query = VectorizedQuery(
            vector=query_vector,
            k_nearest_neighbors=top_k * 2,
            fields="content_vector",
        )

        # 검색 실행
        kwargs = dict(
            search_text=query,
            vector_queries=[vector_query],
            filter=filter_expr,
            top=top_k,
            select=DEFAULT_SELECT_FIELDS,
        )

        if use_semantic:
            kwargs["query_type"] = "semantic"
            kwargs["semantic_configuration_name"] = "default-semantic"

        results = self.search.search(**kwargs)

        chunks = []
        for r in results:
            chunks.append({
                "source_id": r.get("source_id"),
                "content": r.get("content", ""),
                "type": r.get("type"),
                "source": r.get("source"),
                "topic": r.get("topic", []),
                "source_file": r.get("source_file"),
                "law_name": r.get("law_name"),
                "article_no": r.get("article_no"),
                "article_title": r.get("article_title"),
                "chapter": r.get("chapter"),
                "decision_no": r.get("decision_no"),
                "case_title": r.get("case_title"),
                "respondent": r.get("respondent"),
                "decision_date": r.get("decision_date"),
                "section_name": r.get("section_name"),
                "score": r.get("@search.score", 0),
                "rerank_score": r.get("@search.reranker_score", 0),
            })

        latency_ms = (time.perf_counter() - start) * 1000

        return {
            "query": query,
            "chunks": chunks,
            "latency_ms": round(latency_ms, 1),
            "top_k": top_k,
            "filter": filter_expr,
        }


# ============== 데모 ==============
if __name__ == "__main__":
    retriever = Retriever()

    print("L2 Retriever 테스트")
    print()

    queries = [
        ("바르는 보톡스 같은 표현이 위반인 이유", None),
        ("기능성화장품 주름개선 수치 표현 가능 조건", None),
        ("뒷광고 경제적 이해관계 표시 위치", "type eq 'precedent'"),
    ]

    for q, f in queries:
        print(f"🔍 {q}")
        if f:
            print(f"   필터: {f}")
        result = retriever.retrieve(q, top_k=3, filter_expr=f)
        print(f"   ⏱ {result['latency_ms']}ms")
        for i, c in enumerate(result["chunks"], 1):
            rerank = c["rerank_score"]
            src = c["source_id"][:50]
            print(f"   [{i}] rerank={rerank:.2f} {src}")
            snippet = c["content"][:100].replace("\n", " ")
            print(f"       {snippet}...")
        print()
