"""PDF stamping: append signature certificate pages to the signed document.

Rather than overlaying the original pages (risking covering document
text), we append "SIGNATURE CERTIFICATE" pages carrying the signers in
a two-by-two grid (four per page, landscape): each section shows the
witness photo above the signature, with no labels on either image, and
the audit metadata below. The document hash in the audit trail covers
the sealed file.

Free tier: every page carries a light diagonal "Signed with SignSeen"
watermark (lifted for premium).
"""

import pymupdf

PAGE_WIDTH, PAGE_HEIGHT = 842, 595  # A4 landscape points
MARGIN = 36
WATERMARK_TEXT = "Signed with SignSeen — free tier"
CONTENT_BOTTOM = PAGE_HEIGHT - MARGIN
CERT_COLS, CERT_ROWS = 2, 2
CERT_GUTTER_X, CERT_GUTTER_Y = 20, 16
CERT_PHOTO_HEIGHT = 80
CERT_SIGNATURE_HEIGHT = 44
CERT_DETAIL_FONTSIZE = 8
CERT_DETAIL_LINE = 11
# Room kept below the grid on every certificate page so the "Verify"
# footer fits under the last row instead of spilling to its own page.
CERT_FOOTER_RESERVE = 46


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
    # Plain "-" fallback: the certificate renders in Helvetica, whose
    # encoding turns an em dash into a stray middle dot.
    lines = []
    if signer.get("is_originator"):
        lines.append("Document Originator")
    lines += [
        f"Signer: {signer.get('signer_name') or '-'}",
        f"Email: {signer.get('signer_email') or '-'}",
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


def _render_signer_cell(page: pymupdf.Page, signer: dict, x: float, y: float, width: float, height: float) -> None:
    """Render one signer's certificate section inside a grid cell.

    The witness photo sits above the signature, with no labels on
    either image, and the detail block underneath. Content is centred
    vertically in the cell, so a section without a photo still sits
    evenly in the grid.
    """
    photo_png = signer.get("photo_png")
    lines = _signer_lines(signer)
    text_h = CERT_DETAIL_LINE * len(lines)
    photo_h = CERT_PHOTO_HEIGHT if photo_png else 0
    content_h = (
        photo_h
        + (6 if photo_png else 0)
        + CERT_SIGNATURE_HEIGHT
        + 8
        + text_h
    )
    cy = y + (height - content_h) / 2
    if photo_png:
        page.insert_image(
            pymupdf.Rect(x, cy, x + width, cy + photo_h),
            stream=photo_png,
            keep_proportion=True,
        )
        cy += photo_h + 6
    page.insert_image(
        pymupdf.Rect(x, cy, x + width, cy + CERT_SIGNATURE_HEIGHT),
        stream=signer["signature_png"],
        keep_proportion=True,
    )
    cy += CERT_SIGNATURE_HEIGHT + 8
    font = pymupdf.Font("helv")
    for line in lines:
        # Long lines (the 64-hex audit seal) shrink to fit the cell
        # instead of running past its edge.
        size = CERT_DETAIL_FONTSIZE
        while size > 6 and font.text_length(line, size) > width:
            size -= 0.5
        page.insert_text(
            (x, cy + CERT_DETAIL_FONTSIZE),
            line,
            fontsize=size,
            fontname="helv",
        )
        cy += CERT_DETAIL_LINE


def _render_header(page: pymupdf.Page, brand_name: str = "") -> int:
    y = MARGIN
    page.insert_text(
        (MARGIN, y + 14), "SIGNATURE CERTIFICATE", fontsize=18, fontname="helv"
    )
    # Sender branding (premium): the owner's brand takes the product
    # line's place in the header; SignSeen stays named as the platform.
    product_line = (
        f"Signed via {brand_name} with SignSeen — Signed. Seen. Sealed."
        if brand_name
        else "Signed with SignSeen — Signed. Seen. Sealed."
    )
    page.insert_text(
        (MARGIN, y + 32),
        product_line,
        fontsize=10,
        fontname="helv",
        color=(0.35, 0.35, 0.35),
    )
    return y + 44


# Fixed render sizes (points) for placed fields without a drawn box
# (#13): the sender controls position/type/assignment, and a drawn
# box's size; click-placed and pre-existing fields use these.
FIELD_SIZES = {
    "signature": (180, 60),
    "initials": (90, 45),
    "checkbox": (16, 16),
    "text": (220, 18),
    "date": (140, 18),
    "signed_date": (140, 18),
}


def _field_box(field: dict, page_w: float, page_h: float) -> tuple[float, float]:
    """Render size in points for a field: its drawn box when stored,
    else the fixed per-type size."""
    fw, fh = field.get("width"), field.get("height")
    if fw is not None and fh is not None:
        return fw * page_w, fh * page_h
    return FIELD_SIZES.get(field["type"], (180, 60))


def _stamp_fields(doc: pymupdf.Document, fields: list[dict]) -> None:
    """Stamp completed fields onto their pages at normalized coords.

    Each field dict: {type, page (1-based), x, y (0-1 fractions of the
    page size), width, height (0-1 fractions or None), value_text,
    image_png (bytes or None)}. Content always fits inside the field's
    box, never outside it: images keep their aspect (fit inside, centred),
    a checkbox draws at the box's smaller side, and text/date shrink to
    fit the box width. A checked checkbox renders as an X inside an
    outlined box; an unchecked one as the empty box.
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
        w, h = _field_box(field, width, height)
        if ftype in ("signature", "initials"):
            if field.get("image_png"):
                rect = pymupdf.Rect(
                    x, y, min(x + w, width), min(y + h, height)
                )
                page.insert_image(
                    rect, stream=field["image_png"], keep_proportion=True
                )
        elif ftype == "checkbox":
            side = min(w, h)
            x0 = x + (w - side) / 2
            y0 = y + (h - side) / 2
            rect = pymupdf.Rect(x0, y0, x0 + side, y0 + side)
            page.draw_rect(rect, color=(0.1, 0.1, 0.1), width=1)
            if field.get("value_text") == "true":
                page.insert_text(
                    (x0 + 3, y0 + side - 3),
                    "X",
                    fontsize=max(8, side - 4),
                    fontname="helv",
                )
        elif ftype in ("text", "date", "signed_date"):
            if field.get("value_text"):
                text = field["value_text"]
                font = pymupdf.Font("helv")
                # Size to the box: the rendered span (ascender to
                # descender) must fit the box height, and the text
                # must fit its width; centre the span vertically.
                span = font.ascender - font.descender
                fontsize = max(6.0, min(h - 6, (h - 2) / span))
                while fontsize > 6 and font.text_length(text, fontsize) > w - 4:
                    fontsize -= 1
                baseline = y + (h - span * fontsize) / 2 + font.ascender * fontsize
                page.insert_text(
                    (x, baseline),
                    text,
                    fontsize=fontsize,
                    fontname="helv",
                )


def build_signed_pdf_multi(
    original_path: str,
    signers: list[dict],
    watermark: bool = True,
    fields: list[dict] | None = None,
    brand_name: str = "",
) -> bytes:
    """Seal a document with a certificate section per signer, four
    per landscape page in a two-by-two grid.

    Each signer dict carries `signature_png`, optional `photo_png`, and
    the metadata rendered in its section (`signer_name` — the signer
    email when no name was given — `signer_email`, `signed_at` as an
    explicit UTC timestamp, `document_id`, `session_id`, `audit_hash`,
    optional `photo_assurance`). `audit_hash` is the hash of the
    document.sealed event, the same seal the done screen and the seal
    email carry.
    Sections flow onto additional certificate pages when the grid
    fills; the header appears once, on the first certificate page.
    """
    doc = pymupdf.open(original_path)
    if fields:
        _stamp_fields(doc, fields)
    cell_w = (PAGE_WIDTH - 2 * MARGIN - CERT_GUTTER_X) / CERT_COLS
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    top = _render_header(page, brand_name)
    last_cell_bottom = top
    idx = 0
    while idx < len(signers):
        row_h = (
            CONTENT_BOTTOM - top - CERT_GUTTER_Y - CERT_FOOTER_RESERVE
        ) / CERT_ROWS
        slots = min(CERT_COLS * CERT_ROWS, len(signers) - idx)
        for slot in range(slots):
            col, row = slot % CERT_COLS, slot // CERT_COLS
            x = MARGIN + col * (cell_w + CERT_GUTTER_X)
            y = top + row * (row_h + CERT_GUTTER_Y)
            _render_signer_cell(page, signers[idx], x, y, cell_w, row_h)
            last_cell_bottom = y + row_h
            idx += 1
        if idx < len(signers):
            page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
            top = MARGIN

    footer_y = last_cell_bottom + 16
    if footer_y + 28 > CONTENT_BOTTOM:
        page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
        footer_y = MARGIN
    page.insert_text(
        (MARGIN, footer_y),
        "Verify: the audit seal above must match the hash of the",
        fontsize=9,
        color=(0.4, 0.4, 0.4),
    )
    page.insert_text(
        (MARGIN, footer_y + 14),
        "document.sealed event in the document's tamper-evident audit trail.",
        fontsize=9,
        color=(0.4, 0.4, 0.4),
    )

    if watermark:
        _apply_free_tier_watermark(doc)
    return doc.tobytes()


def build_preview_pdf(original_path: str, fields: list[dict]) -> bytes:
    """Stamp completed fields onto the original for an in-progress view.

    Used by the session-document endpoint while the document is still
    unsigned, so a later signer reviews the document as it stands with
    earlier signers' work in place (#144). No certificate pages — the
    document is not sealed yet — and no watermark; this is a review
    copy, not a sealed file.
    """
    doc = pymupdf.open(original_path)
    if fields:
        _stamp_fields(doc, fields)
    return doc.tobytes()


def build_signed_pdf(
    original_path: str,
    signature_png: bytes,
    photo_png: bytes | None,
    meta: dict,
    watermark: bool = True,
    brand_name: str = "",
) -> bytes:
    """Single-signer seal (the original entry point)."""
    signer = {
        "signature_png": signature_png,
        "photo_png": photo_png,
        **meta,
    }
    return build_signed_pdf_multi(
        original_path, [signer], watermark=watermark, brand_name=brand_name
    )
