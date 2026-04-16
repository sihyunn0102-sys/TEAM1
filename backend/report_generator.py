"""
report_generator.py  ── PDF 리포트 생성기
──────────────────────────────────────────
reportlab을 사용해 광고 검수 결과를 PDF로 생성합니다.

포함 내용:
  1. 헤더 (AdGuard 로고 텍스트 + 검수 일시)
  2. 판정 요약 (verdict, risk_summary, 협찬 표시 누락)
  3. 원문 광고 텍스트
  4. 위반 항목 목록 (keyword/item, 법령, 설명)
  5. 수정안 3가지 (safe / marketing / functional)
  6. 참고 법령 목록 (rag_sources)
  7. 면책 문구

필드 기준 (가이드라인 일치):
  - 판정: verdict (hard_block | caution | safe)
  - 요약: risk_summary
  - 위반 심각도: violations[].level (hard_block | caution)
"""

import json
import os
import tempfile
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── 한글 폰트 등록 ──────────────────────────────────────────────────
# Windows/Linux/macOS 공통으로 사용 가능한 폰트 경로 탐색
_FONT_CANDIDATES = [
    "C:/Windows/Fonts/malgun.ttf",           # Windows 맑은 고딕
    "C:/Windows/Fonts/NanumGothic.ttf",      # Windows 나눔고딕
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",  # Linux
    "/System/Library/Fonts/AppleGothic.ttf", # macOS
]

_FONT_NAME = "Helvetica"  # 폰트 미발견 시 fallback

for _fp in _FONT_CANDIDATES:
    if os.path.exists(_fp):
        try:
            pdfmetrics.registerFont(TTFont("KoreanFont", _fp))
            _FONT_NAME = "KoreanFont"
            break
        except Exception:
            continue


def _styles():
    """PDF에 사용할 ParagraphStyle 모음을 반환합니다."""
    fn = _FONT_NAME
    title    = ParagraphStyle("rTitle",    fontName=fn, fontSize=20, leading=26,
                               textColor=colors.HexColor("#1a1a2e"), spaceAfter=4)
    subtitle = ParagraphStyle("rSubtitle", fontName=fn, fontSize=11, leading=16,
                               textColor=colors.HexColor("#6b6b80"), spaceAfter=16)
    h1       = ParagraphStyle("rH1",       fontName=fn, fontSize=13, leading=18,
                               textColor=colors.HexColor("#1a1a2e"), spaceBefore=14, spaceAfter=6)
    h2       = ParagraphStyle("rH2",       fontName=fn, fontSize=11, leading=16,
                               textColor=colors.HexColor("#3a3a4e"), spaceBefore=10, spaceAfter=4)
    body     = ParagraphStyle("rBody",     fontName=fn, fontSize=10, leading=16,
                               textColor=colors.HexColor("#3a3a4e"), spaceAfter=4)
    small    = ParagraphStyle("rSmall",    fontName=fn, fontSize=9,  leading=14,
                               textColor=colors.HexColor("#6b6b80"), spaceAfter=2)
    code = ParagraphStyle("rCode", fontName=fn, fontSize=9, leading=14,
                               textColor=colors.HexColor("#2c2c3a"),
                               backColor=colors.HexColor("#f5f5f0"),
                               leftIndent=8, rightIndent=8, spaceAfter=4)
    return dict(title=title, subtitle=subtitle, h1=h1, h2=h2,
                body=body, small=small, code=code)


# ── 판정 결과별 색상 (가이드라인 기준: hard_block | caution | safe) ──
_VERDICT_COLORS = {
    "hard_block": ("#7f1d1d", "#fee2e2"),  # 전경색, 배경색
    "caution":    ("#713f12", "#fef9c3"),
    "safe":       ("#14532d", "#dcfce7"),
}
_VERDICT_LABELS = {
    "hard_block": "고위험",
    "caution":    "주의",
    "safe":       "정상",
}

# ── 위반 항목 심각도별 색상 (violations[].level 기준) ─────────────
_LEVEL_COLORS = {
    "hard_block": "#fee2e2",
    "caution":    "#fef9c3",
}
_LEVEL_LABELS = {
    "hard_block": "고위험",
    "caution":    "주의",
}

# ── 수정안 스타일 표시명 ──────────────────────────────────────────
_STYLE_LABELS = {
    "safe":       "안전형",
    "marketing":  "마케팅형",
    "functional": "성분형",
}
_STYLE_COLORS = {
    "safe":       ("#e6f1fb", "#0c447c"),
    "marketing":  ("#eeedfe", "#3c3489"),
    "functional": ("#e1f5ee", "#085041"),
}


def generate_report(task_id: str, entity: dict) -> str:
    """
    판정 결과 entity로 PDF를 생성하고 임시 파일 경로를 반환합니다.

    Args:
        task_id: 요청 고유 ID (UUID)
        entity:  Table Storage에서 가져온 entity dict.
                 full_result 필드(JSON 문자열)에서 전체 판정 데이터를 읽습니다.

    Returns:
        생성된 PDF 임시 파일 경로
    """
    # full_result JSON 파싱 — pipeline.py가 저장한 전체 판정 결과
    raw = entity.get("full_result", "{}")
    try:
        data = json.loads(raw)
    except Exception:
        data = {}

    # 필드명 호환 — 구 파이프라인(verdict) + 신 cascade(final_verdict) 모두 지원
    verdict      = (data.get("final_verdict")           # cascade.check() 신 형식
                    or data.get("verdict")              # 구 pipeline.py 형식
                    or entity.get("verdict", ""))
    risk_summary = (data.get("explanation")             # cascade 신 형식
                    or data.get("risk_summary")         # 구 형식
                    or entity.get("risk_summary", ""))

    # violations: cascade는 phrase 필드, 구 파이프라인은 keyword/item 필드
    raw_violations = data.get("violations", [])
    violations = []
    for v in raw_violations:
        phrase = v.get("phrase") or v.get("keyword") or v.get("item") or ""
        violations.append({
            "keyword": phrase,
            "item": phrase,
            "category": v.get("type") or v.get("category", ""),
            "level": v.get("severity") or v.get("level", "caution"),
            "law_ref": v.get("law_ref", ""),
            "description": v.get("explanation") or v.get("description", ""),
        })

    # rewrites: cascade는 verified_rewrites + {style,text,status,verdict}
    #           구 파이프라인은 rewrite_suggestions + {style,text,passed,attempts}
    raw_rewrites = (data.get("verified_rewrites")       # cascade 신 형식
                    or data.get("rewrite_suggestions")  # 구 형식
                    or [])
    rewrites = []
    for r in raw_rewrites:
        rewrites.append({
            "style":   r.get("style", ""),
            "text":    r.get("text", ""),
            "passed":  r.get("status") == "passed" if "status" in r else r.get("passed", False),
            "attempts": r.get("retry_count", r.get("attempts", 1)),
        })

    rag_sources  = data.get("rag_sources", [])
    orig_text    = entity.get("text", "")   # 저장 시 text[:500]으로 절단
    sponsored    = data.get("sponsored_missing", False)
    insert_sug   = data.get("insert_suggestion", "")
    timestamp    = entity.get("timestamp", "")

    # 타임스탬프 포맷
    try:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        ts_str = dt.strftime("%Y년 %m월 %d일 %H:%M (UTC)")
    except Exception:
        ts_str = timestamp

    verdict_fg, verdict_bg = _VERDICT_COLORS.get(verdict, ("#1a1a2e", "#f1f0e8"))

    s  = _styles()
    fn = _FONT_NAME
    pdf_path = os.path.join(tempfile.gettempdir(), f"adguard_{task_id[:8]}.pdf")

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=20*mm,  bottomMargin=20*mm,
    )

    story = []
    W = A4[0] - 40*mm  # 본문 사용 가능 너비

    # ── 1. 헤더 ────────────────────────────────────────────────────
    story.append(Paragraph("AdGuard", s["title"]))
    story.append(Paragraph("광고 검수 리포트", s["subtitle"]))
    story.append(Paragraph(f"검수 ID: {task_id}", s["small"]))
    story.append(Paragraph(f"검수 일시: {ts_str}", s["small"]))
    story.append(HRFlowable(width="100%", thickness=1,
                             color=colors.HexColor("#e0e0e0"), spaceAfter=10))

    # ── 2. 판정 요약 배지 ──────────────────────────────────────────
    verdict_label = _VERDICT_LABELS.get(verdict, verdict)
    badge_data = [[
        Paragraph(
            f"판정 결과: {verdict_label} ({verdict})",
            ParagraphStyle("badge", fontName=fn, fontSize=12,
                           textColor=colors.HexColor(verdict_fg)),
        ),
    ]]
    badge_table = Table(badge_data, colWidths=[W])
    badge_table.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,-1), colors.HexColor(verdict_bg)),
        ("TOPPADDING",  (0,0), (-1,-1), 10),
        ("BOTTOMPADDING",(0,0),(-1,-1), 10),
        ("LEFTPADDING", (0,0), (-1,-1), 14),
        ("BOX",         (0,0), (-1,-1), 0.5, colors.HexColor(verdict_fg)),
    ]))
    story.append(badge_table)
    story.append(Spacer(1, 8))
    story.append(Paragraph(f"요약: {risk_summary}", s["body"]))

    # 협찬 표시 누락 경고 배지
    if sponsored:
        story.append(Spacer(1, 6))
        sp_text = (f"협찬 표시 누락  →  삽입 제안: {insert_sug}"
                   if insert_sug else "협찬 표시 누락")
        sp_data = [[Paragraph(
            sp_text,
            ParagraphStyle("sp", fontName=fn, fontSize=9,
                           textColor=colors.HexColor("#713f12")),
        )]]
        sp_table = Table(sp_data, colWidths=[W])
        sp_table.setStyle(TableStyle([
            ("BACKGROUND",   (0,0), (-1,-1), colors.HexColor("#fef9c3")),
            ("TOPPADDING",   (0,0), (-1,-1), 6),
            ("BOTTOMPADDING",(0,0), (-1,-1), 6),
            ("LEFTPADDING",  (0,0), (-1,-1), 12),
            ("BOX",          (0,0), (-1,-1), 0.5, colors.HexColor("#ca8a04")),
        ]))
        story.append(sp_table)

    story.append(Spacer(1, 10))

    # ── 3. 원문 텍스트 ─────────────────────────────────────────────
    if orig_text:
        story.append(Paragraph("원문 광고 텍스트", s["h1"]))
        preview = orig_text[:500] + ("..." if len(orig_text) > 500 else "")
        story.append(Paragraph(preview.replace("\n", "<br/>"), s["code"]))
        story.append(Spacer(1, 8))

    # ── 4. 위반 항목 ───────────────────────────────────────────────
    if violations:
        story.append(Paragraph(f"위반 항목 ({len(violations)}건)", s["h1"]))

        for i, v in enumerate(violations, 1):
            phrase   = v.get("keyword") or v.get("item") or ""
            law      = v.get("law_ref", "")
            desc     = v.get("description", "")
            cat      = v.get("category", "")
            lv       = v.get("level", "hard_block")   # hard_block | caution
            bg_color = _LEVEL_COLORS.get(lv, "#f1f0e8")
            lv_label = _LEVEL_LABELS.get(lv, lv)

            row_data = [[
                Paragraph(
                    f"<b>{i}.</b> {phrase}",
                    ParagraphStyle("vp", fontName=fn, fontSize=10,
                                   textColor=colors.HexColor("#1a1a2e")),
                ),
                Paragraph(
                    lv_label,
                    ParagraphStyle("vl", fontName=fn, fontSize=9,
                                   textColor=colors.HexColor("#6b6b80"),
                                   alignment=1),
                ),
            ]]
            row_table = Table(row_data, colWidths=[W - 50, 50])
            row_table.setStyle(TableStyle([
                ("BACKGROUND",   (0,0), (-1,-1), colors.HexColor(bg_color)),
                ("TOPPADDING",   (0,0), (-1,-1), 8),
                ("BOTTOMPADDING",(0,0), (-1,-1), 4),
                ("LEFTPADDING",  (0,0), (-1,-1), 12),
                ("RIGHTPADDING", (0,0), (-1,-1), 8),
                ("BOX",          (0,0), (-1,-1), 0.5, colors.HexColor("#d0d0d0")),
            ]))
            story.append(row_table)

            for detail in filter(None, [
                f"유형: {cat}" if cat else None,
                f"법령: {law}" if law else None,
                f"사유: {desc}" if desc else None,
            ]):
                story.append(Paragraph(detail, s["small"]))
            story.append(Spacer(1, 6))

    # ── 5. 수정안 ──────────────────────────────────────────────────
    if rewrites:
        story.append(PageBreak())
        story.append(Paragraph("수정안", s["h1"]))
        story.append(Paragraph(
            "아래 3가지 스타일 중 하나를 선택하여 사용하세요.", s["small"]
        ))
        story.append(Spacer(1, 8))

        for rw in rewrites:
            style    = rw.get("style", "")
            text     = rw.get("text", "")
            passed   = rw.get("passed", False)
            attempts = rw.get("attempts", 1)
            label    = _STYLE_LABELS.get(style, style)
            bg_c, fg_c = _STYLE_COLORS.get(style, ("#f1f0e8", "#1a1a2e"))
            pass_str = "통과" if passed else "미통과"

            header_data = [[
                Paragraph(label, ParagraphStyle(
                    "sh", fontName=fn, fontSize=11,
                    textColor=colors.HexColor(fg_c))),
                Paragraph(f"{pass_str}  |  시도 {attempts}회", ParagraphStyle(
                    "sm", fontName=fn, fontSize=9,
                    textColor=colors.HexColor(fg_c), alignment=2)),
            ]]
            header_table = Table(header_data, colWidths=[W*0.6, W*0.4])
            header_table.setStyle(TableStyle([
                ("BACKGROUND",   (0,0), (-1,-1), colors.HexColor(bg_c)),
                ("TOPPADDING",   (0,0), (-1,-1), 8),
                ("BOTTOMPADDING",(0,0), (-1,-1), 6),
                ("LEFTPADDING",  (0,0), (-1,-1), 12),
                ("RIGHTPADDING", (0,0), (-1,-1), 12),
                ("BOX",          (0,0), (-1,-1), 0.5, colors.HexColor(fg_c)),
            ]))
            story.append(header_table)
            story.append(Paragraph(text, s["body"]))
            story.append(Spacer(1, 10))

    # ── 6. 참고 법령 (rag_sources) ─────────────────────────────────
    if rag_sources:
        story.append(PageBreak())
        story.append(Paragraph(f"참고 법령 및 사례 ({len(rag_sources)}건)", s["h1"]))
        story.append(Paragraph(
            "아래 법령·지침은 판정 근거로 사용된 검색 결과입니다.", s["small"]
        ))
        story.append(Spacer(1, 8))

        for i, src in enumerate(rag_sources, 1):
            source  = src.get("source", "")
            article = src.get("article", "")
            content = src.get("content", "")

            story.append(Paragraph(
                f"{i}. [{source}]" + (f" {article}" if article else ""),
                s["h2"],
            ))
            preview = content[:400] + ("..." if len(content) > 400 else "")
            story.append(Paragraph(preview.replace("\n", "<br/>"), s["small"]))
            story.append(Spacer(1, 8))

    # ── 7. 면책 문구 ───────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5,
                             color=colors.HexColor("#e0e0e0"), spaceBefore=16))
    story.append(Paragraph(
        "본 리포트는 참고용이며 법적 자문을 대체하지 않습니다. "
        "최종 판단은 법률 전문가에게 확인하시기 바랍니다.",
        s["small"],
    ))
    story.append(Paragraph("© AdGuard · 화장품 광고 자동 검수 시스템", s["small"]))

    doc.build(story)
    return pdf_path
