"""End-to-end tests for the signing ceremony API."""

import base64
import http.server
import io
import threading
from datetime import timedelta

import pymupdf
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from .hashing import GENESIS_HASH, verify_chain
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
