"""PDF stamping: append a signature certificate page to the signed document.

Rather than overlaying the original pages (risking covering document
text), we append a final "SIGNATURE CERTIFICATE" page carrying one
section per signer (signature image, optional witness photo, audit
metadata). The document hash in the audit trail covers the sealed file.

Free tier: every page carries a light diagonal "Signed with SignSeen"
watermark (lifted for premium).
"""

import pymupdf

PAGE_WIDTH, PAGE_HEIGHT = 595, 842  # A4 points
MARGIN = 72
WATERMARK_TEXT = "Signed with SignSeen — free tier"
CONTENT_BOTTOM = PAGE_HEIGHT - MARGIN


def _apply_free_tier_watermark(doc: pymupdf.Document) -> None:
    """Light diagonal free-tier mark on every page of the sealed PDF."""
    for page in doc:
        cx, cy = page.rect.width / 2, page.rect.height / 2
        anchor = pymupdf.Point(cx - 150, cy)
        # insert_text only accepts multiples of 90°; morph for a diagonal.
        matrix = pymupdf.Matrix(1, 0, 0, 1, 0, 0)
        matrix.prerotate(45)
        page.insert_text(
            anchor,
            WATERMARK_TEXT,
            fontsize=40,
            fontname="helv",
            color=(0.90, 0.90, 0.90),
            morph=(anchor, matrix),
            overlay=True,
        )


def _signer_lines(signer: dict) -> list[str]:
    lines = [
        f"Signer: {signer.get('signer_name') or '—'}",
        f"Signed at (UTC): {signer.get('signed_at')}",
        f"Document ID: {signer.get('document_id')}",
        f"Session ID: {signer.get('session_id')}",
        f"Audit seal: {signer.get('audit_hash')}",
    ]
    assurance = signer.get("photo_assurance")
    if assurance:
        line = f"Witness photo assurance: {assurance['assurance']}"
        if assurance["assurance"] == "reduced":
            line += f" ({assurance['reason']})"
        lines.append(line)
    return lines


def _signer_section_height(signer: dict) -> int:
    image_block = 200 if signer.get("photo_png") else 150
    return image_block + 20 + 18 * len(_signer_lines(signer))


def _render_signer_section(page: pymupdf.Page, signer: dict, y: int) -> int:
    """Render one signer's certificate section at y; return the new y."""
    signature_png = signer["signature_png"]
    photo_png = signer.get("photo_png")

    # Signature image (left) and witness photo (right, if provided).
    sig_rect = pymupdf.Rect(MARGIN, y, MARGIN + 220, y + 110)
    page.insert_image(sig_rect, stream=signature_png)
    page.insert_text(
        (MARGIN, y + 124), "Signature", fontsize=9, color=(0.4, 0.4, 0.4)
    )
    if photo_png:
        photo_rect = pymupdf.Rect(MARGIN + 260, y, MARGIN + 420, y + 160)
        page.insert_image(photo_rect, stream=photo_png)
        page.insert_text(
            (MARGIN + 260, y + 174),
            "Witness photo",
            fontsize=9,
            color=(0.4, 0.4, 0.4),
        )
        y += 200
    else:
        y += 150

    y += 20
    for line in _signer_lines(signer):
        page.insert_text((MARGIN, y), line, fontsize=10, fontname="helv")
        y += 18
    return y


def _render_header(page: pymupdf.Page) -> int:
    y = MARGIN
    page.insert_text(
        (MARGIN, y), "SIGNATURE CERTIFICATE", fontsize=22, fontname="helv"
    )
    y += 28
    page.insert_text(
        (MARGIN, y),
        "Signed with SignSeen — Signed. Seen. Sealed.",
        fontsize=11,
        fontname="helv",
        color=(0.35, 0.35, 0.35),
    )
    return y + 44


# Fixed render sizes (points) for placed fields in v1 (#13): the
# sender controls position/type/assignment, not dimensions.
FIELD_SIZES = {
    "signature": (180, 60),
    "initials": (90, 45),
    "checkbox": (16, 16),
    "text": (220, 18),
    "date": (140, 18),
}


def _stamp_fields(doc: pymupdf.Document, fields: list[dict]) -> None:
    """Stamp completed fields onto their pages at normalized coords.

    Each field dict: {type, page (1-based), x, y (0-1 fractions of the
    page size), value_text, image_png (bytes or None)}. A checked
    checkbox renders as an X inside an outlined box; an unchecked one
    as the empty box.
    """
    for field in fields:
        page_no = field["page"] - 1
        if page_no < 0 or page_no >= doc.page_count:
            continue
        page = doc[page_no]
        width, height = page.rect.width, page.rect.height
        x = field["x"] * width
        y = field["y"] * height
        ftype = field["type"]
        w, h = FIELD_SIZES.get(ftype, (180, 60))
        if ftype in ("signature", "initials"):
            if field.get("image_png"):
                rect = pymupdf.Rect(
                    x, y, min(x + w, width), min(y + h, height)
                )
                page.insert_image(rect, stream=field["image_png"])
        elif ftype == "checkbox":
            rect = pymupdf.Rect(x, y, x + w, y + h)
            page.draw_rect(rect, color=(0.1, 0.1, 0.1), width=1)
            if field.get("value_text") == "true":
                page.insert_text(
                    (x + 3, y + h - 3), "X", fontsize=13, fontname="helv"
                )
        elif ftype in ("text", "date"):
            if field.get("value_text"):
                page.insert_text(
                    (x, y + 13),
                    field["value_text"],
                    fontsize=12,
                    fontname="helv",
                )


def build_signed_pdf_multi(
    original_path: str,
    signers: list[dict],
    watermark: bool = True,
    fields: list[dict] | None = None,
) -> bytes:
    """Seal a document with one certificate section per signer.

    Each signer dict carries `signature_png`, optional `photo_png`, and
    the metadata rendered in its section (`signer_name`, `signed_at`,
    `document_id`, `session_id`, `audit_hash`, optional
    `photo_assurance`). Sections flow onto additional certificate pages
    when they no longer fit.
    """
    doc = pymupdf.open(original_path)
    if fields:
        _stamp_fields(doc, fields)
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    y = _render_header(page)

    for i, signer in enumerate(signers):
        if y + _signer_section_height(signer) > CONTENT_BOTTOM:
            page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
            y = MARGIN
        y = _render_signer_section(page, signer, y)
        y += 24 if i < len(signers) - 1 else 12

    if y + 40 > CONTENT_BOTTOM:
        page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
        y = MARGIN
    page.insert_text(
        (MARGIN, y),
        "Verify: the audit seal above must match the final event hash in the",
        fontsize=9,
        color=(0.4, 0.4, 0.4),
    )
    page.insert_text(
        (MARGIN, y + 14),
        "document's tamper-evident audit trail.",
        fontsize=9,
        color=(0.4, 0.4, 0.4),
    )

    if watermark:
        _apply_free_tier_watermark(doc)
    return doc.tobytes()


def build_signed_pdf(
    original_path: str,
    signature_png: bytes,
    photo_png: bytes | None,
    meta: dict,
    watermark: bool = True,
) -> bytes:
    """Single-signer seal (the original entry point)."""
    signer = {
        "signature_png": signature_png,
        "photo_png": photo_png,
        **meta,
    }
    return build_signed_pdf_multi(original_path, [signer], watermark=watermark)
