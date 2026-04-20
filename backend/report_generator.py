"""
report_generator.py  ── PDF 리포트 생성기 (진입점)
──────────────────────────────────────────────────
데이터 파싱 + PDF 빌드만 담당합니다.
디자인(스타일, 색상, 워터마크, 섹션 빌더)은 pdf_design.py에서 관리합니다.
"""

import json
import os
import tempfile
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_design as design


def generate_report(task_id: str, entity: dict) -> str:
    """
    판정 결과 entity로 PDF를 생성하고 임시 파일 경로를 반환합니다.

    Args:
        task_id: 요청 고유 ID (UUID)
        entity:  full_result 필드(JSON 문자열)에 전체 판정 데이터 포함

    Returns:
        생성된 PDF 임시 파일 경로
    """
    # ── 데이터 파싱 ────────────────────────────────────────────────
    raw = entity.get("full_result", "{}")
    try:
        data = json.loads(raw)
    except Exception:
        data = {}

    verdict = (data.get("final_verdict")
               or data.get("verdict")
               or entity.get("verdict", ""))
    risk_summary = (data.get("explanation")
                    or data.get("risk_summary")
                    or entity.get("risk_summary", ""))

    violations = []
    for v in data.get("violations", []):
        phrase = v.get("phrase") or v.get("keyword") or v.get("item") or ""
        violations.append({
            "keyword":     phrase,
            "category":    v.get("type") or v.get("category", ""),
            "level":       v.get("severity") or v.get("level", "caution"),
            "law_ref":     v.get("law_ref", ""),
            "description": v.get("explanation") or v.get("description", ""),
        })

    rewrites = []
    for r in (data.get("verified_rewrites") or data.get("rewrite_suggestions") or []):
        rewrites.append({
            "style":    r.get("style", ""),
            "text":     r.get("text", ""),
            "passed":   r.get("status") == "passed" if "status" in r else r.get("passed", False),
            "attempts": r.get("retry_count", r.get("attempts", 1)),
        })

    rag_sources = data.get("rag_sources", [])
    orig_text   = entity.get("text", "")
    sponsored   = data.get("sponsored_missing", False)
    insert_sug  = data.get("insert_suggestion", "")
    timestamp   = entity.get("timestamp", "")

    try:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        ts_str = dt.strftime("%Y년 %m월 %d일 %H:%M (UTC)")
    except Exception:
        ts_str = timestamp

    # ── PDF 빌드 ──────────────────────────────────────────────────
    pdf_path = os.path.join(tempfile.gettempdir(), f"adguard_{task_id[:8]}.pdf")

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        leftMargin=22 * 2.8346,   # 22mm
        rightMargin=22 * 2.8346,
        topMargin=0,
        bottomMargin=18 * 2.8346, # 18mm
    )

    story = design.build_story(
        task_id=task_id,
        ts_str=ts_str,
        verdict=verdict,
        risk_summary=risk_summary,
        orig_text=orig_text,
        violations=violations,
        rewrites=rewrites,
        rag_sources=rag_sources,
        sponsored=sponsored,
        insert_sug=insert_sug,
    )

    doc.build(
        story,
        onFirstPage=design.draw_watermark,
        onLaterPages=design.draw_watermark,
    )

    return pdf_path

