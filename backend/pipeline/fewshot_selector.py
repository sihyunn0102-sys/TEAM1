"""
FewshotSelector — 동적 Few-shot 선별기

원칙:
  1. cases.jsonl은 그대로 둠 (확장 금지)
  2. 원본 카피와 가장 유사한 사례만 동적 선별
  3. 프롬프트에 하드코딩 대신 동적 주입
  4. RAG(precedent) + cases.jsonl 하이브리드

사용:
  selector = FewshotSelector(retriever)
  fewshot = selector.select(copy="바르는 보톡스 크림", top_k=3)
  # → {"cases": [...], "precedents": [...]}
"""
from __future__ import annotations
import hashlib
import json
import pickle
import time
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent.parent
CASES_PATH = ROOT / "data" / "fewshot" / "cases.jsonl"
STYLES_PATH = ROOT / "data" / "fewshot" / "styles.jsonl"
COPIES_PATH = ROOT / "data" / "fewshot" / "copies.jsonl"
# 큐레이션 (우선 사용, fallback으로 위 파일)
STYLES_ORDER_PATH = ROOT / "data" / "fewshot" / "styles_order.jsonl"
COPIES_SELECTION_PATH = ROOT / "data" / "fewshot" / "copies_selection.jsonl"

# 임베딩 캐시 디렉터리
CACHE_DIR = ROOT / "data" / "cache"


def _file_hash(*paths: Path) -> str:
    """여러 파일의 수정 시간을 합쳐 캐시 키 생성."""
    h = hashlib.md5()
    for p in paths:
        if p.exists():
            h.update(str(p.stat().st_mtime).encode())
    return h.hexdigest()


def _load_cache(cache_path: Path):
    """캐시 파일 로드. 없거나 손상된 경우 None 반환."""
    if not cache_path.exists():
        return None
    try:
        with cache_path.open("rb") as f:
            return pickle.load(f)
    except Exception:
        return None


def _save_cache(cache_path: Path, data) -> None:
    """캐시 파일 저장."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with cache_path.open("wb") as f:
        pickle.dump(data, f)


def _cosine_sim(a: list[float], b: list[float]) -> float:
    va = np.array(a)
    vb = np.array(b)
    return float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb) + 1e-9))


class FewshotSelector:
    """
    동적 Few-shot 선별기.

    cases.jsonl의 violation 케이스(변환 쌍이 있는 것들)를 미리 임베딩해두고,
    query 카피가 들어오면 코사인 유사도로 top-K 선별.

    추가로 RAG 인덱스에서 precedent(공정위 의결서) 청크도 검색해서
    실제 처분 사례를 함께 주입.
    """

    def __init__(self, retriever, use_embedding_category: bool = True):
        """
        Args:
            retriever: L2 Retriever 인스턴스 (임베딩·검색 재사용)
            use_embedding_category: True면 카테고리 추정에 임베딩 유사도 사용,
                                    False면 키워드 규칙 fallback
        """
        self.retriever = retriever
        self.use_embedding_category = use_embedding_category
        self._load_cases()
        self._load_styles()
        self._load_yoonji_styles_order()     # 큐레이션 ⭐
        self._load_copies()
        self._load_yoonji_copies_selection() # 카테고리 앵커 ⭐
        self._embed_cases()
        if use_embedding_category:
            self._embed_category_centroids()  # ⭐ 카테고리 centroid 임베딩

    def _load_cases(self):
        with CASES_PATH.open(encoding="utf-8") as f:
            all_cases = [json.loads(l) for l in f if l.strip()]

        # 변환 쌍이 있는 violation 케이스만 (safe_rewrite 최소 보유)
        self.violation_cases = [
            c for c in all_cases
            if c.get("case_type") == "violation" and c.get("safe_rewrite")
        ]

    def _load_styles(self):
        """styles.jsonl 전체 로드 (10개, 프롬프트 상수로 사용)."""
        with STYLES_PATH.open(encoding="utf-8") as f:
            self.styles = [json.loads(l) for l in f if l.strip()]

    def _load_copies(self):
        """copies.jsonl에서 safe 카피만 카테고리별로 분류 (fallback용)."""
        with COPIES_PATH.open(encoding="utf-8") as f:
            all_copies = [json.loads(l) for l in f if l.strip()]

        # risk=safe만 카테고리별로 그룹핑
        from collections import defaultdict
        self.safe_copies_by_category = defaultdict(list)
        for row in all_copies:
            if row.get("risk") == "safe":
                cat = row.get("category", "기타")
                self.safe_copies_by_category[cat].append(row)

    def _load_yoonji_styles_order(self):
        """
        styles_order.jsonl 큐레이션 로드 (style_name → dict 매핑).
        avoid 필드와 여러 examples를 가진 고품질 큐레이션.
        """
        self.yoonji_styles_by_name = {}
        if not STYLES_ORDER_PATH.exists():
            return
        with STYLES_ORDER_PATH.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                row = json.loads(line)
                name = row.get("style_name")
                if name:
                    self.yoonji_styles_by_name[name] = row

    def _load_yoonji_copies_selection(self):
        """
        copies_selection.jsonl 큐레이션 로드 (category → 대표 카피).
        카테고리 앵커로 사용 — 프롬프트에 항상 우선 주입.
        """
        self.yoonji_copies_by_category = {}
        if not COPIES_SELECTION_PATH.exists():
            return
        with COPIES_SELECTION_PATH.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                row = json.loads(line)
                cat = row.get("category")
                if cat:
                    self.yoonji_copies_by_category[cat] = row

    def _embed_cases(self):
        """violation 케이스의 original_copy를 미리 임베딩 (캐시 사용)."""
        cache_key = _file_hash(CASES_PATH)
        cache_path = CACHE_DIR / f"case_embeddings_{cache_key}.pkl"

        cached = _load_cache(cache_path)
        if cached is not None:
            self.case_embeddings = cached
            return

        self.case_embeddings = []
        for case in self.violation_cases:
            original = case["original_copy"][0] if case.get("original_copy") else ""
            if not original:
                self.case_embeddings.append(None)
                continue
            emb = self.retriever._embed(original)
            self.case_embeddings.append(emb)

        _save_cache(cache_path, self.case_embeddings)

    def _embed_category_centroids(self):
        """
        카테고리별 centroid 임베딩 미리 계산 (캐시 사용).

        각 카테고리에 대해:
          - 카테고리 이름 + 대표 카피(copies_selection) + 관련 styles 설명을 합쳐 임베딩
          - 이걸 centroid로 사용

        입력 카피가 들어오면 각 centroid와 코사인 유사도 → 가장 가까운 카테고리.

        장점: 9개 키워드 규칙의 한계 극복, 새 카피에도 유연 대응, GPT 호출 없음.
        """
        cache_key = _file_hash(COPIES_PATH, COPIES_SELECTION_PATH, STYLES_PATH)
        cache_path = CACHE_DIR / f"category_centroids_{cache_key}.pkl"

        cached = _load_cache(cache_path)
        if cached is not None:
            self.category_centroids = cached
            return

        self.category_centroids = {}

        # 모든 카테고리 수집 (copies.jsonl + selection 합집합)
        all_categories = set()
        all_categories.update(self.safe_copies_by_category.keys())
        all_categories.update(self.yoonji_copies_by_category.keys())

        for cat in all_categories:
            if not cat or cat == "?" or cat == "기타":
                continue

            # centroid 문장 조립 — 카테고리 + 대표 카피들
            parts = [f"화장품 광고 카테고리: {cat}"]

            # 카테고리 앵커 카피 (고품질)
            if cat in self.yoonji_copies_by_category:
                anchor = self.yoonji_copies_by_category[cat]
                parts.append(f"대표 카피: {anchor.get('copy', '')}")

            # copies.jsonl에서 상위 3개 보충
            for row in self.safe_copies_by_category.get(cat, [])[:3]:
                parts.append(row.get("copy", ""))

            # styles.jsonl의 best_for_category 매칭 스타일 설명
            for s in self.styles:
                if s.get("best_for_category") == cat:
                    parts.append(s.get("core_pattern", "")[:100])

            centroid_text = " ".join(p for p in parts if p)
            try:
                self.category_centroids[cat] = self.retriever._embed(centroid_text)
            except Exception as e:
                print(f"[FewshotSelector] '{cat}' centroid 임베딩 실패: {e}")

        _save_cache(cache_path, self.category_centroids)

    # ---------- 카테고리 추정 ----------

    _KEYWORD_RULES = [
        ("자외선차단", ["자외선", "선크림", "선블록", "spf", "uv"]),
        ("탈모샴푸", ["탈모", "두피", "샴푸", "모발", "헤어"]),
        ("색조메이크업", ["립", "쿠션", "파우더", "섀도우", "아이라이너", "블러셔", "틴트", "마스카라"]),
        ("진정트러블", ["진정", "트러블", "여드름", "민감", "붉은"]),
        ("클렌징", ["클렌징", "세안", "워시", "폼", "클렌저"]),
        ("향수프래그런스", ["향수", "향기", "퍼퓸", "프래그런스"]),
        ("탄력탱탱", ["탄력", "볼륨", "탱탱", "리프팅"]),
        ("미백주름", ["미백", "주름", "안티에이징", "밝히는", "빛내", "브라이트"]),
        ("수분보습", ["수분", "보습", "촉촉", "모이스처", "히알루론"]),
    ]

    def _infer_category(self, copy: str) -> str:
        """
        하이브리드 카테고리 추정:
        1. 키워드 규칙으로 명확한 경우 즉시 반환 (빠르고 정확)
        2. 매칭 없으면 임베딩 centroid 유사도 (유연성)
        3. 그래도 매칭 약하면 '브랜드철학' 폴백

        이유:
        - 선크림·샴푸·클렌징은 키워드가 명확 → 키워드 규칙이 빠르고 확실
        - 신상품·특수 표현(엑소좀 등)은 임베딩이 필요
        - 완전 애매한 건 브랜드철학 (safe 카피 풀이 가장 큼)
        """
        # 1단계: 키워드 규칙 (빠른 경로)
        c = copy.lower()
        for cat, keywords in self._KEYWORD_RULES:
            if any(kw in c for kw in keywords):
                return cat

        # 2단계: 임베딩 기반 (유연 경로) — 강한 매칭만 채택
        if self.use_embedding_category and self.category_centroids:
            try:
                query_emb = self.retriever._embed(copy)
                # 모든 카테고리 유사도 계산
                sims = {
                    cat: _cosine_sim(query_emb, c)
                    for cat, c in self.category_centroids.items()
                }
                top_cat, top_sim = max(sims.items(), key=lambda x: x[1])

                # 임계값 0.5 이상일 때만 채택 (확실한 경우)
                # 그리고 2위와 5%p 이상 차이 있어야 함 (애매한 경우 거부)
                sorted_sims = sorted(sims.values(), reverse=True)
                margin = sorted_sims[0] - sorted_sims[1] if len(sorted_sims) > 1 else 0

                if top_sim >= 0.5 and margin >= 0.03:
                    return top_cat
            except Exception as e:
                print(f"[FewshotSelector] 카테고리 임베딩 실패: {e}")

        # 3단계: 폴백 — 브랜드철학 (188개 중 가장 많은 카테고리, 가장 안전)
        return "브랜드철학"

    # ---------- 스타일 선별 ----------

    def _enrich_style(self, style: dict) -> dict:
        """
        styles.jsonl 스타일에 styles_order의 avoid·추가 examples 병합.
        """
        name = style.get("style_name")
        enriched = dict(style)
        if name and name in self.yoonji_styles_by_name:
            yoonji = self.yoonji_styles_by_name[name]
            # avoid 필드 추가
            if yoonji.get("avoid"):
                enriched["avoid"] = yoonji["avoid"]
            # examples를 큐레이션으로 교체 (더 풍부함)
            if yoonji.get("examples"):
                enriched["example_copies"] = yoonji["examples"]
            # risk는 큐레이션 값 우선
            if yoonji.get("risk"):
                enriched["yoonji_risk"] = yoonji["risk"]
        return enriched

    def _select_styles(self, category: str, top_k: int = 3) -> list[dict]:
        """
        카테고리에 맞는 스타일 공식 선별 + 큐레이션 병합.
        1. best_for 필드로 매칭 → 없으면 safe 순서대로 보충
        2. 각 스타일에 avoid·추가 examples 병합
        """
        matched = [s for s in self.styles if s.get("best_for_category") == category]

        if len(matched) < top_k:
            # 부족하면 safe-first 순서(safe 8 → caution 2)대로 보충
            yoonji_order = [
                self._get_style_by_name(name)
                for name in self.yoonji_styles_by_name.keys()
            ]
            yoonji_order = [s for s in yoonji_order if s is not None]
            # 이미 matched에 있는 것 제외
            matched_names = {s.get("style_name") for s in matched}
            for s in yoonji_order:
                if len(matched) >= top_k:
                    break
                if s.get("style_name") not in matched_names:
                    matched.append(s)

        # 큐레이션 병합 (avoid·examples)
        return [self._enrich_style(s) for s in matched[:top_k]]

    def _get_style_by_name(self, name: str) -> dict | None:
        """styles.jsonl에서 style_name으로 조회."""
        for s in self.styles:
            if s.get("style_name") == name:
                return s
        return None

    # ---------- copies 선별 ----------

    def _select_safe_copies(self, category: str, top_k: int = 5) -> list[dict]:
        """
        safe 카피 top-K 선별.

        copies_selection.jsonl 큐레이션 우선:
          1. 해당 카테고리의 대표 카피 (앵커, 1개)
          2. 같은 카테고리의 copies.jsonl 추가 샘플 (부족분 채움)
          3. 그래도 부족하면 다른 카테고리의 대표 카피 보충
        """
        result = []
        used_copies = set()

        # [1] 대표 카피 — 해당 카테고리
        if category in self.yoonji_copies_by_category:
            anchor = self.yoonji_copies_by_category[category]
            result.append({
                "brand": anchor.get("brand", ""),
                "copy": anchor.get("copy", ""),
                "category": anchor.get("category", ""),
                "source": "yoonji_anchor",  # 디버그용
            })
            used_copies.add(anchor.get("copy"))

        # [2] copies.jsonl 동적 보충 (같은 카테고리)
        pool = self.safe_copies_by_category.get(category, [])
        for row in pool:
            if len(result) >= top_k:
                break
            if row.get("copy") in used_copies:
                continue
            result.append({
                "brand": row.get("brand", ""),
                "copy": row.get("copy", ""),
                "category": row.get("category", ""),
                "source": "copies_dynamic",
            })
            used_copies.add(row.get("copy"))

        # [3] 다른 카테고리 앵커로 보충 (다양성)
        if len(result) < top_k:
            for cat, anchor in self.yoonji_copies_by_category.items():
                if len(result) >= top_k:
                    break
                if cat == category:
                    continue
                if anchor.get("copy") in used_copies:
                    continue
                result.append({
                    "brand": anchor.get("brand", ""),
                    "copy": anchor.get("copy", ""),
                    "category": anchor.get("category", ""),
                    "source": "yoonji_other",
                })
                used_copies.add(anchor.get("copy"))

        return result[:top_k]

    def select(
        self,
        copy: str,
        top_k_cases: int = 3,
        top_k_precedents: int = 0,  # 기본 0 — Rewriter에서 precedent는 효용 낮음
        top_k_styles: int = 3,
        top_k_safe_copies: int = 5,
    ) -> dict:
        """
        입력 카피에 대해 4개 소스에서 Few-shot 후보 선별.

        Args:
            copy: 원본 광고 카피
            top_k_cases: cases.jsonl 변환 쌍 개수 (임베딩 유사도)
            top_k_precedents: RAG 공정위 의결서 개수 (임베딩 유사도)
            top_k_styles: styles.jsonl 스타일 공식 개수 (카테고리 매칭)
            top_k_safe_copies: copies.jsonl safe 카피 개수 (카테고리 필터)

        Returns:
            {
              "cases": [...],           # 변환 쌍 (cases.jsonl)
              "precedents": [...],      # 공정위 의결서 (RAG)
              "styles": [...],          # 스타일 공식 (styles.jsonl)
              "safe_copies": [...],     # 정상 카피 예시 (copies.jsonl)
              "inferred_category": "...",
              "latency_ms": 123
            }
        """
        start = time.perf_counter()

        # 0. 카테고리 추정
        inferred_category = self._infer_category(copy)

        # 1. cases.jsonl 유사도 선별
        query_emb = self.retriever._embed(copy)
        scored = []
        for case, emb in zip(self.violation_cases, self.case_embeddings):
            if emb is None:
                continue
            sim = _cosine_sim(query_emb, emb)
            scored.append((sim, case))
        scored.sort(key=lambda x: -x[0])
        top_cases = scored[:top_k_cases]

        cases_result = []
        for sim, case in top_cases:
            cases_result.append({
                "id": case.get("id"),
                "original": case["original_copy"][0] if case.get("original_copy") else "",
                "safe": case.get("safe_rewrite", ""),
                "marketing": case.get("marketing_rewrite", ""),
                "functional": case.get("functional_rewrite") or "",
                "violation_types": case.get("violation_types", []),
                "law_basis": case.get("law_basis", ""),
                "rationale": case.get("rationale", ""),
                "similarity": round(sim, 3),
            })

        # 2. RAG precedent 검색 (공정위 의결서) — top_k_precedents > 0일 때만
        precedents_result = []
        if top_k_precedents > 0:
            try:
                rag = self.retriever.retrieve(
                    copy,
                    top_k=top_k_precedents,
                    filter_expr="type eq 'precedent'",
                )
                for ch in rag["chunks"]:
                    precedents_result.append({
                        "source_id": ch.get("source_id", ""),
                        "decision_no": ch.get("decision_no", ""),
                        "case_title": ch.get("case_title", "") or "",
                        "content": (ch.get("content", "") or "")[:600],
                        "rerank_score": round(ch.get("rerank_score", 0), 2),
                    })
            except Exception as e:
                print(f"[FewshotSelector] precedent 검색 실패: {e}")

        # 3. styles.jsonl 스타일 공식 (카테고리 매칭 + avoid 필드 병합)
        styles_result = []
        for s in self._select_styles(inferred_category, top_k=top_k_styles):
            # example_copies는 리스트 유지 (큐레이션은 2~4개)
            examples = s.get("example_copies") or []
            if not isinstance(examples, list):
                examples = [examples]
            styles_result.append({
                "id": s.get("id"),
                "style_name": s.get("style_name"),
                "source_brand": s.get("source_brand"),
                "core_pattern": s.get("core_pattern", "")[:200],
                "example_copies": examples[:3],  # 최대 3개
                "best_for_category": s.get("best_for_category"),
                "avoid": s.get("avoid", ""),  # ⭐ 금지 필드 avoid
                "yoonji_risk": s.get("yoonji_risk", ""),  # ⭐ 큐레이션 리스크
            })

        # 4. copies.jsonl safe 카피 (카테고리 필터)
        safe_copies_result = []
        for r in self._select_safe_copies(inferred_category, top_k=top_k_safe_copies):
            safe_copies_result.append({
                "brand": r.get("brand", ""),
                "copy": r.get("copy", ""),
                "category": r.get("category", ""),
            })

        elapsed = (time.perf_counter() - start) * 1000
        return {
            "cases": cases_result,
            "precedents": precedents_result,
            "styles": styles_result,
            "safe_copies": safe_copies_result,
            "inferred_category": inferred_category,
            "latency_ms": round(elapsed, 1),
        }

    def format_for_prompt(self, fewshot: dict) -> str:
        """선별된 Few-shot 4개 소스를 프롬프트용 텍스트로 포맷."""
        lines = []

        # 추정 카테고리 (디버깅용)
        lines.append(f"## 🏷️ 추정 카테고리: `{fewshot.get('inferred_category', '?')}`")
        lines.append("")

        # [1] 변환 쌍 예시 (cases.jsonl)
        if fewshot.get("cases"):
            lines.append("## 📝 [1] 유사 변환 사례 (cases.jsonl)")
            lines.append("")
            lines.append("**원본 → 수정안 변환 패턴 참고용**")
            lines.append("")
            for i, c in enumerate(fewshot["cases"], 1):
                lines.append(f"### 사례 {i} — 유사도 {c['similarity']:.2f}")
                lines.append(f"**원본**: \"{c['original']}\"")
                lines.append(f"**위반 유형**: {', '.join(c['violation_types'])}")
                lines.append(f"**법적 근거**: {c['law_basis']}")
                lines.append("**수정안**:")
                lines.append(f"- safe: \"{c['safe']}\"")
                lines.append(f"- marketing: \"{c['marketing']}\"")
                if c['functional']:
                    lines.append(f"- functional: \"{c['functional']}\"")
                lines.append("")

        # [2] 스타일 공식 (styles.jsonl + avoid 필드 병합)
        if fewshot.get("styles"):
            lines.append("## 🎨 [2] 카피 작법 스타일 공식 (전문가 큐레이션)")
            lines.append("")
            lines.append("**이 카테고리에 어울리는 검증된 카피 작법**")
            lines.append("")
            for i, s in enumerate(fewshot["styles"], 1):
                lines.append(f"### 스타일 {i} — {s['style_name']} ({s.get('source_brand','?')})")
                if s.get("core_pattern"):
                    lines.append(f"**공식**: {s['core_pattern']}")
                # examples (여러 개 가능 — 큐레이션은 2~4개)
                examples = s.get("example_copies") or []
                if isinstance(examples, list):
                    for ex in examples:
                        lines.append(f'**예시**: "{ex}"')
                else:
                    lines.append(f'**예시**: "{s.get("example","")}"')
                # avoid 필드 필드
                if s.get("avoid"):
                    lines.append(f"**⚠ 금지**: {s['avoid']}")
                if s.get("best_for_category"):
                    lines.append(f"**적합 카테고리**: {s['best_for_category']}")
                lines.append("")

        # [3] 안전한 정상 카피 예시 (copies.jsonl)
        if fewshot.get("safe_copies"):
            lines.append("## 🟢 [3] 같은 카테고리의 정상 광고 카피 (copies.jsonl)")
            lines.append("")
            lines.append("**법적으로 문제없는 실제 카피 예시**")
            lines.append("")
            for sc in fewshot["safe_copies"]:
                brand = sc.get("brand", "?")
                copy = sc.get("copy", "")
                cat = sc.get("category", "")
                lines.append(f"- [{brand}] \"{copy}\" _{cat}_")
            lines.append("")

        # [4] 공정위 의결서 원문 (RAG 검색)
        if fewshot.get("precedents"):
            lines.append("## ⚖️ [4] 관련 공정위 의결서 (RAG 검색)")
            lines.append("")
            lines.append("**실제 처분 사례 - 법적 근거 학습용**")
            lines.append("")
            for i, p in enumerate(fewshot["precedents"], 1):
                lines.append(f"### 의결서 {i} — {p['decision_no']}")
                if p['case_title']:
                    lines.append(f"**사건**: {p['case_title'][:80]}")
                lines.append("**본문 발췌**:")
                lines.append("```")
                lines.append(p['content'][:500])
                lines.append("```")
                lines.append("")

        return "\n".join(lines)


# ============== 데모 ==============
if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from retriever import Retriever

    retriever = Retriever()
    selector = FewshotSelector(retriever)

    print(f"[init] violation cases: {len(selector.violation_cases)}")
    print(f"[init] violation cases: {len(selector.violation_cases)}")
    print()

    test_queries = [
        "원데이 엑소좀 샷 앰플로 세포 재생",
        "바르는 보톡스 AHP-8 피부 탄력",
        "속눈썹 마이크로니들 세럼 — 눈썹이 자라나는",
        "주름 개선 기능성 심사 통과 — 안티링클 크림",
    ]

    for q in test_queries:
        print("=" * 70)
        print(f"QUERY: {q}")
        print("=" * 70)
        result = selector.select(q, top_k_cases=3, top_k_precedents=2)
        print(f"latency: {result['latency_ms']}ms")
        print()
        print(selector.format_for_prompt(result))
        print()
