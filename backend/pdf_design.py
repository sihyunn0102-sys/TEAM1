"""
PDF 리포트의 모든 시각 요소(색상, 스타일, 섹션 빌더, 워터마크)를
이 파일에서 관리합니다. report_generator.py는 이 모듈을 호출합니다.

워터마크:
  assets/logo.png 파일을 각 페이지 중앙에 반투명(8%)으로 배치합니다
  PIL(Pillow)이 설치되어 있어야 합니다. 없으면 워터마크를 건너뜁니다
"""

import os
import tempfile

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── 경로 ──────────────────────────────────────────────────────────
_HERE       = os.path.dirname(os.path.abspath(__file__))
LOGO_PATH   = os.path.join(_HERE, "assets", "logo.png")

# ── 폰트 ──────────────────────────────────────────────────────────
_FONT_CANDIDATES = [
    "C:/Windows/Fonts/malgun.ttf",
    "C:/Windows/Fonts/NanumGothic.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/System/Library/Fonts/AppleGothic.ttf",
]
FONT_NAME = "Helvetica"
for _fp in _FONT_CANDIDATES:
    if os.path.exists(_fp):
        try:
            pdfmetrics.registerFont(TTFont("KoreanFont", _fp))
            FONT_NAME = "KoreanFont"
            break
        except Exception:
            continue

# ── 디자인 토큰 ────────────────────────────────────────────────────
NAVY        = "#1e3a8a"
NAVY_LIGHT  = "#dbeafe"
BLUE_MID    = "#3b82f6"
GRAY_BG     = "#f8fafc"
GRAY_LINE   = "#e2e8f0"
GRAY_TEXT   = "#64748b"
DARK_TEXT   = "#1e293b"

# ── 판정 색상 (전경, 배경, 테두리) ────────────────────────────────
VERDICT_COLORS = {
    "hard_block": ("#dc2626", "#fef2f2", "#fca5a5"),
    "caution":    ("#d97706", "#fffbeb", "#fde68a"),
    "safe":       ("#16a34a", "#f0fdf4", "#86efac"),
}
VERDICT_LABELS = {
    "hard_block": "고위험",
    "caution":    "주의",
    "safe":       "정상",
}

# ── 위반 항목 심각도별 색상 ────────────────────────────────────────
LEVEL_COLORS = {
    "hard_block": ("#ea580c", "#fff7ed", "#fed7aa"),
    "caution":    ("#ca8a04", "#fefce8", "#fde68a"),
}
LEVEL_LABELS = {
    "hard_block": "고위험",
    "caution":    "주의",
}

# ── 수정안 스타일 색상 ─────────────────────────────────────────────
STYLE_LABELS = {
    "safe":       "안전형",
    "marketing":  "마케팅형",
    "functional": "성분형",
}
STYLE_COLORS = {
    "safe":       ("#eff6ff", "#1d4ed8", "#bfdbfe"),
    "marketing":  ("#faf5ff", "#6d28d9", "#ddd6fe"),
    "functional": ("#f0fdf4", "#15803d", "#bbf7d0"),
}


# ══════════════════════════════════════════════════════════════════
#  워터마크
# ══════════════════════════════════════════════════════════════════

def _make_watermark_image(src: str, opacity: float = 0.08) -> str | None:
    """PIL로 로고를 반투명하게 만들어 임시 PNG 경로를 반환합니다."""
    try:
        from PIL import Image
    except ImportError:
        return None
    if not os.path.exists(src):
        return None
    try:
        img = Image.open(src).convert("RGBA")
        r, g, b, a = img.split()
        a = a.point(lambda x: int(x * opacity))
        img = Image.merge("RGBA", (r, g, b, a))
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        img.save(tmp.name, "PNG")
        tmp.close()
        return tmp.name
    except Exception:
        return None


# 모듈 로드 시 한 번만 워터마크 이미지를 생성
_WM_PATH = _make_watermark_image(LOGO_PATH, opacity=0.08)

_PAGE_W, _PAGE_H = A4


def draw_watermark(canvas, doc):
    """각 페이지 중앙에 반투명 로고를 그립니다 (onPage 콜백)."""
    if not _WM_PATH:
        return
    size = 130 * mm
    x = (_PAGE_W - size) / 2
    y = (_PAGE_H - size) / 2
    canvas.saveState()
    canvas.drawImage(_WM_PATH, x, y, width=size, height=size,
                     mask="auto", preserveAspectRatio=True)
    canvas.restoreState()


# ══════════════════════════════════════════════════════════════════
#  스타일 팩토리
# ══════════════════════════════════════════════════════════════════

def make_styles(fn: str = FONT_NAME) -> dict:
    return dict(
        title=ParagraphStyle(
            "rTitle", fontName=fn, fontSize=22, leading=28,
            textColor=colors.white, spaceAfter=2,
        ),
        subtitle=ParagraphStyle(
            "rSubtitle", fontName=fn, fontSize=10, leading=15,
            textColor=colors.HexColor("#93c5fd"), spaceAfter=0,
        ),
        meta=ParagraphStyle(
            "rMeta", fontName=fn, fontSize=8, leading=13,
            textColor=colors.HexColor("#93c5fd"),
        ),
        h1=ParagraphStyle(
            "rH1", fontName=fn, fontSize=11, leading=16,
            textColor=colors.HexColor(NAVY),
            spaceBefore=14, spaceAfter=6,
        ),
        h2=ParagraphStyle(
            "rH2", fontName=fn, fontSize=10, leading=15,
            textColor=colors.HexColor(DARK_TEXT),
            spaceBefore=8, spaceAfter=3,
        ),
        body=ParagraphStyle(
            "rBody", fontName=fn, fontSize=9.5, leading=15,
            textColor=colors.HexColor(DARK_TEXT), spaceAfter=3,
        ),
        small=ParagraphStyle(
            "rSmall", fontName=fn, fontSize=8.5, leading=13,
            textColor=colors.HexColor(GRAY_TEXT), spaceAfter=2,
        ),
        code=ParagraphStyle(
            "rCode", fontName=fn, fontSize=9, leading=14,
            textColor=colors.HexColor("#334155"),
            leftIndent=4, rightIndent=4, spaceAfter=4,
        ),
        footer=ParagraphStyle(
            "rFooter", fontName=fn, fontSize=8, leading=12,
            textColor=colors.HexColor("#94a3b8"),
        ),
    )


# ══════════════════════════════════════════════════════════════════
#  섹션 빌더 헬퍼
# ══════════════════════════════════════════════════════════════════

def section_header(title: str, width: float, fn: str = FONT_NAME) -> Table:
    """네이비 언더라인 섹션 타이틀 테이블을 반환합니다."""
    t = Table(
        [[Paragraph(title, ParagraphStyle(
            "sh", fontName=fn, fontSize=11, leading=16,
            textColor=colors.HexColor(NAVY)))]],
        colWidths=[width],
    )
    t.setStyle(TableStyle([
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("LINEBELOW",     (0, 0), (-1, -1), 1.5, colors.HexColor(NAVY)),
    ]))
    return t


def verdict_badge(verdict: str, width: float, fn: str = FONT_NAME) -> Table:
    """왼쪽 컬러 바 + 판정 배지 테이블을 반환합니다."""
    fg_c, bg_c, bd_c = VERDICT_COLORS.get(verdict, ("#1e293b", "#f1f5f9", "#cbd5e1"))
    label = VERDICT_LABELS.get(verdict, verdict)

    inner = Table(
        [[Paragraph(
            f"<b>판정 결과: {label}</b> &nbsp; ({verdict})",
            ParagraphStyle("badge", fontName=fn, fontSize=11,
                           textColor=colors.HexColor(fg_c)),
        )]],
        colWidths=[width - 4],
    )
    inner.setStyle(TableStyle([
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    outer = Table([[Table([[""]], colWidths=[4]), inner]], colWidths=[4, width - 4])
    outer.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, 0),  colors.HexColor(fg_c)),
        ("BACKGROUND",    (1, 0), (1, 0),  colors.HexColor(bg_c)),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("BOX",           (0, 0), (-1, -1), 0.5, colors.HexColor(bd_c)),
    ]))
    return outer


def sponsored_badge(insert_sug: str, width: float, fn: str = FONT_NAME) -> Table:
    """협찬 표시 누락 경고 배지를 반환합니다."""
    text = (f"협찬 표시 누락  →  삽입 제안: {insert_sug}"
            if insert_sug else "협찬 표시 누락")
    inner = Table(
        [[Paragraph(text, ParagraphStyle(
            "sp", fontName=fn, fontSize=9,
            textColor=colors.HexColor("#92400e")))]],
        colWidths=[width - 4],
    )
    inner.setStyle(TableStyle([
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
    ]))
    outer = Table([[Table([[""]], colWidths=[4]), inner]], colWidths=[4, width - 4])
    outer.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, 0),  colors.HexColor("#d97706")),
        ("BACKGROUND",    (1, 0), (1, 0),  colors.HexColor("#fffbeb")),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("BOX",           (0, 0), (-1, -1), 0.5, colors.HexColor("#fde68a")),
    ]))
    return outer


# ══════════════════════════════════════════════════════════════════
#  story 빌더 (전체 PDF 내용 구성)
# ══════════════════════════════════════════════════════════════════

def build_story(
    task_id: str,
    ts_str: str,
    verdict: str,
    risk_summary: str,
    orig_text: str,
    violations: list,
    rewrites: list,
    rag_sources: list,
    sponsored: bool,
    insert_sug: str,
) -> list:
    """PDF story 리스트를 생성하여 반환합니다."""
    s  = make_styles()
    fn = FONT_NAME
    W  = A4[0] - 44 * mm  # 본문 사용 너비

    story = []

    # ── 헤더 (네이비 배경 블록) ────────────────────────────────────
    header_rows = [
        [Paragraph("AdGuard", s["title"])],
        [Paragraph("광고 검수 리포트", s["subtitle"])],
        [Spacer(1, 6)],
        [Paragraph(f"검수 ID: {task_id}", s["meta"])],
        [Paragraph(f"검수 일시: {ts_str}", s["meta"])],
    ]
    header_inner = Table(header_rows, colWidths=[W])
    header_inner.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor(NAVY)),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
    ]))
    header_outer = Table([[header_inner]], colWidths=[W])
    header_outer.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor(NAVY)),
        ("TOPPADDING",    (0, 0), (-1, -1), 20),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
    ]))
    story.append(header_outer)
    story.append(Spacer(1, 16))

    # ── 판정 배지 ──────────────────────────────────────────────────
    story.append(verdict_badge(verdict, W, fn))
    story.append(Spacer(1, 8))
    story.append(Paragraph(risk_summary, s["body"]))

    if sponsored:
        story.append(Spacer(1, 6))
        story.append(sponsored_badge(insert_sug, W, fn))

    story.append(Spacer(1, 12))

    # ── 원문 텍스트 ────────────────────────────────────────────────
    if orig_text:
        story.append(section_header("원문 광고 텍스트", W, fn))
        story.append(Spacer(1, 6))
        preview = orig_text[:500] + ("..." if len(orig_text) > 500 else "")
        orig_box = Table(
            [[Paragraph(preview.replace("\n", "<br/>"), s["code"])]],
            colWidths=[W],
        )
        orig_box.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor(GRAY_BG)),
            ("TOPPADDING",    (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("LEFTPADDING",   (0, 0), (-1, -1), 12),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
            ("BOX",           (0, 0), (-1, -1), 0.5, colors.HexColor(GRAY_LINE)),
        ]))
        story.append(orig_box)
        story.append(Spacer(1, 10))

    # ── 위반 항목 ──────────────────────────────────────────────────
    if violations:
        story.append(section_header(f"위반 항목  ({len(violations)}건)", W, fn))
        story.append(Spacer(1, 6))

        for i, v in enumerate(violations, 1):
            phrase   = v.get("keyword", "")
            law      = v.get("law_ref", "")
            desc     = v.get("description", "")
            cat      = v.get("category", "")
            lv       = v.get("level", "hard_block")
            fg_c, bg_c, bd_c = LEVEL_COLORS.get(lv, ("#6b7280", "#f9fafb", "#e5e7eb"))
            lv_label = LEVEL_LABELS.get(lv, lv)

            dot_cell = Table(
                [[Paragraph("●", ParagraphStyle(
                    "dot", fontName=fn, fontSize=8,
                    textColor=colors.HexColor(fg_c), leading=14))]],
                colWidths=[14],
            )
            dot_cell.setStyle(TableStyle([
                ("TOPPADDING",    (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING",   (0, 0), (-1, -1), 10),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
                ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor(bg_c)),
            ]))
            phrase_cell = Table(
                [[Paragraph(f"<b>{i}.</b>  {phrase}", ParagraphStyle(
                    "vp", fontName=fn, fontSize=9.5, leading=14,
                    textColor=colors.HexColor(DARK_TEXT)))]],
                colWidths=[W - 80],
            )
            phrase_cell.setStyle(TableStyle([
                ("TOPPADDING",    (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING",   (0, 0), (-1, -1), 6),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
                ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor(bg_c)),
            ]))
            tag_cell = Table(
                [[Paragraph(lv_label, ParagraphStyle(
                    "vt", fontName=fn, fontSize=8,
                    textColor=colors.white, alignment=1))]],
                colWidths=[46],
            )
            tag_cell.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor(fg_c)),
                ("TOPPADDING",    (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING",   (0, 0), (-1, -1), 4),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
            ]))
            row = Table([[dot_cell, phrase_cell, tag_cell]], colWidths=[14, W - 80, 46])
            row.setStyle(TableStyle([
                ("TOPPADDING",    (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("LEFTPADDING",   (0, 0), (-1, -1), 0),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
                ("BOX",           (0, 0), (-1, -1), 0.5, colors.HexColor(bd_c)),
            ]))
            story.append(row)

            for detail in filter(None, [
                f"유형: {cat}"  if cat  else None,
                f"법령: {law}"  if law  else None,
                f"사유: {desc}" if desc else None,
            ]):
                story.append(Paragraph(
                    detail,
                    ParagraphStyle("det", fontName=fn, fontSize=8, leading=12,
                                   textColor=colors.HexColor(GRAY_TEXT),
                                   leftIndent=20, spaceAfter=1),
                ))
            story.append(Spacer(1, 5))

    # ── 수정안 ────────────────────────────────────────────────────
    if rewrites:
        story.append(PageBreak())
        story.append(section_header("수정안", W, fn))
        story.append(Spacer(1, 4))
        story.append(Paragraph(
            "아래 3가지 스타일 중 하나를 선택하여 사용하세요.", s["small"]
        ))
        story.append(Spacer(1, 10))

        for rw in rewrites:
            style    = rw.get("style", "")
            text     = rw.get("text", "")
            passed   = rw.get("passed", False)
            attempts = rw.get("attempts", 1)
            label    = STYLE_LABELS.get(style, style)
            bg_c, fg_c, bd_c = STYLE_COLORS.get(style, ("#f8fafc", NAVY, "#e2e8f0"))
            pass_str = "통과" if passed else "미통과"

            hdr = Table(
                [[
                    Paragraph(f"<b>{label}</b>", ParagraphStyle(
                        "rh", fontName=fn, fontSize=10,
                        textColor=colors.HexColor(fg_c))),
                    Paragraph(f"{pass_str}  ·  시도 {attempts}회", ParagraphStyle(
                        "rs", fontName=fn, fontSize=8,
                        textColor=colors.HexColor(fg_c), alignment=2)),
                ]],
                colWidths=[W * 0.65, W * 0.35],
            )
            hdr.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor(bg_c)),
                ("TOPPADDING",    (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING",   (0, 0), (-1, -1), 14),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
                ("LINEBELOW",     (0, 0), (-1, -1), 0.5, colors.HexColor(bd_c)),
            ]))
            body_row = Table(
                [[Paragraph(text, s["body"])]],
                colWidths=[W],
            )
            body_row.setStyle(TableStyle([
                ("TOPPADDING",    (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("LEFTPADDING",   (0, 0), (-1, -1), 14),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
            ]))
            card = Table([[hdr], [body_row]], colWidths=[W])
            card.setStyle(TableStyle([
                ("TOPPADDING",    (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("LEFTPADDING",   (0, 0), (-1, -1), 0),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
                ("BOX",           (0, 0), (-1, -1), 0.5, colors.HexColor(bd_c)),
            ]))
            story.append(card)
            story.append(Spacer(1, 10))

    # ── 참고 법령 ─────────────────────────────────────────────────
    if rag_sources:
        story.append(PageBreak())
        story.append(section_header(f"참고 법령 및 사례  ({len(rag_sources)}건)", W, fn))
        story.append(Spacer(1, 4))
        story.append(Paragraph(
            "아래 법령·지침은 판정 근거로 사용된 검색 결과입니다.", s["small"]
        ))
        story.append(Spacer(1, 10))

        for i, src in enumerate(rag_sources, 1):
            source  = src.get("source", "")
            article = src.get("article", "")
            content = src.get("content", "")
            story.append(Paragraph(
                f"<b>{i}.</b>  [{source}]" + (f"  {article}" if article else ""),
                s["h2"],
            ))
            preview = content[:400] + ("..." if len(content) > 400 else "")
            law_box = Table(
                [[Paragraph(preview.replace("\n", "<br/>"), s["small"])]],
                colWidths=[W],
            )
            law_box.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor(GRAY_BG)),
                ("TOPPADDING",    (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING",   (0, 0), (-1, -1), 12),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
                ("LINEBEFORE",    (0, 0), (0, -1),  2, colors.HexColor(BLUE_MID)),
            ]))
            story.append(law_box)
            story.append(Spacer(1, 8))

    # ── 면책 문구 ─────────────────────────────────────────────────
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5,
                             color=colors.HexColor(GRAY_LINE), spaceAfter=8))
    story.append(Paragraph(
        "본 리포트는 참고용이며 법적 자문을 대체하지 않습니다. "
        "최종 판단은 법률 전문가에게 확인하시기 바랍니다.",
        s["footer"],
    ))
    story.append(Paragraph("© AdGuard · 화장품 광고 자동 검수 시스템", s["footer"]))

    return story
