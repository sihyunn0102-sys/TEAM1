# data/fewshot — L4 Rewriter Few-shot 데이터

L4 Rewriter가 동적으로 선별하는 Few-shot 소스 파일들입니다.
`pipeline/fewshot_selector.py`가 이 파일들을 로드해 카피와 유사한 사례를 선별합니다.

## 파일 목록

| 파일 | 건수 | 설명 |
|------|------|------|
| `cases.jsonl` | 8개 | 실제 위반→수정 변환 쌍 (input/output 예시) |
| `styles.jsonl` | 10개 | 스타일 공식 (safe/marketing/functional 패턴) |
| `copies.jsonl` | 236개 | 안전한 카피 예시 모음 |
| `styles_order.jsonl` | - | 스타일 큐레이션 순서 (avoid 패턴 포함) |
| `copies_selection.jsonl` | 10개 | 카테고리 앵커 (대표 안전 카피) |

## 데이터 구조 (cases.jsonl)

```json
{
  "id": "case_001",
  "original": "바르는 보톡스로 주름을 제거하세요",
  "violation_type": "시술용어",
  "rewrites": {
    "safe": "매일 바르는 깊은 보습 크림",
    "marketing": "피부가 탐하는 보습의 순간",
    "functional": "히알루론산 함유 집중 보습 크림"
  }
}
```

## 업데이트 방법

새 사례 추가 시 cases.jsonl에 JSONL 형식으로 한 줄씩 추가합니다.
`pipeline/fewshot_selector.py`의 `FewshotSelector`가 자동으로 로드합니다.
