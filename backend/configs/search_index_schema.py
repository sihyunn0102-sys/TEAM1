"""
configs/search_index_schema.py
──────────────────────────────
Azure AI Search 인덱스 스키마 정의 (adguard-main).

1팀이 구축한 인덱스 필드 목록. L2 Retriever(retriever.py)에서 select 필드로 사용합니다.
인덱스 재구축 시 이 파일을 참고하세요.
"""

# L2 Retriever가 select하는 기본 필드
DEFAULT_SELECT_FIELDS = [
    "source_id",        # 청크 고유 ID
    "content",          # 법령·지침 텍스트 내용
    "type",             # 문서 유형 (법령 / 지침 / 의결서 / 자문)
    "source",           # 출처 문서명 (예: 화장품법_제13조)
    "topic",            # 주제 태그 리스트
    "source_file",      # 원본 파일명
    "law_name",         # 법령명 (예: 화장품법)
    "article_no",       # 조항 번호 (예: 제13조)
    "article_title",    # 조항 제목
    "chapter",          # 장(章) 정보
    "decision_no",      # 공정위 의결서 번호
    "case_title",       # 사건명
    "respondent",       # 피심인
    "decision_date",    # 의결 날짜
    "section_name",     # 섹션명
]

# 벡터 필드명 (임베딩 컬럼)
VECTOR_FIELD = "content_vector"

# 시맨틱 구성 이름
SEMANTIC_CONFIG = "default-semantic"

# 인덱스명
INDEX_NAME = "adguard-main"
