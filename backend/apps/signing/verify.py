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

# Abuse guards: 1 verification per minute, 20 per hour, per client IP.
# Fixed windows in the cache (the default local-memory cache: per
# process, which is the whole API on the current single-process
# deployment - a shared cache would be needed if the API ever ran
# multi-process).
RATE_LIMIT_MINUTE = 1
RATE_LIMIT_HOUR = 20

_UUID_RE = (
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
_SEAL_RE = r"[0-9a-fA-F]{64}"

# Certificate pages are appended at seal time, after the original
# pages: at most one page per four signers, plus one more when the
# "Verify" footer spills onto its own page. Extraction never needs
# to read more than this many pages, however long the document is.
MAX_CERTIFICATE_PAGES = 6


_MAX_IP_LEN = 45  # longest possible textual IP address (IPv6)


def _client_ip(request) -> str:
    """Client IP for rate limiting.

    Never trust X-Forwarded-For: proxies append the peer IP, so the
    first entry is whatever the client claimed, and a spoofed value
    buys a fresh rate-limit bucket. Cloudflare overwrites
    CF-Connecting-IP with the real client IP, so prefer it; direct
    connections fall back to the peer IP (REMOTE_ADDR). The value is
    capped at the longest possible textual IP so a forged header
    cannot make an unbounded cache key.
    """
    connecting = request.META.get("HTTP_CF_CONNECTING_IP", "").strip()
    if connecting:
        return connecting[:_MAX_IP_LEN]
    return request.META.get("REMOTE_ADDR", "")[:_MAX_IP_LEN]


def _rate_limited(ip: str) -> str | None:
    """The verification window this IP has used up, or None.

    Returns "minute" or "hour" naming the window that tripped, so the
    429 message can say which limit was hit. Each attempt that reaches
    the checks consumes one slot in both windows; malformed uploads
    (missing / oversized / non-PDF) are rejected before this runs and
    consume nothing. Disabled entirely when VERIFY_RATE_LIMIT_ENABLED
    is off (the Playwright suite only).
    """
    if not getattr(settings, "VERIFY_RATE_LIMIT_ENABLED", True):
        return None
    for key, limit, timeout, window in (
        (f"verify:rl:{ip}:minute", RATE_LIMIT_MINUTE, 60, "minute"),
        (f"verify:rl:{ip}:hour", RATE_LIMIT_HOUR, 3600, "hour"),
    ):
        try:
            count = cache.incr(key)
        except ValueError:
            # First attempt in this window.
            cache.set(key, 1, timeout=timeout)
            count = 1
        if count > limit:
            return window
    return None


def _extract_certificate(
    pdf_bytes: bytes, original_page_count: int | None = None
) -> list[dict] | None:
    """Pull the certificate sections out of a sealed PDF.

    Only the certificate pages are read: the pages after
    `original_page_count` when the seal recorded it (certificate
    pages are always appended last), otherwise the last
    MAX_CERTIFICATE_PAGES pages - a seal from before the count was
    recorded still has its certificate pages last, so the same bound
    applies. A sealed file has at most that many certificate pages
    (one per four signers, plus a footer spill), so extraction work
    is bounded no matter how long the document is: the
    whole-document scan this replaced took 10 seconds on a
    20,000-page PDF (#222).

    Returns a list of {document_id, session_id, audit_seal} dicts -
    one per signer section - or None when the scanned pages hold no
    SignSeen certificate page or no complete section. A section is
    complete only when it carries all three values; the header check
    keeps a random PDF that happens to contain matching labels from
    getting further (the trail is still the authority either way).
    """
    try:
        pdf = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        try:
            total = pdf.page_count
            if (
                isinstance(original_page_count, int)
                and original_page_count >= 0
            ):
                start = original_page_count
            else:
                start = max(0, total - MAX_CERTIFICATE_PAGES)
            end = min(total, start + MAX_CERTIFICATE_PAGES)
            if start >= total:
                return None
            text = "".join(pdf[i].get_text() for i in range(start, end))
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
    hash; (d) every session's audit chain recomputes clean; (e) the
    uploaded bytes' SHA-256 equals the sealed_file.recorded hash -
    i.e. the file is byte-identical to the sealed file.
    """
    uploaded = request.FILES.get("file")
    if uploaded is None:
        return _error("a PDF file is required")
    if uploaded.size > MAX_VERIFY_BYTES:
        return _error("file exceeds the 15 MB limit")
    # The magic bytes are the "is this a PDF" test - before any
    # parsing, and without trusting the client-sent content type.
    try:
        head = uploaded.read(5)
        uploaded.seek(0)
    except Exception:
        return _error("file must be a PDF")
    if head != PDF_MAGIC:
        return _error("file must be a PDF")

    limited_window = _rate_limited(_client_ip(request))
    if limited_window == "minute":
        return _error(
            "You can only validate one document per minute.",
            code=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    if limited_window == "hour":
        return _error(
            "You can only validate 20 documents per hour - try again later.",
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

    # (a) Parseable PDF with a SignSeen certificate page. This first
    # pass only identifies the claimed document: the most recent
    # certificate in the file is the one appended last, so the last
    # section names the claim - a file sealed twice carries two
    # certificates, and only the second one is this file's seal
    # (#222). The scoped pass below is the authoritative extraction
    # once the trail is known.
    sections = _extract_certificate(pdf_bytes)
    if not sections:
        return _invalid(REASON_NOT_SIGNSEEN)
    document_id = sections[-1]["document_id"]
    claimed_seal = sections[-1]["audit_seal"]

    # (b) The claimed document exists in the trail.
    doc = Document.objects.filter(pk=document_id).first()
    if doc is None:
        return _invalid(REASON_NOT_SIGNSEEN)

    # The claimed seal equals the stored document.sealed hash; the
    # sealed event is also the anchor for the recorded file below.
    sealed = (
        AuditEvent.objects.filter(
            session__document=doc, event_type="document.sealed"
        )
        .order_by("created_at")
        .first()
    )
    if sealed is None or claimed_seal != sealed.hash:
        return _invalid(REASON_SEAL_MISMATCH)

    # (a2) Scoped re-extraction (#222). The seal records how many
    # pages the original had, and the certificate pages sit right
    # after them - so a file sealed twice (an already-sealed PDF
    # sealed again) is read as the second seal only, never as the
    # two document IDs the whole file carries. When no count was
    # recorded (a seal from before this was stored), the first pass
    # stands: it already reads only the last certificate pages.
    recorded = (
        AuditEvent.objects.filter(
            session=sealed.session, event_type="sealed_file.recorded"
        )
        .order_by("created_at")
        .first()
    )
    page_count = recorded.payload.get("original_page_count") if recorded else None
    if isinstance(page_count, int) and page_count >= 0:
        scoped = _extract_certificate(pdf_bytes, page_count)
        if scoped is None:
            # The trail says the certificate pages sit after page N,
            # but nothing there parses as a certificate: pages were
            # inserted or removed before them after sealing.
            return _invalid(REASON_FILE_ALTERED)
        scoped_ids = {s["document_id"] for s in scoped}
        scoped_seals = {s["audit_seal"] for s in scoped}
        if scoped_ids != {document_id}:
            # The certificate at the recorded offset names a
            # different document than the identification pass found.
            return _invalid(REASON_FILE_ALTERED)
        if len(scoped_seals) != 1:
            return _invalid(REASON_SEAL_MISMATCH)
        sections = scoped
        claimed_seal = sections[0]["audit_seal"]

    # (b2) The claimed sessions exist in the trail.
    sessions = {}
    for section in sections:
        session = SigningSession.objects.filter(
            pk=section["session_id"], document_id=doc.id
        ).first()
        if session is None:
            return _invalid(REASON_NOT_SIGNSEEN)
        sessions[section["session_id"]] = session

    # (c) The scoped seal equals the stored document.sealed hash.
    if claimed_seal != sealed.hash:
        return _invalid(REASON_SEAL_MISMATCH)

    # (d) Every audit chain for the document recomputes clean (#225).
    # Only the sealing session's chain was checked before, so a
    # tampered earlier signer's chain passed verification.
    for session in doc.sessions.all():
        if not verify_chain(session):
            return _invalid(REASON_CHAIN_BROKEN)

    # (e) The uploaded bytes are byte-identical to the sealed file.
    if recorded is None or recorded.payload.get("signed_sha256") != file_sha256:
        # The trail carries no sealed-file hash (a seal recorded
        # before that event existed), or the bytes differ: either way
        # byte-identity cannot be established, so fail closed.
        return _invalid(REASON_FILE_ALTERED)

    return Response(
        {
            "valid": True,
            "document_title": doc.title,
            "signed_at": _utc_timestamp(sealed.created_at),
            "signer_count": len(sections),
        }
    )
