"""Signing ceremony API.

Sender flow (#89: 3-step wizard):
  POST /api/documents/                       upload PDF + sender email
                                             -> draft (no sessions, no emails)
  GET / PATCH / DELETE /api/documents/<id>/  draft detail / edits / discard
  POST /api/documents/<id>/send/             review + send: sessions +
                                             signer invites, draft -> pending
  POST /api/documents/<id>/sessions/         create signing session (QR target)

Signer flow (token-addressed, no account):
  GET  /api/sessions/<token>/                session + document info
  GET  /api/sessions/<token>/document/       the PDF to review
  POST /api/sessions/<token>/sign/           submit signature (+photo) -> sealed
"""

import base64
from datetime import datetime, timezone as dt_timezone
import binascii
import hashlib
import json
import logging
import os

import pymupdf
from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import FileResponse, HttpResponse
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    parser_classes,
    permission_classes,
)
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.authentication import OptionalTokenAuthentication

from .hashing import next_event_hash, record_event, verify_chain
from .convert import ConversionError, convert_office_to_pdf, render_url_to_pdf
from .limits import (
    LimitExceeded,
    check_can_create_document,
    check_can_create_session,
    check_draft_limit,
    check_pending_limit,
    check_storage_limit,
    clean_signer_list,
    storage_limit_bytes,
    storage_used_bytes,
    wants_watermark,
)
from .notifications import (
    send_sealed_notifications,
    send_signer_copy,
    send_signer_invite,
    send_viewed_alert,
)
from .trust import assess_photo, normalize_photo
from .models import AuditEvent, Document, DocumentField, SigningSession
from .pdf import build_preview_pdf, build_signed_pdf_multi
from .serializers import (
    AuditEventSerializer,
    DocumentFieldSerializer,
    DocumentSerializer,
    SigningSessionSerializer,
)

log = logging.getLogger(__name__)

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


def _signing_mode(data) -> str | None:
    """The sender's signing-order choice (#13), set at document
    creation. Returns None for an invalid value."""
    mode = (data.get("signing_mode") or Document.SigningMode.SEQUENTIAL).strip()
    return mode if mode in Document.SigningMode.values else None


def _force_mode_for_tier(mode: str, account) -> str:
    """Sequential signing is premium (#89): a non-premium document is
    forced to parallel, whatever the client asked for."""
    is_premium = (
        account is not None
        and getattr(account, "is_authenticated", False)
        and account.is_premium
    )
    if not is_premium:
        return Document.SigningMode.PARALLEL
    return mode


def _parse_signer_list(data, sender_email, account):
    """Step-1 signer list (#89) from a create/PATCH payload. Accepts a
    JSON array or a JSON string (multipart uploads carry strings).
    Returns (cleaned_list, None) or (None, error_response)."""
    raw = data.get("signers")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            return None, _error("signers must be a JSON list")
    is_premium = (
        account is not None
        and getattr(account, "is_authenticated", False)
        and account.is_premium
    )
    try:
        return clean_signer_list(raw, sender_email, is_premium), None
    except ValueError as exc:
        return None, _error(str(exc))


def _draft_token(request) -> str:
    """The anonymous sender's draft credential (#89): an
    X-Draft-Token header, or a draft_token query parameter."""
    return (
        request.headers.get("X-Draft-Token", "")
        or request.query_params.get("draft_token", "")
    ).strip()


def _is_draft_editor(request, doc) -> bool:
    """True when the caller may edit this draft: the authenticated
    owner, or anyone holding the draft token (drafts only)."""
    if request.user.is_authenticated and doc.owner_id == request.user.pk:
        return True
    token = _draft_token(request)
    return bool(
        token
        and doc.status == Document.Status.DRAFT
        and token == doc.draft_token
    )


def _is_owner(request, doc) -> bool:
    return request.user.is_authenticated and doc.owner_id == request.user.pk


def _photo_required(data, account) -> bool:
    """The sender's witness-photo requirement (#73), set at creation.

    Premium senders only: anyone else asking for it gets the default
    (optional) — the flag is never a way to get a premium feature
    without the tier. Accepts JSON booleans and form strings alike
    (the upload intake is multipart).
    """
    raw = data.get("photo_required")
    wanted = raw is True or str(raw).strip().lower() in ("1", "true", "yes", "on")
    if not wanted:
        return False
    return (
        account is not None
        and getattr(account, "is_authenticated", False)
        and account.is_premium
    )


def _error(message: str, code=status.HTTP_400_BAD_REQUEST) -> Response:
    return Response({"error": message}, status=code)


def _utc_timestamp(dt) -> str:
    """Render an aware datetime as an explicit UTC timestamp (…Z).

    The certificate labels this value "(UTC)", so the conversion is
    pinned here rather than left to whatever the stored value's
    offset happens to be.
    """
    return dt.astimezone(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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


def _completed_field_dicts(doc):
    """Completed fields in the shape the PDF stamper takes.

    Shared by the seal step and the in-progress preview: each dict
    carries the field's type, page, normalized box, text value, and
    the image bytes for a signature/initials field.
    """
    completed = []
    for f in doc.fields.filter(completed_at__isnull=False).order_by(
        "page", "created_at"
    ):
        image_bytes = None
        if f.value_file:
            with open(f.value_file.path, "rb") as fh:
                image_bytes = fh.read()
        completed.append(
            {
                "type": f.field_type,
                "page": f.page,
                "x": f.x,
                "y": f.y,
                "width": f.width,
                "height": f.height,
                "value_text": f.value_text,
                "image_png": image_bytes,
            }
        )
    return completed


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
@authentication_classes([OptionalTokenAuthentication])
def create_document(request):
    validated = _validate_sender_fields(request.data)
    if isinstance(validated, Response):
        return validated
    title, sender_email = validated
    signing_mode = _signing_mode(request.data)
    if signing_mode is None:
        return _error("signing_mode must be 'sequential' or 'parallel'")
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

    account = request.user if request.user.is_authenticated else None
    signers, err = _parse_signer_list(request.data, sender_email, account)
    if err is not None:
        return err
    signing_mode = _force_mode_for_tier(signing_mode, account)
    try:
        check_can_create_document(account, sender_email, len(pdf_bytes))
    except LimitExceeded as exc:
        return _error(str(exc), 409)

    doc = Document.objects.create(
        title=title,
        sender_email=sender_email,
        owner=account,
        original_filename=original_filename,
        source=Document.Source.UPLOAD,
        signing_mode=signing_mode,
        photo_required=_photo_required(request.data, account),
        # Step 1 creates a draft (#89): no sessions, no emails until
        # the sender reviews and presses Send.
        status=Document.Status.DRAFT,
        signer_list=signers,
    )
    doc.original_file.save(f"document-{doc.id}.pdf", ContentFile(pdf_bytes))
    return Response(
        DocumentSerializer(doc, context={"show_draft_token": True}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@parser_classes([JSONParser, FormParser, MultiPartParser])
@authentication_classes([OptionalTokenAuthentication])
def create_document_from_url(request):
    """Web-page signing: render a URL to PDF, then it flows like any upload."""
    validated = _validate_sender_fields(request.data)
    if isinstance(validated, Response):
        return validated
    title, sender_email = validated
    signing_mode = _signing_mode(request.data)
    if signing_mode is None:
        return _error("signing_mode must be 'sequential' or 'parallel'")
    url = (request.data.get("url") or "").strip()
    if not url:
        return _error("url is required")

    account = request.user if request.user.is_authenticated else None
    signers, err = _parse_signer_list(request.data, sender_email, account)
    if err is not None:
        return err
    signing_mode = _force_mode_for_tier(signing_mode, account)
    try:
        check_draft_limit(account, sender_email)
    except LimitExceeded as exc:
        return _error(str(exc), 409)

    try:
        pdf_bytes = render_url_to_pdf(url)
    except ConversionError as exc:
        return _error(str(exc))

    try:
        check_storage_limit(account, sender_email, len(pdf_bytes))
    except LimitExceeded as exc:
        return _error(str(exc), 409)

    doc = Document.objects.create(
        title=title,
        sender_email=sender_email,
        owner=account,
        original_filename="",
        source=Document.Source.URL,
        source_url=url,
        signing_mode=signing_mode,
        photo_required=_photo_required(request.data, account),
        status=Document.Status.DRAFT,
        signer_list=signers,
    )
    doc.original_file.save(f"document-{doc.id}.pdf", ContentFile(pdf_bytes))
    return Response(
        DocumentSerializer(doc, context={"show_draft_token": True}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_documents(request):
    """Sender dashboard: this account's documents + storage usage.

    Documents the account sent (owned), plus documents the account *signed*
    as a signer — the signer enters their email at completion, and creating
    an account with that email gives them a personal archive (scope §3.10).
    """
    docs = (
        Document.objects.filter(owner=request.user)
        .prefetch_related("sessions")
        .order_by("-created_at")
    )
    signed_docs = (
        Document.objects.filter(
            sessions__signer_email__iexact=request.user.email,
            sessions__status=SigningSession.Status.SIGNED,
        )
        .exclude(owner=request.user)
        .prefetch_related("sessions")
        .distinct()
        .order_by("-created_at")
    )
    return Response(
        {
            "tier": request.user.tier,
            "is_premium": request.user.is_premium,
            "storage_used_bytes": storage_used_bytes(request.user, ""),
            "storage_limit_bytes": storage_limit_bytes(request.user),
            # The request context is what lets the serializer expose
            # each owned document's signing_url (owner-only; the
            # signed_documents below belong to other senders and
            # serialize with signing_url=None).
            "documents": DocumentSerializer(
                docs, many=True, context={"request": request}
            ).data,
            "signed_documents": DocumentSerializer(
                signed_docs, many=True, context={"request": request}
            ).data,
        }
    )


@api_view(["GET", "PATCH", "DELETE"])
@parser_classes([JSONParser, FormParser, MultiPartParser])
@authentication_classes([OptionalTokenAuthentication])
def document_detail(request, doc_id):
    """Document detail: public tracking view (GET), draft edits
    (PATCH), draft discard (DELETE).

    GET is the public tracking view: anonymous and stale-token
    requesters get the public fields only. An authenticated owner
    additionally gets the document's signing_url (the active session's
    link, or None) so the tracking page can offer the same
    copy-link/QR actions as the dashboard; for everyone else the
    field is omitted entirely. The draft token is exposed only to
    the owner or a caller presenting it.

    PATCH is draft-only (#89) and restricted to the sender: the
    authenticated owner, or anyone holding the draft token. DELETE
    removes the document and its files at any status: drafts via the
    same draft-editor path, sent/signed/expired documents via the
    authenticated owner only.
    """
    doc = get_object_or_404(Document, pk=doc_id)
    show_token = _is_owner(request, doc) or (
        bool(_draft_token(request))
        and doc.status == Document.Status.DRAFT
        and _draft_token(request) == doc.draft_token
    )
    if request.method == "GET":
        data = DocumentSerializer(
            doc,
            context={"request": request, "show_draft_token": show_token},
        ).data
        if not _is_owner(request, doc):
            data.pop("signing_url", None)
        return Response(data)

    if request.method == "DELETE":
        # Delete the document and its files, whatever its status.
        # Drafts keep the existing discard path (the authenticated
        # owner, or anyone holding the draft token); a sent, signed,
        # or expired document can be deleted only by its
        # authenticated owner. Sessions, fields, and audit events go
        # with the row through their cascade deletes.
        is_draft_discard = _is_draft_editor(
            request, doc
        ) and doc.status == Document.Status.DRAFT
        if not is_draft_discard and not _is_owner(request, doc):
            return _error("only the sender can delete this document", 403)
        if doc.original_file:
            doc.original_file.delete(save=False)
        if doc.signed_file:
            doc.signed_file.delete(save=False)
        doc.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    if not _is_draft_editor(request, doc):
        return _error("only the sender can change this draft", 403)
    if doc.status != Document.Status.DRAFT:
        return _error("only a draft can be changed", 409)

    # PATCH: title, signing mode, photo flag, signer list.
    account = request.user if request.user.is_authenticated else None
    if "title" in request.data:
        title = (request.data.get("title") or "").strip()
        if not title:
            return _error("title is required")
        doc.title = title
    if "signing_mode" in request.data:
        mode = _signing_mode(request.data)
        if mode is None:
            return _error("signing_mode must be 'sequential' or 'parallel'")
        doc.signing_mode = _force_mode_for_tier(mode, account)
    if "photo_required" in request.data:
        doc.photo_required = _photo_required(request.data, account)
    if "signers" in request.data:
        signers, err = _parse_signer_list(
            request.data, doc.sender_email, account
        )
        if err is not None:
            return err
        # A signer with placed fields cannot be removed out from
        # under them: the sender deletes those fields first.
        max_ref = max(
            (f.signer_index for f in doc.fields.all()), default=-1
        )
        if max_ref >= len(signers):
            return _error(
                "fields are assigned to a signer that would be removed — "
                "delete those fields first"
            )
        doc.signer_list = signers
    doc.save()
    return Response(
        DocumentSerializer(
            doc, context={"request": request, "show_draft_token": True}
        ).data
    )


@api_view(["POST"])
@parser_classes([JSONParser, FormParser, MultiPartParser])
@authentication_classes([OptionalTokenAuthentication])
def send_document(request, doc_id):
    """Step 3 Send (#89): turn a draft into a pending document.

    Creates one session per signer in list order, links the placed
    fields to their sessions, flips the draft to PENDING, and emails
    each signer their link + the document. Nothing is emailed before
    this call — that is the point of the draft flow. The free tier's
    1-pending-document limit is enforced here, at send time.
    """
    doc = get_object_or_404(Document, pk=doc_id)
    if not _is_draft_editor(request, doc):
        return _error("only the sender can send this draft", 403)
    if doc.status != Document.Status.DRAFT:
        return _error("only a draft can be sent", 409)
    account = request.user if request.user.is_authenticated else None
    is_premium = (
        account is not None
        and getattr(account, "is_authenticated", False)
        and account.is_premium
    )
    try:
        signers = clean_signer_list(doc.signer_list, doc.sender_email, is_premium)
    except ValueError as exc:
        return _error(str(exc))
    # Sequential mode: the sender countersigns last.
    if doc.signing_mode == Document.SigningMode.SEQUENTIAL:
        sender = doc.sender_email.strip().lower()
        signers = sorted(
            signers, key=lambda s: s["email"].lower() == sender
        )
    max_ref = max((f.signer_index for f in doc.fields.all()), default=-1)
    if max_ref >= len(signers):
        return _error(
            "some fields are assigned to a signer that was removed — "
            "delete those fields or add the signer back"
        )
    try:
        check_pending_limit(account, doc.sender_email)
    except LimitExceeded as exc:
        return _error(str(exc), 409)

    with transaction.atomic():
        sessions = []
        for order, signer in enumerate(signers):
            session = SigningSession.objects.create(
                document=doc,
                signer_name=signer["name"],
                signer_email=signer["email"],
                order=order,
            )
            record_event(
                session,
                "session.created",
                {
                    "document_id": str(doc.id),
                    "signer_name": session.signer_name,
                    "signer_email": session.signer_email,
                    "order": session.order,
                },
            )
            sessions.append(session)
        # Link placed fields to the session for their signer slot.
        for field in doc.fields.all():
            field.session = sessions[field.signer_index]
            field.save(update_fields=["session"])
        doc.signer_list = signers
        doc.status = Document.Status.PENDING
        doc.save(update_fields=["signer_list", "status", "updated_at"])

    # Email delivery (#13): a pre-defined signer whose session is
    # already active (first in sequence, or any signer in parallel
    # mode) gets their signing link by email. Later sequential
    # signers are invited when their predecessor signs.
    for session in sessions:
        if session.is_usable():
            try:
                send_signer_invite(doc, session)
            except Exception:
                log.exception("signer-invite email failed")
    return Response(
        {
            "document": DocumentSerializer(
                doc,
                context={"request": request, "show_draft_token": True},
            ).data,
            "sessions": SigningSessionSerializer(sessions, many=True).data,
        },
        status=status.HTTP_201_CREATED,
    )


# ---------------------------------------------------------------------------
# Complex documents (#13): field placement + page rendering.
#
# Placement is owner-only for sent documents; drafts accept the draft
# token instead (#89). Signers interact with their assigned fields
# through the token-addressed ceremony endpoints instead.
# ---------------------------------------------------------------------------


def _page_count(doc) -> int:
    with pymupdf.open(doc.original_file.path) as pdf:
        return pdf.page_count


def _render_page_png(doc, page_number: int) -> bytes | None:
    """Render one page of the original PDF to PNG (2x for legibility).
    Returns None when the page is out of range."""
    with pymupdf.open(doc.original_file.path) as pdf:
        if page_number < 1 or page_number > pdf.page_count:
            return None
        pixmap = pdf[page_number - 1].get_pixmap(matrix=pymupdf.Matrix(2, 2))
        return pixmap.tobytes("png")


def _field_document(request, doc_id):
    """(document, None) for a caller allowed to manage this document's
    fields, else (None, error response).

    Placement is owner-only for sent documents — and draft-token-only
    for drafts (#89): the anonymous sender who holds the draft token
    places fields on their own draft; the owner uses their account.
    """
    doc = get_object_or_404(Document, pk=doc_id)
    if request.user.is_authenticated and doc.owner_id == request.user.pk:
        return doc, None
    token = _draft_token(request)
    if (
        token
        and doc.status == Document.Status.DRAFT
        and token == doc.draft_token
    ):
        return doc, None
    if not request.user.is_authenticated and not token:
        return None, _error("authentication required", 401)
    return None, _error("only the document owner can manage fields", 403)


# Drawn-box size limits (normalized fractions of the page size, #78).
# Mirrored in frontend/lib/fieldBox.ts, which validates before submit;
# the server is authoritative.
MIN_FIELD_WIDTH = 0.02
MIN_FIELD_HEIGHT = 0.01


@api_view(["GET", "POST"])
@authentication_classes([OptionalTokenAuthentication])
def document_fields(request, doc_id):
    doc, err = _field_document(request, doc_id)
    if err is not None:
        return err
    if request.method == "GET":
        return Response(
            {
                "page_count": _page_count(doc),
                "fields": DocumentFieldSerializer(
                    doc.fields.all(), many=True
                ).data,
            }
        )

    if doc.status not in (Document.Status.DRAFT, Document.Status.PENDING):
        return _error("fields can only be placed on a draft or pending document", 409)
    # Drafts have no sessions yet (#89): fields are assigned to a
    # signer slot (position in the draft's signer list) and linked to
    # the session for that slot at send time. Sent documents keep
    # the session assignment from before.
    session = None
    signer_index = 0
    if doc.status == Document.Status.DRAFT:
        raw_index = request.data.get("signer_index")
        if isinstance(raw_index, bool) or not isinstance(raw_index, int):
            return _error("signer_index must be an integer")
        if raw_index < 0 or raw_index >= len(doc.signer_list):
            return _error("signer_index is out of range for this draft")
        signer_index = raw_index
    else:
        session_id = str(request.data.get("session_id") or "")
        session = next(
            (s for s in doc.sessions.all() if str(s.id) == session_id), None
        )
        if session is None:
            return _error("session_id must be one of the document's sessions")
        signer_index = session.order
    field_type = (request.data.get("type") or "").strip()
    if field_type not in DocumentField.Type.values:
        return _error(
            "type must be one of: " + ", ".join(DocumentField.Type.values)
        )
    page = request.data.get("page")
    if isinstance(page, bool) or not isinstance(page, int):
        return _error("page must be an integer")
    if page < 1 or page > _page_count(doc):
        return _error("page is out of range for this document")
    try:
        x = float(request.data.get("x"))
        y = float(request.data.get("y"))
    except (TypeError, ValueError):
        return _error("x and y must be numbers between 0 and 1")
    if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
        return _error("x and y must be between 0 and 1")
    # A drawn box carries both dimensions; a click carries neither
    # and the field renders at the fixed per-type size.
    width = height = None
    if request.data.get("width") is not None or request.data.get("height") is not None:
        try:
            width = float(request.data.get("width"))
            height = float(request.data.get("height"))
        except (TypeError, ValueError):
            return _error("width and height must both be numbers")
        if width > 1.0 or height > 1.0:
            return _error("width and height must be at most 1")
        if width < MIN_FIELD_WIDTH or height < MIN_FIELD_HEIGHT:
            return _error(
                "the box is too small — width must be at least "
                f"{MIN_FIELD_WIDTH} and height at least {MIN_FIELD_HEIGHT}"
            )
        if x + width > 1.0 or y + height > 1.0:
            return _error("the box must fit inside the page")
    required = request.data.get("required", True)
    if not isinstance(required, bool):
        return _error("required must be true or false")

    field = DocumentField.objects.create(
        document=doc,
        session=session,
        signer_index=signer_index,
        field_type=field_type,
        page=page,
        x=x,
        y=y,
        width=width,
        height=height,
        required=required,
    )
    return Response(DocumentFieldSerializer(field).data, status=201)


@api_view(["PATCH", "DELETE"])
@authentication_classes([OptionalTokenAuthentication])
def document_field_detail(request, doc_id, field_id):
    doc, err = _field_document(request, doc_id)
    if err is not None:
        return err
    field = get_object_or_404(DocumentField, pk=field_id, document=doc)
    if doc.status not in (Document.Status.DRAFT, Document.Status.PENDING):
        return _error("fields can only change on a draft or pending document", 409)
    if request.method == "DELETE":
        if field.is_completed:
            return _error("a completed field cannot be deleted", 409)
        field.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # PATCH: move the field to a new position on the same page.
    # Only x/y change; type, assignment and size stay as placed.
    if field.is_completed:
        return _error("a completed field cannot be moved", 409)
    try:
        x = float(request.data.get("x"))
        y = float(request.data.get("y"))
    except (TypeError, ValueError):
        return _error("x and y must be numbers between 0 and 1")
    if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
        return _error("x and y must be between 0 and 1")
    if field.width is not None and field.height is not None:
        if x + field.width > 1.0 or y + field.height > 1.0:
            return _error("the box must fit inside the page")
    field.x = x
    field.y = y
    field.save(update_fields=["x", "y"])
    return Response(DocumentFieldSerializer(field).data)


@api_view(["GET"])
@authentication_classes([OptionalTokenAuthentication])
def document_page_png(request, doc_id, page):
    """One rendered page for the placement UI (owner or draft-token holder)."""
    doc, err = _field_document(request, doc_id)
    if err is not None:
        return err
    png = _render_page_png(doc, page)
    if png is None:
        return _error("page is out of range for this document", 404)
    return HttpResponse(png, content_type="image/png")


@api_view(["GET"])
@authentication_classes([])
def session_page_png(request, token, page):
    """One rendered page for the ceremony's field view. Possession of
    the token is the auth, and the page is served only while the
    session is usable or already signed."""
    session = get_object_or_404(SigningSession, token=token)
    if not session.is_usable() and session.status != SigningSession.Status.SIGNED:
        return _error("session is no longer available", 410)
    png = _render_page_png(session.document, page)
    if png is None:
        return _error("page is out of range for this document", 404)
    return HttpResponse(png, content_type="image/png")


@api_view(["GET"])
@authentication_classes([])
def session_field_image(request, token, field_id):
    """A completed signature/initials field's stored image, for the
    ceremony's read-only view of earlier signers' completed fields
    (#105). Possession of the token is the auth, and the image is
    served only while the session is usable or already signed. The
    field must belong to the session's document and be completed —
    anything else is a 404, so no field (or document) existence
    leaks across sessions."""
    session = get_object_or_404(SigningSession, token=token)
    if not session.is_usable() and session.status != SigningSession.Status.SIGNED:
        return _error("session is no longer available", 410)
    field = get_object_or_404(
        DocumentField, pk=field_id, document=session.document
    )
    if not field.is_completed or not field.value_file:
        return _error("field has no stored image", 404)
    with open(field.value_file.path, "rb") as fh:
        return HttpResponse(fh.read(), content_type="image/png")


@api_view(["POST"])
@parser_classes([JSONParser, FormParser, MultiPartParser])
@authentication_classes([OptionalTokenAuthentication])
def create_session(request, doc_id):
    doc = get_object_or_404(Document, pk=doc_id)
    if doc.status != Document.Status.PENDING:
        return _error("document is no longer pending signature", 409)
    # Email-first delivery: the signer is always emailed their
    # signing link and the document, so a session cannot exist
    # without an address to send it to.
    signer_email = (request.data.get("signer_email") or "").strip()
    if not signer_email:
        return _error(
            "signer_email is required — the signer is emailed their "
            "signing link and the document to sign"
        )
    try:
        check_can_create_session(doc, signer_email)
    except LimitExceeded as exc:
        return _error(str(exc), 409)

    session = SigningSession.objects.create(
        document=doc,
        signer_name=(request.data.get("signer_name") or "").strip(),
        signer_email=signer_email,
        order=doc.sessions.count(),
    )
    record_event(
        session,
        "session.created",
        {
            "document_id": str(doc.id),
            "signer_name": session.signer_name,
            "signer_email": session.signer_email,
            "order": session.order,
        },
    )
    # Email delivery (#13): a pre-defined signer whose session is
    # already active (first in sequence, or any signer in parallel
    # mode) gets their signing link by email. Later sequential
    # signers are invited when their predecessor signs.
    if session.is_usable():
        try:
            send_signer_invite(doc, session)
        except Exception:
            log.exception("signer-invite email failed")
    return Response(SigningSessionSerializer(session).data, status=201)


@api_view(["GET"])
@authentication_classes([])
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


def _prepare_field_values(session, raw_values):
    """Validate a submit's `field_values` against this session's fields.

    Returns (prepared, error_response): prepared items carry the field,
    the decoded image bytes (signature/initials) or the stored text
    (checkbox "true"/"false", text, date). A signer can only complete
    their own fields; a submit missing any of this session's REQUIRED
    fields is an error. Everything is validated/decoded here, before
    any writes, so a bad submit changes nothing.

    A signed-date field is filled by the server, not the signer: any
    client-supplied value for one is ignored, and the field is
    completed with the submit date (UTC, YYYY-MM-DD). A required
    signed-date field is therefore never missing.
    """
    if raw_values is None:
        raw_values = []
    if not isinstance(raw_values, list):
        return None, _error("field_values must be a list")
    session_fields = {str(f.id): f for f in session.fields.all()}
    prepared = {}
    for entry in raw_values:
        if not isinstance(entry, dict):
            return None, _error("field_values entries must be objects")
        field = session_fields.get(str(entry.get("field_id") or ""))
        if field is None:
            return None, _error(
                "field_values contains a field that is not assigned to this signer"
            )
        if field.field_type == DocumentField.Type.SIGNED_DATE:
            continue  # server-filled at submit; the signer cannot edit it
        value = entry.get("value")
        item = {"field": field, "image_bytes": None, "text": "", "checked": None}
        if field.field_type in (
            DocumentField.Type.SIGNATURE,
            DocumentField.Type.INITIALS,
        ):
            try:
                item["image_bytes"] = _decode_data_url(value, field.field_type)
            except ValueError as exc:
                return None, _error(str(exc))
        elif field.field_type == DocumentField.Type.CHECKBOX:
            if not isinstance(value, bool):
                return None, _error("checkbox field value must be true or false")
            item["checked"] = value
            item["text"] = "true" if value else "false"
        elif field.field_type == DocumentField.Type.DATE:
            text = value.strip() if isinstance(value, str) else ""
            try:
                datetime.strptime(text, "%Y-%m-%d")
            except ValueError:
                return None, _error("date field value must be YYYY-MM-DD")
            item["text"] = text
        else:  # text
            text = value.strip() if isinstance(value, str) else ""
            if not text:
                continue  # an empty text entry completes nothing
            item["text"] = text
        prepared[field.id] = item

    # Signed-date fields complete themselves: the server records the
    # date this signature was submitted, whatever the client sent.
    submit_date = timezone.now().date().isoformat()
    for field in session_fields.values():
        if field.field_type != DocumentField.Type.SIGNED_DATE:
            continue
        prepared[field.id] = {
            "field": field,
            "image_bytes": None,
            "text": submit_date,
            "checked": None,
        }

    missing = []
    for field in session_fields.values():
        if not field.required:
            continue
        item = prepared.get(field.id)
        if item is None or (
            field.field_type == DocumentField.Type.CHECKBOX
            and item["checked"] is not True
        ):
            missing.append(field)
    if missing:
        labels = ", ".join(
            f"{f.field_type} (page {f.page})" for f in missing
        )
        return None, _error(f"missing required fields: {labels}")
    return list(prepared.values()), None


# ---------------------------------------------------------------------------
# Signer endpoints (token-addressed, no account)
# ---------------------------------------------------------------------------


@api_view(["GET"])
@authentication_classes([])
def get_session(request, token):
    session = get_object_or_404(SigningSession, token=token)
    if session.is_usable() and session.viewed_at is None:
        # First view of a live pending session (signing.viewed alert):
        # stamp it and add the audit event for every session; the email
        # itself is premium + opt-in gated inside the notification
        # helper. Best-effort — alerting must never fail the view.
        session.viewed_at = timezone.now()
        session.save(update_fields=["viewed_at"])
        record_event(
            session,
            "signing.viewed",
            {
                "document_id": str(session.document_id),
                "viewed_at": session.viewed_at.isoformat(),
            },
        )
        try:
            send_viewed_alert(session.document, session)
        except Exception:
            log.exception("viewed-alert email failed")
    return Response(SigningSessionSerializer(session).data)


@api_view(["GET"])
@authentication_classes([])
def session_document(request, token):
    """Serve the PDF under review. Possession of the token is the auth."""
    session = get_object_or_404(SigningSession, token=token)
    if not session.is_usable() and session.status != SigningSession.Status.SIGNED:
        return _error("session is no longer available", 410)
    if session.document.signed_file:
        path = session.document.signed_file.path
        return FileResponse(open(path, "rb"), content_type="application/pdf")
    completed = _completed_field_dicts(session.document)
    if completed:
        # In progress: stamp what earlier signers completed onto the
        # original, so a later signer reviews the document as it
        # stands (#144) — no certificate pages until the seal.
        preview = build_preview_pdf(
            session.document.original_file.path, completed
        )
        return HttpResponse(preview, content_type="application/pdf")
    path = session.document.original_file.path
    return FileResponse(open(path, "rb"), content_type="application/pdf")


@api_view(["POST"])
@parser_classes([JSONParser])
@authentication_classes([])
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
    # Sender option (#73): when the document requires a witness photo,
    # a submission without one is rejected here — client gating alone
    # is not enforcement, and a bypassed client must not seal.
    if session.document.photo_required and not photo_png:
        return _error("a witness photo is required to complete this signing")
    device_info = request.data.get("device_info") or {}
    if not isinstance(device_info, dict):
        return _error("device_info must be an object")
    signer_email = (request.data.get("signer_email") or "").strip()
    prepared_fields, field_error = _prepare_field_values(
        session, request.data.get("field_values")
    )
    if field_error is not None:
        return field_error

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

        # Field completions (#13): persist values and extend this
        # session's hash chain with one event per completed field.
        for item in prepared_fields:
            field = item["field"]
            if item["image_bytes"] is not None:
                field.value_file.save(
                    f"{field.id}.png",
                    ContentFile(item["image_bytes"]),
                    save=False,
                )
            field.value_text = item["text"]
            field.completed_at = timezone.now()
            field.save(
                update_fields=["value_text", "value_file", "completed_at"]
            )
            payload = {
                "field_id": str(field.id),
                "field_type": field.field_type,
                "page": field.page,
                "session_id": session_id,
                "signer_name": session.signer_name,
            }
            if item["image_bytes"] is not None:
                payload["value_sha256"] = _sha256(item["image_bytes"])
                payload["value_file"] = field.value_file.name
            elif item["checked"] is not None:
                payload["value"] = item["checked"]
            else:
                payload["value"] = item["text"]
            record_event(session, "field.completed", payload)

        # This signer's ceremony is complete. The signed time is the
        # signature.submitted audit event's timestamp — the same instant
        # the certificate reports — not a second clock read.
        session.status = SigningSession.Status.SIGNED
        session.signed_at = submitted.created_at
        if signer_email:
            session.signer_email = signer_email
        session.save(
            update_fields=["status", "signed_at", "signer_email", "device_evidence"]
        )

        # The document seals only when EVERY session has signed
        # (multi-signer, strictly sequential). Until then it stays
        # pending with no signed file, so nothing partially signed can
        # be downloaded as final.
        all_sessions = list(doc.sessions.order_by("order", "created_at"))
        document_final = all(
            s.status == SigningSession.Status.SIGNED for s in all_sessions
        ) and not doc.fields.filter(
            required=True, completed_at__isnull=True
        ).exists()
        sealed = None
        if document_final:
            # The certificate prints the audit seal of the
            # document.sealed event, so the seal has to be known
            # before the PDF is built. A sealed event's hash covers
            # its payload, and the payload used to carry the sealed
            # file's hash — but that hash only exists once the PDF
            # (with the seal in it) exists. The file hash therefore
            # moves to a follow-up event recorded right after the
            # seal, and the sealed event itself carries only the
            # document and the submission it seals. The hash is
            # fully determined by the chain tip, the payload, and
            # the timestamp, so it is computed here and the event
            # is recorded with the same values below.
            seal_timestamp = timezone.now()
            seal_payload = {
                "document_id": str(doc.id),
                "seal_event": str(submitted.id),
            }
            _, seal_hash = next_event_hash(
                session, "document.sealed", seal_payload, seal_timestamp
            )
            signers = []
            for s in all_sessions:
                event = s.events.filter(event_type="signature.submitted").first()
                payload = event.payload
                with open(
                    os.path.join(settings.MEDIA_ROOT, payload["signature_file"]),
                    "rb",
                ) as f:
                    sig_bytes = f.read()
                photo_bytes = None
                if payload.get("photo_file"):
                    with open(
                        os.path.join(settings.MEDIA_ROOT, payload["photo_file"]),
                        "rb",
                    ) as f:
                        photo_bytes = f.read()
                signers.append(
                    {
                        "signature_png": sig_bytes,
                        "photo_png": photo_bytes,
                        # The signer name is optional at send time;
                        # the signer email is always known (email-first
                        # delivery), so it identifies the signer when
                        # no name was given.
                        "signer_name": s.signer_name or s.signer_email,
                        "signed_at": _utc_timestamp(event.created_at),
                        "document_id": str(doc.id),
                        "session_id": str(s.id),
                        "audit_hash": seal_hash,
                        "photo_assurance": payload.get("photo_assurance"),
                    }
                )
            # Completed fields stamp onto their pages before the
            # certificate pages are appended (#13).
            completed_fields = _completed_field_dicts(doc)
            # Premium documents skip the free-tier watermark.
            signed_bytes = build_signed_pdf_multi(
                doc.original_file.path,
                signers,
                watermark=wants_watermark(doc),
                fields=completed_fields,
                brand_name=(doc.owner.brand_name or "") if doc.owner else "",
            )
            doc.signed_file.save(f"signed-{doc.id}.pdf", ContentFile(signed_bytes))
            doc.status = Document.Status.SIGNED
            doc.save(update_fields=["signed_file", "status", "updated_at"])
            sealed = record_event(
                session,
                "document.sealed",
                seal_payload,
                timestamp=seal_timestamp,
            )
            if sealed.hash != seal_hash:
                # The chain moved between the preview and the record;
                # the certificate already prints seal_hash, so a
                # mismatch must fail loudly instead of shipping a
                # seal that does not match the trail.
                raise RuntimeError("sealed event hash changed before record")
            # The sealed file's hash can only be known now that the
            # file exists; it is chained right after the seal so the
            # trail still covers the sealed file.
            record_event(
                session,
                "sealed_file.recorded",
                {
                    "document_id": str(doc.id),
                    "signed_sha256": _sha256(signed_bytes),
                },
            )

    if sealed is not None:
        # Outside the transaction: email the signed copies (best-effort;
        # a mail failure must never fail a completed signing). Fires
        # only at final seal, never for intermediate signers.
        try:
            send_sealed_notifications(doc, session, sealed.hash)
        except Exception:
            log.exception("sealed-notification email failed")
    elif doc.signing_mode == Document.SigningMode.SEQUENTIAL:
        # This signature activated the next signer in the sequence:
        # invite them if they are pre-defined with an email (#13). In
        # parallel mode everyone was invited at session creation.
        nxt = (
            doc.sessions.filter(status=SigningSession.Status.PENDING)
            .order_by("order", "created_at")
            .first()
        )
        if nxt is not None and nxt.is_usable():
            try:
                send_signer_invite(doc, nxt)
            except Exception:
                log.exception("signer-invite email failed")

    return Response(
        {
            "status": "signed",
            "document_final": document_final,
            "document": DocumentSerializer(doc).data,
            "audit_seal": sealed.hash if sealed is not None else submitted.hash,
            "chain_valid": verify_chain(session),
        }
    )


@api_view(["POST"])
@parser_classes([JSONParser])
@authentication_classes([])
def set_signer_email(request, token):
    """Completion step (scope §3.3/§3.10): after sealing, the signer may
    leave an email to receive a copy of the executed document.

    This is what links the signed document to a later account: the
    dashboard archive matches on the session's signer_email, and the
    ceremony itself never collects one. Signed sessions only — the
    address is recorded in the audit trail and the copy is emailed.
    """
    session = get_object_or_404(SigningSession, token=token)
    if session.status != SigningSession.Status.SIGNED:
        return _error("signer email can only be added after signing", 409)
    email = (request.data.get("email") or "").strip()
    try:
        validate_email(email)
    except ValidationError:
        return _error("a valid email is required")

    session.signer_email = email
    session.save(update_fields=["signer_email"])
    record_event(session, "signer.email_provided", {"signer_email": email})

    sealed = (
        session.events.filter(event_type="document.sealed")
        .order_by("-created_at")
        .first()
    )
    try:
        send_signer_copy(session.document, session, sealed.hash if sealed else "")
    except Exception:
        log.exception("signer-copy email failed")

    return Response({"status": "ok", "signer_email": email})
