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


def _render_header(page: pymupdf.Page, brand_name: str = "") -> int:
    y = MARGIN
    page.insert_text(
        (MARGIN, y), "SIGNATURE CERTIFICATE", fontsize=22, fontname="helv"
    )
    y += 28
    # Sender branding (premium): the owner's brand takes the product
    # line's place in the header; SignSeen stays named as the platform.
    product_line = (
        f"Signed via {brand_name} with SignSeen — Signed. Seen. Sealed."
        if brand_name
        else "Signed with SignSeen — Signed. Seen. Sealed."
    )
    page.insert_text(
        (MARGIN, y),
        product_line,
        fontsize=11,
        fontname="helv",
        color=(0.35, 0.35, 0.35),
    )
    return y + 44


def build_signed_pdf_multi(
    original_path: str,
    signers: list[dict],
    watermark: bool = True,
    brand_name: str = "",
) -> bytes:
    """Seal a document with one certificate section per signer.

    Each signer dict carries `signature_png`, optional `photo_png`, and
    the metadata rendered in its section (`signer_name`, `signed_at`,
    `document_id`, `session_id`, `audit_hash`, optional
    `photo_assurance`). Sections flow onto additional certificate pages
    when they no longer fit.
    """
    doc = pymupdf.open(original_path)
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    y = _render_header(page, brand_name)

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
