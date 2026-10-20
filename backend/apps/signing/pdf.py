"""PDF stamping: append a signature certificate page to the signed document.

Rather than overlaying the original pages (risking covering document
text), we append a final "SIGNATURE CERTIFICATE" page carrying the
signature image, the optional witness photo, and the audit metadata. The
document hash in the audit trail covers the sealed file.

Free tier: every page carries a light diagonal "Signed with SignSeen"
watermark (lifted for premium).
"""

import pymupdf

PAGE_WIDTH, PAGE_HEIGHT = 595, 842  # A4 points
MARGIN = 72
WATERMARK_TEXT = "Signed with SignSeen"


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


def build_signed_pdf(
    original_path: str,
    signature_png: bytes,
    photo_png: bytes | None,
    meta: dict,
) -> bytes:
    doc = pymupdf.open(original_path)
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)

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
    y += 44

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
    lines = [
        f"Signer: {meta.get('signer_name') or '—'}",
        f"Signed at (UTC): {meta.get('signed_at')}",
        f"Document ID: {meta.get('document_id')}",
        f"Session ID: {meta.get('session_id')}",
        f"Audit seal: {meta.get('audit_hash')}",
    ]
    assurance = meta.get("photo_assurance")
    if assurance:
        line = f"Witness photo assurance: {assurance['assurance']}"
        if assurance["assurance"] == "reduced":
            line += f" ({assurance['reason']})"
        lines.append(line)
    for line in lines:
        page.insert_text((MARGIN, y), line, fontsize=10, fontname="helv")
        y += 18

    y += 12
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

    _apply_free_tier_watermark(doc)
    return doc.tobytes()
