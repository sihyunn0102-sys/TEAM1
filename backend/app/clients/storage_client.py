"""
app/clients/storage_client.py
──────────────────────────────
Azure Blob Storage · Table Storage 클라이언트 팩토리.

[Blob Storage 용도]
- user-uploads/   : 사용자가 업로드한 이미지·PDF (24h 자동 삭제 정책)
- reports/        : 생성된 PDF 리포트 저장

[Table Storage 용도]
- history  : 판정 요청 이력 (task_id, verdict, summary, timestamp 등)
- feedback : 사용자가 선택한 수정안 (데이터 플라이휠 → 추후 few-shot 개선)

환경변수 (둘 중 하나):
  BLOB_CONN_STR                       (기존 백엔드 네이밍)
  AZURE_STORAGE_CONNECTION_STRING     (프로토타입 네이밍)

get_table_client()는 테이블이 없으면 자동 생성합니다.
get_blob_client()는 컨테이너가 없으면 자동 생성합니다.
"""
from __future__ import annotations
import os
import logging
from pathlib import Path

from azure.storage.blob import BlobServiceClient
from azure.data.tables import TableServiceClient
from azure.core.exceptions import ResourceExistsError
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
logger = logging.getLogger(__name__)


def _get_conn_str() -> str:
    """두 가지 환경변수 네이밍을 모두 지원합니다."""
    conn = os.getenv("BLOB_CONN_STR") or os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not conn:
        raise RuntimeError(
            "BLOB_CONN_STR 또는 AZURE_STORAGE_CONNECTION_STRING 환경변수가 없습니다. "
            ".env에 추가해주세요."
        )
    return conn


def get_table_client(table_name: str):
    """
    지정한 이름의 Table Storage 클라이언트를 반환합니다.
    테이블이 존재하지 않으면 자동으로 생성합니다.
    """
    service = TableServiceClient.from_connection_string(_get_conn_str())
    try:
        service.create_table(table_name)
    except ResourceExistsError:
        pass  # 이미 존재 → 정상
    except Exception as e:
        logger.warning(f"테이블 생성 시도 중 오류 ({table_name}): {e}")
    return service.get_table_client(table_name)


def get_blob_client(container_name: str = "user-uploads"):
    """
    지정한 컨테이너의 Blob Storage 클라이언트를 반환합니다.
    컨테이너가 존재하지 않으면 자동으로 생성합니다.
    """
    service = BlobServiceClient.from_connection_string(_get_conn_str())
    container = service.get_container_client(container_name)
    try:
        container.create_container()
    except ResourceExistsError:
        pass
    except Exception as e:
        logger.warning(f"컨테이너 생성 시도 중 오류 ({container_name}): {e}")
    return container
