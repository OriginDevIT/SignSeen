"""Public document verification (issue #74).

Anyone can upload a PDF that is supposedly signed by this system and
get a verdict: valid or invalid. Anything not valid is invalid,
including PDFs not created by SignSeen.

The verdict is decided against the stored audit trail, never against
what the file claims about itself: the certificate page is only used
to find the document / session / seal the file *claims*, and every
claim is then checked against the trail.

No storage: the upload is read into memory, checked, and the uploaded
file object is closed (which deletes the temp file Django wrote for
larger uploads) before the view returns. The file is never written to
the media volume, never logged, and no database record of the
verification is kept.
"""

import hashlib
import re

import pymupdf
from django.conf import settings
from django.core.cache import cache
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    parser_classes,
    permission_classes,
)
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .hashing import verify_chain
from .models import AuditEvent, Document, SigningSession
from .views import _utc_timestamp

MAX_VERIFY_BYTES = 15 * 1024 * 1024  # 15 MB upload cap
PDF_MAGIC = b"%PDF-"

# Verdicts for an invalid upload. The category is the whole answer:
# no internal detail (event contents, chain state, which lookup
# failed) is ever exposed.
REASON_NOT_SIGNSEEN = "not_a_signseen_document"
REASON_SEAL_MISMATCH = "seal_mismatch"
REASON_CHAIN_BROKEN = "chain_broken"
REASON_FILE_ALTERED = "file_altered"

# Abuse guards: 1 verification per minute, 7 per hour, per client IP.
# Fixed windows in the cache (the default local-memory cache: per
# process, which is the whole API on the current single-process
# deployment — a shared cache would be needed if the API ever ran
# multi-process).
RATE_LIMIT_MINUTE = 1
RATE_LIMIT_HOUR = 7

_UUID_RE = (
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
_SEAL_RE = r"[0-9a-fA-F]{64}"


def _client_ip(request) -> str:
    """Best-effort client IP for rate limiting.

    The API sits behind a reverse proxy (Caddy, plus Cloudflare in
    front of it), which sets X-Forwarded-For; direct connections fall
    back to REMOTE_ADDR.
    """
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def _rate_limited(ip: str) -> bool:
    """True when this IP has used up either verification window.

    Each attempt that reaches the checks consumes one slot in both
    windows; malformed uploads (missing / oversized / non-PDF) are
    rejected before this runs and consume nothing. Disabled entirely
    when VERIFY_RATE_LIMIT_ENABLED is off (the Playwright suite only).
    """
    if not getattr(settings, "VERIFY_RATE_LIMIT_ENABLED", True):
        return False
    for key, limit, timeout in (
        (f"verify:rl:{ip}:minute", RATE_LIMIT_MINUTE, 60),
        (f"verify:rl:{ip}:hour", RATE_LIMIT_HOUR, 3600),
    ):
        try:
            count = cache.incr(key)
        except ValueError:
            # First attempt in this window.
            cache.set(key, 1, timeout=timeout)
            count = 1
        if count > limit:
            return True
    return False


def _extract_certificate(pdf_bytes: bytes) -> list[dict] | None:
    """Pull the certificate sections out of a sealed PDF.

    Returns a list of {document_id, session_id, audit_seal} dicts —
    one per signer section — or None when the file has no SignSeen
    certificate page or no complete section. A section is complete
    only when it carries all three values; the header check keeps a
    random PDF that happens to contain matching labels from getting
    further (the trail is still the authority either way).
    """
    try:
        pdf = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        try:
            text = "".join(page.get_text() for page in pdf)
        finally:
            pdf.close()
    except Exception:
        # Unparseable as a PDF (or unreadable pages): not a genuine
        # sealed document, whatever the magic bytes claimed.
        return None
    if "SIGNATURE CERTIFICATE" not in text:
        return None

    sections: list[dict] = []
    current: dict | None = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Signer:"):
            current = {}
            sections.append(current)
        elif current is not None:
            match = re.match(rf"Document ID:\s*({_UUID_RE})\s*$", line)
            if match:
                current["document_id"] = match.group(1).lower()
                continue
            match = re.match(rf"Session ID:\s*({_UUID_RE})\s*$", line)
            if match:
                current["session_id"] = match.group(1).lower()
                continue
            match = re.match(rf"Audit seal:\s*({_SEAL_RE})\s*$", line)
            if match:
                current["audit_seal"] = match.group(1).lower()
    complete = [
        s
        for s in sections
        if {"document_id", "session_id", "audit_seal"} <= s.keys()
    ]
    return complete or None


def _invalid(reason: str) -> Response:
    return Response({"valid": False, "reason": reason})


def _error(message: str, code=status.HTTP_400_BAD_REQUEST) -> Response:
    return Response({"error": message}, status=code)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@parser_classes([MultiPartParser])
def verify_document(request):
    """Verify an uploaded PDF against the audit trail (public, no auth).

    Checks, in order: (a) parseable PDF with a SignSeen certificate
    page; (b) the claimed document / sessions exist in the trail;
    (c) the claimed seal equals the stored document.sealed event
    hash; (d) the audit chain recomputes clean; (e) the uploaded
    bytes' SHA-256 equals the sealed_file.recorded hash — i.e. the
    file is byte-identical to the sealed file.
    """
    uploaded = request.FILES.get("file")
    if uploaded is None:
        return _error("a PDF file is required")
    if uploaded.size > MAX_VERIFY_BYTES:
        return _error("file exceeds the 15 MB limit")
    # The magic bytes are the "is this a PDF" test — before any
    # parsing, and without trusting the client-sent content type.
    try:
        head = uploaded.read(5)
        uploaded.seek(0)
    except Exception:
        return _error("file must be a PDF")
    if head != PDF_MAGIC:
        return _error("file must be a PDF")

    if _rate_limited(_client_ip(request)):
        return _error(
            "too many verification attempts — try again later",
            code=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    try:
        pdf_bytes = uploaded.read()
    finally:
        # Deletes the temp file Django wrote for larger uploads;
        # in-memory uploads are unaffected. The bytes live only in
        # this request from here on.
        uploaded.close()

    file_sha256 = hashlib.sha256(pdf_bytes).hexdigest()

    # (a) Parseable PDF with a SignSeen certificate page.
    sections = _extract_certificate(pdf_bytes)
    if not sections:
        return _invalid(REASON_NOT_SIGNSEEN)
    document_ids = {s["document_id"] for s in sections}
    seals = {s["audit_seal"] for s in sections}
    if len(document_ids) != 1:
        return _invalid(REASON_NOT_SIGNSEEN)
    document_id = sections[0]["document_id"]
    if len(seals) != 1:
        # The certificate disagrees with itself about the seal.
        return _invalid(REASON_SEAL_MISMATCH)
    claimed_seal = sections[0]["audit_seal"]

    # (b) The claimed document / sessions exist in the trail.
    doc = Document.objects.filter(pk=document_id).first()
    if doc is None:
        return _invalid(REASON_NOT_SIGNSEEN)
    sessions = {}
    for section in sections:
        session = SigningSession.objects.filter(
            pk=section["session_id"], document_id=doc.id
        ).first()
        if session is None:
            return _invalid(REASON_NOT_SIGNSEEN)
        sessions[section["session_id"]] = session

    # (c) The claimed seal equals the stored document.sealed hash.
    sealed = (
        AuditEvent.objects.filter(
            session__document=doc, event_type="document.sealed"
        )
        .order_by("created_at")
        .first()
    )
    if sealed is None or claimed_seal != sealed.hash:
        return _invalid(REASON_SEAL_MISMATCH)

    # (d) The audit chain recomputes clean.
    if not verify_chain(sealed.session):
        return _invalid(REASON_CHAIN_BROKEN)

    # (e) The uploaded bytes are byte-identical to the sealed file.
    recorded = (
        AuditEvent.objects.filter(
            session=sealed.session, event_type="sealed_file.recorded"
        )
        .order_by("created_at")
        .first()
    )
    if recorded is None or recorded.payload.get("signed_sha256") != file_sha256:
        # The trail carries no sealed-file hash (a seal recorded
        # before that event existed), or the bytes differ: either way
        # byte-identity cannot be established, so fail closed.
        return _invalid(REASON_FILE_ALTERED)

    signer_emails = []
    for section in sections:
        session = sessions[section["session_id"]]
        signer_emails.append(session.signer_email or session.signer_name or "")
    return Response(
        {
            "valid": True,
            "document_title": doc.title,
            "signed_at": _utc_timestamp(sealed.created_at),
            "signer_count": len(sections),
            "signer_email": ", ".join(e for e in signer_emails if e),
        }
    )
