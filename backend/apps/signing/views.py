"""Signing ceremony API.

Sender flow:
  POST /api/documents/                       upload PDF + sender email
  GET  /api/documents/<id>/                  document status (+ signed file)
  POST /api/documents/<id>/sessions/         create signing session (QR target)

Signer flow (token-addressed, no account):
  GET  /api/sessions/<token>/                session + document info
  GET  /api/sessions/<token>/document/       the PDF to review
  POST /api/sessions/<token>/sign/           submit signature (+photo) -> sealed
"""

import base64
import binascii
import hashlib
import os

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .hashing import record_event, verify_chain
from .convert import ConversionError, convert_office_to_pdf, render_url_to_pdf
from .trust import assess_photo, normalize_photo
from .models import AuditEvent, Document, SigningSession
from .pdf import build_signed_pdf
from .serializers import (
    AuditEventSerializer,
    DocumentSerializer,
    SigningSessionSerializer,
)

MAX_DOCUMENT_BYTES = 25 * 1024 * 1024  # 25 MB free-tier cap (scope §3.6)
MAX_IMAGE_BYTES = 5 * 1024 * 1024

UPLOAD_EXTENSIONS = {".pdf", ".doc", ".docx"}


def _validate_sender_fields(data) -> tuple[str, str] | Response:
    title = (data.get("title") or "").strip()
    sender_email = (data.get("sender_email") or "").strip()
    if not title:
        return _error("title is required")
    if not sender_email or "@" not in sender_email:
        return _error("a valid sender_email is required")
    return title, sender_email


def _error(message: str, code=status.HTTP_400_BAD_REQUEST) -> Response:
    return Response({"error": message}, status=code)


def _decode_data_url(value: str, field: str) -> bytes:
    """Decode a `data:image/<type>;base64,...` URL, with sanity checks."""
    if not isinstance(value, str) or not value.startswith("data:image/"):
        raise ValueError(f"{field} must be an image data URL")
    try:
        header, b64 = value.split(",", 1)
    except ValueError:
        raise ValueError(f"{field} is not a valid data URL")
    if "base64" not in header:
        raise ValueError(f"{field} must be base64-encoded")
    try:
        raw = base64.b64decode(b64, validate=True)
    except binascii.Error:
        raise ValueError(f"{field} is not valid base64")
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(f"{field} exceeds the 5 MB limit")
    if len(raw) == 0:
        raise ValueError(f"{field} is empty")
    return raw


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_device_info(raw: dict) -> dict:
    """v1 structured device evidence stored on the session.

    The raw client payload stays in the audit trail; this is the small,
    queryable copy. Unknown/missing fields degrade to blanks, never errors.
    """
    tz = raw.get("timezoneOffsetMinutes")
    return {
        "user_agent": str(raw.get("userAgent") or "")[:512],
        "platform": str(raw.get("platform") or "")[:128],
        "language": str(raw.get("language") or "")[:32],
        "screen": {
            "width": _safe_int(raw.get("screenWidth"), 0),
            "height": _safe_int(raw.get("screenHeight"), 0),
        },
        "timezone_offset_minutes": _safe_int(tz, None) if tz is not None else None,
    }


# ---------------------------------------------------------------------------
# Sender endpoints
# ---------------------------------------------------------------------------


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def create_document(request):
    validated = _validate_sender_fields(request.data)
    if isinstance(validated, Response):
        return validated
    title, sender_email = validated
    upload = request.data.get("file")

    if upload is None:
        return _error("file is required")
    if upload.size > MAX_DOCUMENT_BYTES:
        return _error("file exceeds the 25 MB limit")

    original_filename = upload.name or ""
    ext = os.path.splitext(original_filename)[1].lower()
    if ext not in UPLOAD_EXTENSIONS:
        return _error("file must be a PDF, DOC, or DOCX")

    try:
        if ext == ".pdf":
            pdf_bytes = upload.read()
            if pdf_bytes[:5] != b"%PDF-":
                return _error("file must be a PDF")
        else:
            pdf_bytes = convert_office_to_pdf(upload.read(), original_filename)
    except ConversionError as exc:
        return _error(str(exc))

    doc = Document.objects.create(
        title=title,
        sender_email=sender_email,
        original_filename=original_filename,
        source=Document.Source.UPLOAD,
    )
    doc.original_file.save(f"document-{doc.id}.pdf", ContentFile(pdf_bytes))
    return Response(DocumentSerializer(doc).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@parser_classes([JSONParser, FormParser, MultiPartParser])
def create_document_from_url(request):
    """Web-page signing: render a URL to PDF, then it flows like any upload."""
    validated = _validate_sender_fields(request.data)
    if isinstance(validated, Response):
        return validated
    title, sender_email = validated
    url = (request.data.get("url") or "").strip()
    if not url:
        return _error("url is required")

    try:
        pdf_bytes = render_url_to_pdf(url)
    except ConversionError as exc:
        return _error(str(exc))

    doc = Document.objects.create(
        title=title,
        sender_email=sender_email,
        original_filename="",
        source=Document.Source.URL,
        source_url=url,
    )
    doc.original_file.save(f"document-{doc.id}.pdf", ContentFile(pdf_bytes))
    return Response(DocumentSerializer(doc).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def get_document(request, doc_id):
    doc = get_object_or_404(Document, pk=doc_id)
    return Response(DocumentSerializer(doc).data)


@api_view(["POST"])
@parser_classes([JSONParser, FormParser, MultiPartParser])
def create_session(request, doc_id):
    doc = get_object_or_404(Document, pk=doc_id)
    if doc.status != Document.Status.PENDING:
        return _error("document is no longer pending signature", 409)

    session = SigningSession.objects.create(
        document=doc,
        signer_name=(request.data.get("signer_name") or "").strip(),
        signer_email=(request.data.get("signer_email") or "").strip(),
    )
    record_event(
        session,
        "session.created",
        {
            "document_id": str(doc.id),
            "signer_name": session.signer_name,
            "signer_email": session.signer_email,
        },
    )
    return Response(SigningSessionSerializer(session).data, status=201)


@api_view(["GET"])
def get_session_events(request, token):
    """Tamper-evident audit trail for a session (public, token-addressed)."""
    session = get_object_or_404(SigningSession, token=token)
    events = session.events.order_by("created_at")
    return Response(
        {
            "chain_valid": verify_chain(session),
            "events": AuditEventSerializer(events, many=True).data,
        }
    )


# ---------------------------------------------------------------------------
# Signer endpoints (token-addressed, no account)
# ---------------------------------------------------------------------------


@api_view(["GET"])
def get_session(request, token):
    session = get_object_or_404(SigningSession, token=token)
    return Response(SigningSessionSerializer(session).data)


@api_view(["GET"])
def session_document(request, token):
    """Serve the PDF under review. Possession of the token is the auth."""
    session = get_object_or_404(SigningSession, token=token)
    if not session.is_usable() and session.status != SigningSession.Status.SIGNED:
        return _error("session is no longer available", 410)
    path = session.document.signed_file.path if session.document.signed_file else session.document.original_file.path
    return FileResponse(open(path, "rb"), content_type="application/pdf")


@api_view(["POST"])
@parser_classes([JSONParser])
def submit_signature(request, token):
    session = get_object_or_404(SigningSession, token=token)
    if not session.is_usable():
        return _error("session is expired or already signed", 410)

    try:
        signature_png = _decode_data_url(request.data.get("signature", ""), "signature")
    except ValueError as exc:
        return _error(str(exc))
    photo_png = None
    photo_consent = request.data.get("photo_consent") is True
    if request.data.get("photo"):
        # A witness photo is an explicit act: the signer must have checked
        # the consent box (plain photos aren't BIPA biometric identifiers,
        # but informed consent is recorded regardless).
        if not photo_consent:
            return _error("photo_consent is required when submitting a photo")
        try:
            photo_png = _decode_data_url(request.data.get("photo"), "photo")
        except ValueError as exc:
            return _error(str(exc))
    device_info = request.data.get("device_info") or {}
    if not isinstance(device_info, dict):
        return _error("device_info must be an object")
    signer_email = (request.data.get("signer_email") or "").strip()

    doc = session.document
    with transaction.atomic():
        # Lock the session row so two concurrent submits can't both seal.
        session = SigningSession.objects.select_for_update().get(pk=session.pk)
        if not session.is_usable():
            return _error("session is expired or already signed", 410)

        sig_digest = _sha256(signature_png)
        session.device_evidence = _normalize_device_info(device_info)

        # Trust hardening: assess the witness photo's EXIF capture time
        # against the server clock (heuristic; never blocks), then
        # normalize its orientation. The digest covers the stored bytes.
        photo_assurance = None
        if photo_png:
            photo_assurance = assess_photo(
                photo_png,
                timezone.now(),
                session.device_evidence["timezone_offset_minutes"],
            )
            try:
                photo_png = normalize_photo(photo_png)
            except Exception:
                photo_assurance["assurance"] = "reduced"
                photo_assurance["reason"] = "photo_unreadable"
        photo_digest = _sha256(photo_png) if photo_png else None
        session_id = str(session.id)

        # Persist the evidence images (payload carries digests, not bytes).
        sig_name = f"sessions/{session_id}/signature.png"
        sig_path = os.path.join(settings.MEDIA_ROOT, sig_name)
        os.makedirs(os.path.dirname(sig_path), exist_ok=True)
        with open(sig_path, "wb") as f:
            f.write(signature_png)
        photo_name = None
        if photo_png:
            photo_name = f"sessions/{session_id}/photo.png"
            photo_path = os.path.join(settings.MEDIA_ROOT, photo_name)
            with open(photo_path, "wb") as f:
                f.write(photo_png)

        submitted = record_event(
            session,
            "signature.submitted",
            {
                "signature_sha256": sig_digest,
                "signature_file": sig_name,
                "photo_sha256": photo_digest,
                "photo_file": photo_name,
                "photo_consent": photo_consent,
                "photo_assurance": photo_assurance,
                "device_info": device_info,
                "signer_email": signer_email,
            },
        )

        # Seal: stamp the certificate page and store the signed PDF.
        signed_bytes = build_signed_pdf(
            doc.original_file.path,
            signature_png,
            photo_png,
            {
                "signer_name": session.signer_name,
                "signed_at": submitted.created_at.isoformat(),
                "document_id": str(doc.id),
                "session_id": session_id,
                "audit_hash": submitted.hash,
                "photo_assurance": photo_assurance,
            },
        )
        doc.signed_file.save(f"signed-{doc.id}.pdf", ContentFile(signed_bytes))
        doc.status = Document.Status.SIGNED
        doc.save(update_fields=["signed_file", "status", "updated_at"])

        session.status = SigningSession.Status.SIGNED
        if signer_email:
            session.signer_email = signer_email
        session.save(update_fields=["status", "signer_email", "device_evidence"])

        sealed = record_event(
            session,
            "document.sealed",
            {
                "document_id": str(doc.id),
                "signed_sha256": _sha256(signed_bytes),
                "seal_event": str(submitted.id),
            },
        )

    return Response(
        {
            "status": "signed",
            "document": DocumentSerializer(doc).data,
            "audit_seal": sealed.hash,
            "chain_valid": verify_chain(session),
        }
    )
