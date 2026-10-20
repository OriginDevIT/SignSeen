"""End-to-end tests for the signing ceremony API."""

import base64
import http.server
import io
import threading
from datetime import timedelta

import pymupdf
import pytest
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from .hashing import GENESIS_HASH, verify_chain
from .trust import assess_photo, normalize_photo
from .models import AuditEvent, Document, SigningSession

# 1x1 transparent PNG — stands in for a drawn signature / camera photo.
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
SIG_DATA_URL = "data:image/png;base64," + base64.b64encode(TINY_PNG).decode()


def make_pdf_bytes(text="Test document") -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    return doc.tobytes()


def upload_document(client, title="Contract", email="sender@example.com"):
    pdf = SimpleUploadedFile(
        "contract.pdf", make_pdf_bytes(), content_type="application/pdf"
    )
    return client.post(
        "/api/documents/",
        {"title": title, "sender_email": email, "file": pdf},
        format="multipart",
    )


@pytest.mark.django_db
def test_upload_document_creates_pending_document():
    client = APIClient()
    response = upload_document(client)
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "pending"
    assert body["title"] == "Contract"
    assert Document.objects.count() == 1


@pytest.mark.django_db
def test_upload_rejects_non_pdf():
    client = APIClient()
    fake = SimpleUploadedFile("evil.txt", b"not a pdf", content_type="text/plain")
    response = client.post(
        "/api/documents/",
        {"title": "X", "sender_email": "s@example.com", "file": fake},
        format="multipart",
    )
    assert response.status_code == 400
    assert "PDF" in response.json()["error"]


@pytest.mark.django_db
def test_upload_requires_title_and_email():
    client = APIClient()
    pdf = SimpleUploadedFile("c.pdf", make_pdf_bytes(), content_type="application/pdf")
    response = client.post("/api/documents/", {"file": pdf}, format="multipart")
    assert response.status_code == 400


@pytest.mark.django_db
def test_create_session_returns_token_and_signing_url():
    client = APIClient()
    doc_id = upload_document(client).json()["id"]
    response = client.post(
        f"/api/documents/{doc_id}/sessions/",
        {"signer_name": "Jane", "signer_email": "jane@example.com"},
        format="json",
    )
    assert response.status_code == 201
    body = response.json()
    assert body["token"]
    assert body["signing_url"].endswith(f"/s/{body['token']}")
    assert body["usable"] is True
    # session.created is the genesis event of the chain
    event = AuditEvent.objects.get(session_id=body["id"])
    assert event.event_type == "session.created"
    assert event.prev_hash == GENESIS_HASH


@pytest.mark.django_db
def test_full_ceremony_signs_seals_and_verifies():
    client = APIClient()
    doc_id = upload_document(client).json()["id"]
    token = client.post(
        f"/api/documents/{doc_id}/sessions/", {"signer_name": "Jane"}, format="json"
    ).json()["token"]

    response = client.post(
        f"/api/sessions/{token}/sign/",
        {
            "signature": SIG_DATA_URL,
            "photo": SIG_DATA_URL,
            "photo_consent": True,
            "device_info": {"ua": "test", "platform": "test"},
        },
        format="json",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "signed"
    assert body["chain_valid"] is True
    assert body["document"]["status"] == "signed"
    assert body["document"]["signed_file"]

    doc = Document.objects.get(pk=doc_id)
    assert doc.signed_file
    # Sealed PDF is a real PDF, larger than the original (certificate page).
    assert doc.signed_file.size > len(make_pdf_bytes())

    session = SigningSession.objects.get(token=token)
    assert session.status == "signed"
    types = [e.event_type for e in session.events.order_by("created_at")]
    assert types == ["session.created", "signature.submitted", "document.sealed"]
    assert verify_chain(session) is True


@pytest.mark.django_db
def test_double_sign_is_rejected():
    client = APIClient()
    doc_id = upload_document(client).json()["id"]
    token = client.post(
        f"/api/documents/{doc_id}/sessions/", {}, format="json"
    ).json()["token"]
    payload = {"signature": SIG_DATA_URL}
    assert client.post(f"/api/sessions/{token}/sign/", payload, format="json").status_code == 200
    second = client.post(f"/api/sessions/{token}/sign/", payload, format="json")
    assert second.status_code == 410


@pytest.mark.django_db
def test_expired_session_cannot_sign():
    client = APIClient()
    doc_id = upload_document(client).json()["id"]
    token = client.post(
        f"/api/documents/{doc_id}/sessions/", {}, format="json"
    ).json()["token"]
    session = SigningSession.objects.get(token=token)
    session.expires_at = timezone.now() - timedelta(seconds=1)
    session.save()

    response = client.post(
        f"/api/sessions/{token}/sign/", {"signature": SIG_DATA_URL}, format="json"
    )
    assert response.status_code == 410


@pytest.mark.django_db
def test_tampered_chain_is_detected():
    client = APIClient()
    doc_id = upload_document(client).json()["id"]
    token = client.post(
        f"/api/documents/{doc_id}/sessions/", {}, format="json"
    ).json()["token"]
    client.post(
        f"/api/sessions/{token}/sign/", {"signature": SIG_DATA_URL}, format="json"
    )
    session = SigningSession.objects.get(token=token)
    assert verify_chain(session) is True

    # Attacker rewrites a payload in place.
    event = session.events.order_by("created_at").first()
    event.payload = {"tampered": True}
    event.save()

    assert verify_chain(session) is False
    # The public audit endpoint reports it too.
    events_resp = client.get(f"/api/sessions/{token}/events/")
    assert events_resp.json()["chain_valid"] is False


@pytest.mark.django_db
def test_sign_requires_a_signature_image():
    client = APIClient()
    doc_id = upload_document(client).json()["id"]
    token = client.post(
        f"/api/documents/{doc_id}/sessions/", {}, format="json"
    ).json()["token"]
    response = client.post(f"/api/sessions/{token}/sign/", {}, format="json")
    assert response.status_code == 400


@pytest.mark.django_db
def test_sign_captures_signer_email():
    client = APIClient()
    doc_id = upload_document(client).json()["id"]
    token = client.post(
        f"/api/documents/{doc_id}/sessions/", {}, format="json"
    ).json()["token"]
    response = client.post(
        f"/api/sessions/{token}/sign/",
        {"signature": SIG_DATA_URL, "signer_email": "jane@example.com"},
        format="json",
    )
    assert response.status_code == 200
    session = SigningSession.objects.get(token=token)
    assert session.signer_email == "jane@example.com"


@pytest.mark.django_db
def test_session_document_serves_pdf_to_token_holder():
    client = APIClient()
    doc_id = upload_document(client).json()["id"]
    token = client.post(
        f"/api/documents/{doc_id}/sessions/", {}, format="json"
    ).json()["token"]
    response = client.get(f"/api/sessions/{token}/document/")
    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"


def make_docx_bytes(text="Test Agreement") -> bytes:
    from docx import Document as DocxDocument

    doc = DocxDocument()
    doc.add_heading("Test Agreement", 1)
    doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@pytest.mark.django_db
def test_docx_upload_converts_to_pdf():
    client = APIClient()
    upload = SimpleUploadedFile(
        "agreement.docx",
        make_docx_bytes(),
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    response = client.post(
        "/api/documents/",
        {"title": "Agreement", "sender_email": "s@example.com", "file": upload},
        format="multipart",
    )
    assert response.status_code == 201
    body = response.json()
    assert body["source"] == "upload"
    assert body["original_filename"] == "agreement.docx"

    doc = Document.objects.get(pk=body["id"])
    with open(doc.original_file.path, "rb") as f:
        assert f.read(5) == b"%PDF-"


@pytest.mark.django_db
def test_upload_rejects_unsupported_extension():
    client = APIClient()
    upload = SimpleUploadedFile("notes.txt", b"hello", content_type="text/plain")
    response = client.post(
        "/api/documents/",
        {"title": "X", "sender_email": "s@example.com", "file": upload},
        format="multipart",
    )
    assert response.status_code == 400
    assert "PDF, DOC, or DOCX" in response.json()["error"]


@pytest.mark.django_db
def test_from_url_renders_page_to_pdf():
    """Real end-to-end: a local HTTP server stands in for the web page."""
    html = b"<html><body><h1>Terms of Service</h1><p>These are the terms.</p></body></html>"

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(html)

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = APIClient()
        response = client.post(
            "/api/documents/from-url/",
            {
                "title": "ToS",
                "sender_email": "s@example.com",
                "url": f"http://127.0.0.1:{port}/terms",
            },
            format="json",
        )
    finally:
        server.shutdown()

    assert response.status_code == 201
    body = response.json()
    assert body["source"] == "url"
    assert body["source_url"].endswith("/terms")

    doc = Document.objects.get(pk=body["id"])
    with open(doc.original_file.path, "rb") as f:
        assert f.read(5) == b"%PDF-"


@pytest.mark.django_db
def test_from_url_rejects_bad_scheme():
    client = APIClient()
    response = client.post(
        "/api/documents/from-url/",
        {"title": "X", "sender_email": "s@example.com", "url": "ftp://example.com/x"},
        format="json",
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Phase 3: trust hardening
# ---------------------------------------------------------------------------


def _exif_jpeg(dt_str=None, offset=None, orientation=None, size=(100, 50)):
    """Build a JPEG with controlled EXIF tags for anti-spoof tests."""
    img = Image.new("RGB", size, (180, 40, 40))
    exif = Image.Exif()
    if dt_str:
        exif[36867] = dt_str  # DateTimeOriginal
    if offset:
        exif[36881] = offset  # OffsetTimeOriginal
    if orientation:
        exif[274] = orientation
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def _exif_str(dt):
    return dt.strftime("%Y:%m:%d %H:%M:%S")


def test_exif_match_gives_full_assurance():
    now = timezone.now()
    photo = _exif_jpeg(_exif_str(now), offset="+00:00")
    report = assess_photo(photo, now, tz_offset_minutes=0)
    assert report["assurance"] == "full"
    assert report["reason"] == "timestamp_match"
    assert report["exif_present"] is True


def test_exif_match_via_client_timezone_offset():
    # Naive EXIF (no offset tag); client reports UTC-5 (Chicago, offset 300).
    now = timezone.now()
    local = now - timedelta(hours=5)
    photo = _exif_jpeg(_exif_str(local))
    report = assess_photo(photo, now, tz_offset_minutes=300)
    assert report["assurance"] == "full"
    assert report["reason"] == "timestamp_match"


def test_exif_missing_gives_reduced_assurance():
    photo = _exif_jpeg()
    report = assess_photo(photo, timezone.now(), tz_offset_minutes=0)
    assert report["assurance"] == "reduced"
    assert report["reason"] == "exif_timestamp_missing"


def test_exif_mismatch_gives_reduced_assurance():
    now = timezone.now()
    old = now - timedelta(hours=2)
    photo = _exif_jpeg(_exif_str(old), offset="+00:00")
    report = assess_photo(photo, now, tz_offset_minutes=0)
    assert report["assurance"] == "reduced"
    assert report["reason"] == "exif_timestamp_mismatch"
    assert report["delta_seconds"] == pytest.approx(7200, abs=5)


def test_exif_unparseable_gives_reduced_assurance():
    photo = _exif_jpeg("not-a-date", offset="+00:00")
    report = assess_photo(photo, timezone.now(), tz_offset_minutes=0)
    assert report["assurance"] == "reduced"
    assert report["reason"] == "exif_timestamp_unparseable"


def test_exif_naive_without_zone_gives_reduced_assurance():
    now = timezone.now()
    photo = _exif_jpeg(_exif_str(now))
    report = assess_photo(photo, now, tz_offset_minutes=None)
    assert report["assurance"] == "reduced"
    assert report["reason"] == "exif_timezone_unknown"


def test_exif_assessment_never_raises_on_garbage():
    report = assess_photo(b"definitely not an image", timezone.now(), 0)
    assert report["assurance"] == "reduced"


def test_normalize_photo_applies_exif_orientation():
    # Orientation 6 = stored rotated 90° CW; output must be transposed.
    photo = _exif_jpeg(orientation=6, size=(100, 50))
    out = normalize_photo(photo)
    assert Image.open(io.BytesIO(out)).size == (50, 100)


def _sign_with_photo(client, photo_bytes, consent=True, device_info=None):
    doc_id = upload_document(client).json()["id"]
    token = client.post(
        f"/api/documents/{doc_id}/sessions/", {"signer_name": "Jane"}, format="json"
    ).json()["token"]
    payload = {
        "signature": SIG_DATA_URL,
        "photo": "data:image/jpeg;base64,"
        + base64.b64encode(photo_bytes).decode(),
        "device_info": device_info or {},
    }
    if consent:
        payload["photo_consent"] = True
    response = client.post(f"/api/sessions/{token}/sign/", payload, format="json")
    return doc_id, token, response


@pytest.mark.django_db
def test_photo_requires_consent():
    client = APIClient()
    _, _, response = _sign_with_photo(client, _exif_jpeg(), consent=False)
    assert response.status_code == 400
    assert "photo_consent" in response.json()["error"]


@pytest.mark.django_db
def test_submit_records_device_evidence_and_photo_assurance():
    client = APIClient()
    now = timezone.now()
    photo = _exif_jpeg(_exif_str(now), offset="+00:00")
    doc_id, token, response = _sign_with_photo(
        client,
        photo,
        device_info={
            "userAgent": "test-ua",
            "platform": "test-os",
            "language": "en",
            "screenWidth": 390,
            "screenHeight": 844,
            "timezoneOffsetMinutes": 0,
        },
    )
    assert response.status_code == 200

    session = SigningSession.objects.get(token=token)
    assert session.device_evidence["user_agent"] == "test-ua"
    assert session.device_evidence["screen"] == {"width": 390, "height": 844}
    assert session.device_evidence["timezone_offset_minutes"] == 0

    submitted = session.events.get(event_type="signature.submitted")
    assert submitted.payload["photo_consent"] is True
    assurance = submitted.payload["photo_assurance"]
    assert assurance["assurance"] == "full"
    assert assurance["reason"] == "timestamp_match"

    # The certificate page carries the assurance line.
    doc = Document.objects.get(pk=doc_id)
    pdf = pymupdf.open(stream=doc.signed_file.read())
    assert "Witness photo assurance: full" in pdf[-1].get_text()


@pytest.mark.django_db
def test_sealed_pdf_carries_free_tier_watermark():
    client = APIClient()
    doc_id = upload_document(client).json()["id"]
    token = client.post(
        f"/api/documents/{doc_id}/sessions/", {"signer_name": "J"}, format="json"
    ).json()["token"]
    response = client.post(
        f"/api/sessions/{token}/sign/",
        {"signature": SIG_DATA_URL, "device_info": {}},
        format="json",
    )
    assert response.status_code == 200
    doc = Document.objects.get(pk=doc_id)
    pdf = pymupdf.open(stream=doc.signed_file.read())
    assert len(pdf) == 2  # original page + certificate page
    for page in pdf:
        assert "Signed with SignSeen" in page.get_text()


@pytest.mark.django_db
def test_cleanup_expired_marks_stale_sessions():
    from django.core.management import call_command

    client = APIClient()
    doc_id = upload_document(client).json()["id"]
    stale_token = client.post(
        f"/api/documents/{doc_id}/sessions/", {"signer_name": "Old"}, format="json"
    ).json()["token"]
    fresh_token = client.post(
        f"/api/documents/{doc_id}/sessions/", {"signer_name": "New"}, format="json"
    ).json()["token"]
    stale = SigningSession.objects.get(token=stale_token)
    stale.expires_at = timezone.now() - timedelta(seconds=1)
    stale.save(update_fields=["expires_at"])

    call_command("cleanup_expired")

    stale.refresh_from_db()
    fresh = SigningSession.objects.get(token=fresh_token)
    assert stale.status == SigningSession.Status.EXPIRED
    assert fresh.status == SigningSession.Status.PENDING
    # The document stays pending: it still has a live session.
    assert Document.objects.get(pk=doc_id).status == Document.Status.PENDING
