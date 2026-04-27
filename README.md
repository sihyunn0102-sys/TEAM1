AdGuard - 광고청정기
Azure AI 기반 화장품 광고 카피 검수 및 합법 대체 문구 제안 서비스

프로젝트 소개
AdGuard는 화장품 광고 카피가 실제 배포되기 전에 법적 리스크가 있는 표현을 탐지하고, 관련 법령 근거와 함께 실무에서 사용할 수 있는 대체 카피를 제안하는 Azure AI 기반 광고 검수 서비스입니다.

사용자는 광고 텍스트를 직접 입력하거나 이미지, PDF, URL을 업로드할 수 있습니다. 이미지와 PDF는 Azure Document Intelligence로 광고 문구를 추출하고, 추출된 텍스트는 text-embedding-3-large와 Azure AI Search 기반 RAG 검색을 통해 관련 법령, 의결서, 가이드라인 근거와 매칭됩니다.

이후 GPT-4.1이 광고 문구의 위반 가능성을 판정하고, 위험 문구가 발견되면 안전형, 마케팅형, 기능성형 대체 카피 3종을 생성합니다. 생성된 수정안은 다시 검수 단계를 거쳐 재위반 가능성을 줄이며, 최종 결과는 위반 문구 하이라이트, 법적 근거, 수정안, PDF 리포트, 히스토리 형태로 제공됩니다.

문제 정의
화장품 광고에서는 바르는 보톡스, 피부 재생, 염증 완화, 단 1회만에 개선처럼 소비자가 제품을 의약품이나 시술로 오인할 수 있는 표현이 자주 등장합니다.

이러한 표현은 화장품법 및 표시광고법 위반으로 이어질 수 있으며, 실제 광고 중단, 행정처분, 브랜드 신뢰도 하락 같은 리스크를 만듭니다. 그러나 마케터나 소규모 브랜드가 매번 법령과 심의 기준을 직접 확인하며 광고 문구를 검수하기는 어렵습니다.

AdGuard는 이 문제를 광고 작성 단계에서 해결하기 위해, 위험 문구 탐지와 법적 근거 제시, 그리고 실무에서 바로 사용할 수 있는 대체 카피 생성을 하나의 흐름으로 제공합니다.

주요 기능
광고 텍스트 직접 입력 분석
이미지/PDF 업로드 후 OCR 기반 광고 문구 추출
URL 기반 광고 카피 분석
금지어 및 패턴 기반 L1 Rule Engine 판정
Azure AI Search 기반 법령·의결서·가이드라인 RAG 검색
text-embedding-3-large 기반 문서 임베딩 및 벡터 검색
GPT-4.1 기반 위반 여부 판정 및 법적 근거 인용
안전형, 마케팅형, 기능성형 대체 카피 3종 생성
생성된 수정안을 다시 검수하는 Re-Judge 구조
위반 문구 하이라이트와 Before/After 비교 UI
PDF 리포트 및 검수 히스토리 제공
관리자 대시보드를 통한 운영 비용 및 응답 시간 모니터링
시스템 아키텍처
AdGuard는 단일 GPT 호출이 아니라 5-Layer Cascade 구조로 설계되었습니다.

사용자 입력
→ Next.js Frontend
→ FastAPI Backend
→ L1 Rule Engine
→ L2 Azure AI Search RAG Retriever
→ L3 GPT-4.1 Judge
→ L4 GPT-4.1 Rewriter
→ L5 Re-Judge
→ 결과 화면 / PDF 리포트 / 히스토리 저장
L1에서는 명확한 금지어와 위험 패턴을 빠르게 탐지하고, L2에서는 관련 법령과 의결서 근거를 검색합니다. L3에서는 GPT-4.1이 검색된 근거를 바탕으로 최종 판정을 수행하며, 위반으로 판단된 경우 L4에서 대체 카피를 생성합니다. 마지막으로 L5에서 생성된 수정안을 다시 검수해 재위반 가능성을 줄였습니다.

기술 스택
AI / Data
Azure OpenAI GPT-4.1
Azure OpenAI text-embedding-3-large
Azure AI Search
Azure Document Intelligence
Azure AI Foundry
Python Custom Chunker
RAG Pipeline
Backend / Infra
FastAPI
Azure App Service
Azure Blob Storage
Azure SQL Database / Azure Table Storage
Azure Functions
Azure Key Vault
Azure Application Insights
Frontend
Next.js 14
Azure Static Web Apps
shadcn/ui
SSE 기반 분석 단계 시각화
데이터 및 성과
원본 데이터: 42 PDF + 60 MD + 32 TXT
RAG 청크: 1,069개
Azure AI Search 인덱스: adguard-main
임베딩 모델: text-embedding-3-large
벡터 차원: 3,072차원
Few-shot 데이터: 254행
L1 Rule Engine 테스트: 24/25 통과
Cascade 테스트: 10건 중 9건 정확
내부 평가 67건 기준: 위반 탐지, 안전 통과, 법적 근거 인용 핵심 지표 100% 달성
수동 검수 대비 체감 작업 시간 약 90% 단축
팀원 및 역할
이름	역할	주요 담당
오준상	팀장 / AI·시스템 총괄	L1~L5 Cascade 파이프라인 설계, Azure AI Search RAG 구조 설계, 법령·의결서 데이터 청킹/임베딩/인덱싱 전략, 모델 구조 최적화, 아키텍처 및 성능 검증
황유경	프론트엔드	Result / History 페이지 구현, 수정안 3종 카드 UI, 신호등 위험도 Badge, Before/After Diff UI, 위반 문구 하이라이트 및 책임있는 AI UI 개선
오효석	백엔드	FastAPI 서버 구축, L1~L3 분석 파이프라인 구현, Azure 리소스 생성, API 연결 및 최적화, 병렬 처리와 배포 안정화
조윤지	데이터 / AI 보조	화장품 광고 위반/정상 사례 수집, Few-shot 데이터셋 구축, L4 Rewriter 스타일 기준 정리, 광고 카피 카테고리 분류와 발표 흐름 보강
김시현	프론트엔드	Upload 페이지 구현, Azure Document Intelligence OCR 연동, 이미지/PDF 업로드 UX, L1~L5 분석 단계 로딩 시각화, Azure Static Web Apps 배포
백혁빈	백엔드 / 데이터	L1~L5 파이프라인 구현 지원, Rewriter / Re-Judge 로직 개발, PDF 리포트 생성, DB 저장 구조, 히스토리 기능, 보안·모니터링 구조 정리

---

팀원별 기여 내용
오준상
팀장으로서 AdGuard의 AI 파이프라인과 전체 시스템 아키텍처를 총괄했습니다. 단순히 GPT-4.1에 광고 문구를 한 번 입력해 판단하는 구조가 아니라, 빠른 규칙 기반 탐지, 법령 근거 검색, LLM 판정, 대체 카피 생성, 재검증을 분리한 5-Layer Cascade 구조를 설계했습니다.

또한 법령, 의결서, 가이드라인, 광고 사례 데이터를 RAG 검색에 적합하도록 청킹하고, text-embedding-3-large와 Azure AI Search를 활용해 검색 가능한 형태로 구성하는 전략을 정리했습니다. 발표와 구현 과정에서는 아키텍처 흐름, 모델 판단 구조, 성능 검증 기준, 팀원별 역할 분배를 조율했습니다.

황유경
(여기에 내용 넣기)

오효석
(여기에 내용 넣기)

백혁빈
(여기에 내용 넣기)

김시현
(여기에 내용 넣기)

조윤지
(여기에 내용 넣기)


---

기여 내용
L1~L5 Cascade 파이프라인 구조 설계
Azure AI Search 기반 RAG 검색 흐름 설계
법령·의결서·광고 사례 데이터 청킹 전략 수립
GPT-4.1 Judge / Rewriter / Re-Judge 흐름 설계
모델 구조 최적화 및 latency 개선 방향 정리
발표용 시스템 아키텍처 및 서비스 흐름 정리
팀 일정, 역할 분배, 발표 구조 조율
Responsible AI
AdGuard는 Microsoft Responsible AI 원칙을 서비스 기능에 반영했습니다.

투명성: L1~L5 분석 단계를 사용자에게 실시간으로 표시
설명 가능성: 위반 문구와 법적 근거를 함께 제공
책임성: 최종 판단 책임이 사용자에게 있음을 명시
공정성: 일반 화장품과 기능성 화장품을 구분해 판정 기준 적용
안정성: 생성된 수정안을 다시 검수하는 Re-Judge 구조 적용
개인정보 보호: 광고 카피와 제품 정보 외 불필요한 개인정보 수집 최소화
포용성: 색상뿐 아니라 아이콘과 텍스트를 함께 사용해 위험도를 표시
회고
이번 프로젝트에서는 팀장으로서 AI 파이프라인과 시스템 아키텍처를 총괄했습니다.

특히 단일 GPT 호출에 의존하지 않고 Rule Engine, RAG Retriever, Judge, Rewriter, Re-Judge로 책임을 분리한 Cascade 구조를 설계하면서, AI 서비스에서 정확도뿐 아니라 비용, 응답 시간, 설명 가능성, 재검증 구조가 함께 중요하다는 점을 배웠습니다.

포트폴리오 카드용 짧은 문구
AdGuard는 Azure AI 기반 화장품 광고 검수 서비스입니다. 광고 카피, 이미지, PDF, URL을 입력하면 text-embedding-3-large와 Azure AI Search 기반 법령·의결서·가이드라인 RAG 검색으로 위반 가능성을 판정하고, GPT-4.1을 활용해 안전한 대체 카피 3종과 PDF 리포트를 제공합니다.

기간: 2026.04.14 ~ 2026.04.27
역할: 팀장 / AI·시스템 총괄
담당: 5-Layer Cascade 설계, Azure AI Search RAG 구조 설계, 데이터 청킹·인덱싱 전략, GPT-4.1 Judge/Rewriter/Re-Judge 흐름 설계
기술: Azure OpenAI GPT-4.1, Azure OpenAI text-embedding-3-large, Azure AI Search, Azure Document Intelligence, FastAPI, Next.js, Azure App Service, Azure Static Web Apps
