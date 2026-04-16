"""
app/clients/docintel_client.py
──────────────────────────────
Azure Document Intelligence 클라이언트 팩토리.

POST /analyze/image 엔드포인트에서 호출해
이미지·PDF 파일에서 텍스트를 추출(OCR)합니다.
사용 모델: prebuilt-layout (레이아웃 인식 + 텍스트 추출)

환경변수 (둘 중 하나):
  DOCINTEL_ENDPOINT / DOCINTEL_KEY           (기존 백엔드 네이밍)
  AZURE_DOCINTEL_ENDPOINT / AZURE_DOCINTEL_KEY  (프로토타입 네이밍)
"""
from __future__ import annotations
import os
from pathlib import Path

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential
from dotenv import load_dotenv


def get_document_client() -> DocumentIntelligenceClient:
    """Azure Document Intelligence 클라이언트를 반환합니다."""
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

    # 두 가지 환경변수 네이밍 모두 지원
    endpoint = os.getenv("DOCINTEL_ENDPOINT") or os.getenv("AZURE_DOCINTEL_ENDPOINT")
    key = os.getenv("DOCINTEL_KEY") or os.getenv("AZURE_DOCINTEL_KEY")

    if not endpoint or not key:
        raise RuntimeError(
            "DOCINTEL_ENDPOINT / DOCINTEL_KEY 환경변수가 설정되지 않았습니다. "
            ".env에 추가해주세요."
        )

    return DocumentIntelligenceClient(
        endpoint=endpoint,
        credential=AzureKeyCredential(key),
    )
