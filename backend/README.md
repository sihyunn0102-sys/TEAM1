# AdGuard — 화장품 광고 컴플라이언스 검수 서비스

화장품법·식약처 지침·공정위 처분 사례 RAG 기반 **5단계 판정 파이프라인**으로
광고 카피의 법 위반을 찾아 법적 근거와 안전한 수정안 3가지(보수형·감성형·기능성형)를
실시간 생성하는 서비스.

---

## 빠른 시작

### 1. 환경 변수
```bash
cp .env.example .env
# .env 파일을 열어 Azure 키 입력
```

### 2. 의존성 설치
```bash
pip install -r requirements.txt
```

### 3. CLI 테스트
```bash
python pipeline/cascade.py "바르는 보톡스 크림"
```

### 4. FastAPI 서버 실행
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Swagger UI: http://localhost:8000/docs
- 헬스 체크: http://localhost:8000/health

---

## 폴더 구조

```
adguard/
├── app/                         FastAPI 서비스
│   ├── main.py                  엔드포인트 9개
│   ├── clients/
│   │   ├── docintel_client.py   OCR
│   │   └── storage_client.py   Storage
│   └── schemas/
│       ├── request.py           Pydantic 요청
│       └── response.py          Pydantic 응답
│
├── pipeline/                    AI 엔진 (L1~L5)
│   ├── cascade.py               메인 오케스트레이터
│   ├── product_context.py       제품 유형 컨텍스트
│   ├── rule_engine.py           L1 Rule Engine
│   ├── retriever.py             L2 RAG Retriever
│   ├── judge.py                 L3 GPT-4o Judge
│   ├── l4_rewriter.py           L4 Rewriter
│   ├── l5_rejudge.py            L5 Re-Judge
│   └── fewshot_selector.py      L4 few-shot 선별기
│
├── prompts/
│   ├── judge/
│   │   ├── grounded.txt         ⭐ L3 현재 사용
│   │   └── v0_base.txt          baseline
│   └── rewriter/
│       ├── v3_dynamic.txt       ⭐ L4 현재 사용
│       └── v4_yoonji.txt        감성 강화 버전
│
├── configs/
│   ├── blocklist.yaml           L1 룰 데이터
│   └── search_index_schema.py   인덱스 스키마
│
├── data/fewshot/                L4 few-shot 소스
│   ├── cases.jsonl              변환 쌍 8개
│   ├── styles.jsonl             스타일 공식 10개
│   ├── copies.jsonl             안전 카피 236개
│   ├── styles_order.jsonl       큐레이션 순서
│   └── copies_selection.jsonl   카테고리 앵커
│
├── docs/
│   ├── ARCHITECTURE.md          시스템 아키텍처
│   └── HANDOFF_BACKEND.md       ⭐ 백엔드 팀 필독
│
├── scripts/
│   ├── dashboard.py             판정 모니터링 CLI
│   └── build_yoonji_prompt.py   v4 프롬프트 빌더
│
├── report_generator.py          PDF 리포트 생성
├── requirements.txt
├── .env / .env.example
└── WORK_LOG.md
```

---

## 파이프라인

```
사용자 입력 (카피 + product_type)
         ↓
L0 · Product Router       (의약품 차단 / 일반·기능성 분기)
         ↓
L1 · Rule Engine          (키워드·regex 필터, blocklist.yaml)
         ↓
L2 · Retriever            (Azure AI Search 하이브리드)
         ↓
L3 · Judge                (GPT-4.1, RAG 법 조항 직접 인용)
         ↓
L4 · Rewriter             (3스타일 수정안, 동적 few-shot)
         ↓
L5 · Re-Judge             (수정안 병렬 재검증, 최대 2회 재시도)
         ↓
최종 응답
```

---

## API 요청 예시

```bash
# 텍스트 검수
curl -X POST http://localhost:8000/analyze/text \
  -H "Content-Type: application/json" \
  -d '{
    "text": "주름 개선 안티에이징 크림",
    "product_type": "functional_cosmetic",
    "certification_no": "제2024-01234호",
    "certified_claims": ["주름 개선"]
  }'
```

### product_type
| 값 | 설명 |
|----|------|
| `general_cosmetic` | 일반 화장품 (기본, 엄격 기준) |
| `functional_cosmetic` | 기능성 화장품 (심사 통과 효능 완화) |
| `pharmaceutical` | 의약품 (범위 밖, out_of_scope 즉시 반환) |

---

## 백엔드 팀 문서

`docs/HANDOFF_BACKEND.md` 참고 — Azure 리소스 현황, TODO, 알려진 이슈 포함.
