"""Send-flow rework (#89): drafts, draft-token auth, send-time limits.

The upload (step 1) creates a DRAFT - no sessions, no emails. Field
placement (step 2) works on the draft with the draft token. The send
(step 3) creates the sessions in order and emails the signers. Drafts
never count toward the free 1-pending-document limit and expire after
30 days, files included.
"""

import json
from datetime import timedelta

import pytest
from django.core import mail
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Account
from apps.signing.models import Document, DocumentField, SigningSession
from apps.signing.tests import (
    SIG_DATA_URL,
    _auth_client,
    _make_account,
    make_pdf_bytes,
    upload_document,
    upload_draft,
)


def _place_on_draft(client, doc_id, token=None, signer_index=0):
    headers = {}
    if token:
        headers["HTTP_X_DRAFT_TOKEN"] = token
    return client.post(
        f"/api/documents/{doc_id}/fields/",
        {
            "type": "signature",
            "page": 1,
            "x": 0.1,
            "y": 0.2,
            "signer_index": signer_index,
        },
        format="json",
        **headers,
    )


def _send(client, doc_id, token=None):
    headers = {}
    if token:
        headers["HTTP_X_DRAFT_TOKEN"] = token
    return client.post(
        f"/api/documents/{doc_id}/send/", {}, format="json", **headers
    )


@pytest.mark.django_db
def test_draft_upload_creates_draft_no_sessions_no_email():
    client = APIClient()
    response = upload_draft(client)
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "draft"
    assert body["draft_token"]
    assert body["signer_list"] == [{"name": "", "email": "jane@example.com"}]
    assert SigningSession.objects.count() == 0
    assert mail.outbox == []


@pytest.mark.django_db
def test_anonymous_send_requires_draft_token():
    client = APIClient()
    draft = upload_draft(client).json()
    # No token: the sender cannot be identified.
    assert _send(client, draft["id"]).status_code == 403
    # Wrong token: same.
    assert _send(client, draft["id"], token="nope").status_code == 403
    # The right token sends.
    assert _send(client, draft["id"], token=draft["draft_token"]).status_code == 201


@pytest.mark.django_db
def test_draft_token_authorizes_field_placement():
    client = APIClient()
    draft = upload_draft(client).json()
    doc_id = draft["id"]
    # No credentials at all: 401.
    assert _place_on_draft(client, doc_id).status_code == 401
    # Wrong token: 403.
    assert _place_on_draft(client, doc_id, token="nope").status_code == 403
    # The draft token: the field lands on the draft.
    placed = _place_on_draft(client, doc_id, token=draft["draft_token"])
    assert placed.status_code == 201, placed.content
    assert placed.json()["signer_index"] == 0
    assert placed.json()["session"] is None  # no session until send


@pytest.mark.django_db
def test_draft_field_links_to_signer_at_send():
    account = _make_account(email="multi@example.com", tier=Account.Tier.PREMIUM)
    client = _auth_client(account)
    draft = upload_draft(
        client,
        email=account.email,
        signers=[
            {"name": "Alice", "email": "alice@example.com"},
            {"name": "Bob", "email": "bob@example.com"},
        ],
    ).json()
    placed = _place_on_draft(client, draft["id"], signer_index=1)
    assert placed.status_code == 201, placed.content
    sent = _send(client, draft["id"])
    assert sent.status_code == 201, sent.content
    field = DocumentField.objects.get(pk=placed.json()["id"])
    bob = SigningSession.objects.get(
        document_id=draft["id"], signer_email="bob@example.com"
    )
    assert field.session_id == bob.id


@pytest.mark.django_db
def test_send_creates_sessions_in_order_and_emails():
    client = APIClient()
    draft = upload_draft(client).json()
    sent = _send(client, draft["id"], token=draft["draft_token"])
    assert sent.status_code == 201
    body = sent.json()
    assert body["document"]["status"] == "pending"
    assert len(body["sessions"]) == 1
    assert body["sessions"][0]["signer_email"] == "jane@example.com"
    invites = [m for m in mail.outbox if m.subject.startswith("Please sign:")]
    assert len(invites) == 1
    assert invites[0].to == ["jane@example.com"]


@pytest.mark.django_db
def test_sequential_send_puts_sender_last():
    account = _make_account(email="seq@example.com", tier=Account.Tier.PREMIUM)
    client = _auth_client(account)
    draft = upload_draft(
        client,
        email=account.email,
        signers=[
            {"name": "Me", "email": account.email},
            {"name": "Alice", "email": "alice@example.com"},
        ],
    ).json()
    # Ask for sequential; the sender countersigns last.
    client.patch(
        f"/api/documents/{draft['id']}/",
        {"signing_mode": "sequential"},
        format="json",
    )
    sent = _send(client, draft["id"])
    assert sent.status_code == 201, sent.content
    orders = [
        (s["signer_email"], s["order"]) for s in sent.json()["sessions"]
    ]
    assert orders == [("alice@example.com", 0), (account.email, 1)]


@pytest.mark.django_db
def test_free_draft_cap_is_three_premium_is_ten():
    free = _auth_client(_make_account(email="cap-free@example.com"))
    for i in range(3):
        assert upload_draft(free, title=f"D{i}").status_code == 201
    fourth = upload_draft(free, title="D3")
    assert fourth.status_code == 409
    assert "draft" in fourth.json()["error"].lower()

    premium = _auth_client(
        _make_account(email="cap-pro@example.com", tier=Account.Tier.PREMIUM)
    )
    for i in range(10):
        assert upload_draft(premium, title=f"P{i}").status_code == 201
    eleventh = upload_draft(premium, title="P10")
    assert eleventh.status_code == 409


@pytest.mark.django_db
def test_drafts_do_not_count_toward_pending_limit():
    # Three drafts (the free cap) plus a send: the send succeeds
    # because drafts never occupied the pending slot.
    client = APIClient()
    drafts = [upload_draft(client, title=f"D{i}").json() for i in range(3)]
    assert _send(client, drafts[0]["id"], token=drafts[0]["draft_token"]).status_code == 201
    # A second send is blocked while the first is pending.
    assert _send(client, drafts[1]["id"], token=drafts[1]["draft_token"]).status_code == 409


@pytest.mark.django_db
def test_removing_signer_with_fields_is_rejected_until_fields_deleted():
    # The PATCH guard (#89): a signer with placed fields cannot be
    # removed out from under them - the sender deletes those fields
    # first.
    account = _make_account(email="rm@example.com", tier=Account.Tier.PREMIUM)
    client = _auth_client(account)
    draft = upload_draft(
        client,
        email=account.email,
        signers=[
            {"name": "Alice", "email": "alice@example.com"},
            {"name": "Bob", "email": "bob@example.com"},
        ],
    ).json()
    placed = _place_on_draft(client, draft["id"], signer_index=1)
    assert placed.status_code == 201, placed.content
    removed = client.patch(
        f"/api/documents/{draft['id']}/",
        {"signers": [{"name": "Alice", "email": "alice@example.com"}]},
        format="json",
    )
    assert removed.status_code == 400
    assert "delete those fields first" in removed.json()["error"]
    assert client.delete(
        f"/api/documents/{draft['id']}/fields/{placed.json()['id']}/"
    ).status_code == 204
    patched = client.patch(
        f"/api/documents/{draft['id']}/",
        {"signers": [{"name": "Alice", "email": "alice@example.com"}]},
        format="json",
    )
    assert patched.status_code == 200, patched.content
    assert _send(client, draft["id"]).status_code == 201


@pytest.mark.django_db
def test_send_rejects_fields_pointing_at_removed_signers():
    # The send-time safety net for the same rule, reached by changing
    # the list outside the PATCH guard.
    account = _make_account(email="rm2@example.com", tier=Account.Tier.PREMIUM)
    client = _auth_client(account)
    draft = upload_draft(
        client,
        email=account.email,
        signers=[
            {"name": "Alice", "email": "alice@example.com"},
            {"name": "Bob", "email": "bob@example.com"},
        ],
    ).json()
    assert _place_on_draft(client, draft["id"], signer_index=1).status_code == 201
    Document.objects.filter(pk=draft["id"]).update(
        signer_list=[{"name": "Alice", "email": "alice@example.com"}]
    )
    sent = _send(client, draft["id"])
    assert sent.status_code == 400
    assert "removed" in sent.json()["error"]


@pytest.mark.django_db
def test_send_rejects_list_that_became_invalid_for_tier():
    # Premium draft with three signers; the account drops to free
    # before sending, so the list is no longer valid for the tier.
    account = _make_account(email="downgrade@example.com", tier=Account.Tier.PREMIUM)
    client = _auth_client(account)
    draft = upload_draft(
        client,
        email=account.email,
        signers=[
            {"name": "A", "email": "a@example.com"},
            {"name": "B", "email": "b@example.com"},
            {"name": "C", "email": "c@example.com"},
        ],
    ).json()
    account.tier = Account.Tier.FREE
    account.save(update_fields=["tier"])
    sent = _send(client, draft["id"])
    assert sent.status_code == 400


@pytest.mark.django_db
def test_draft_patch_and_discard():
    client = APIClient()
    draft = upload_draft(client).json()
    doc_id = draft["id"]
    # Anonymous PATCH needs the token too.
    assert client.patch(
        f"/api/documents/{doc_id}/", {"title": "Renamed"}, format="json"
    ).status_code == 403
    renamed = client.patch(
        f"/api/documents/{doc_id}/",
        {"title": "Renamed"},
        format="json",
        HTTP_X_DRAFT_TOKEN=draft["draft_token"],
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Renamed"
    # Discard removes the document and its files.
    doc = Document.objects.get(pk=doc_id)
    original_path = doc.original_file.path
    assert client.delete(
        f"/api/documents/{doc_id}/",
        HTTP_X_DRAFT_TOKEN=draft["draft_token"],
    ).status_code == 204
    assert not Document.objects.filter(pk=doc_id).exists()
    import os

    assert not os.path.exists(original_path)


@pytest.mark.django_db
def test_cleanup_expired_deletes_old_drafts_with_files():
    import os

    client = APIClient()
    draft = upload_draft(client).json()
    doc = Document.objects.get(pk=draft["id"])
    original_path = doc.original_file.path
    doc.created_at = timezone.now() - timedelta(days=31)
    doc.save(update_fields=["created_at"])

    call_command("cleanup_expired")

    assert not Document.objects.filter(pk=draft["id"]).exists()
    assert not os.path.exists(original_path)


@pytest.mark.django_db
def test_dashboard_shows_drafts_marked_as_drafts():
    account = _make_account(email="dash-draft@example.com")
    client = _auth_client(account)
    upload_draft(client, email=account.email)
    body = client.get("/api/documents/mine/").json()
    assert len(body["documents"]) == 1
    assert body["documents"][0]["status"] == "draft"


@pytest.mark.django_db
def test_owner_can_delete_pending_document():
    import os

    account = _make_account(email="dash-delete-pending@example.com")
    client = _auth_client(account)
    sent = upload_document(client, email=account.email, title="Pending")
    assert sent.status_code == 201, sent.content
    doc_id = sent.json()["document"]["id"]
    # The dashboard payload carries the original file for the
    # download action.
    body = client.get("/api/documents/mine/").json()
    assert body["documents"][0]["original_file"]

    doc = Document.objects.get(pk=doc_id)
    original_path = doc.original_file.path
    assert client.delete(f"/api/documents/{doc_id}/").status_code == 204
    assert not Document.objects.filter(pk=doc_id).exists()
    assert not os.path.exists(original_path)
    assert not SigningSession.objects.filter(document_id=doc_id).exists()


@pytest.mark.django_db
def test_owner_can_delete_signed_and_expired_documents():
    import os

    account = _make_account(email="dash-delete-done@example.com")
    client = _auth_client(account)
    # Signed: upload, send, sign (single signer seals it).
    sent = upload_document(client, email=account.email, title="Signed")
    assert sent.status_code == 201, sent.content
    signed_id = sent.json()["document"]["id"]
    token = sent.json()["sessions"][0]["token"]
    assert client.post(
        f"/api/sessions/{token}/sign/",
        {"signature": SIG_DATA_URL},
        format="json",
    ).status_code == 200
    signed = Document.objects.get(pk=signed_id)
    assert signed.status == Document.Status.SIGNED
    signed_path = signed.signed_file.path
    assert client.delete(f"/api/documents/{signed_id}/").status_code == 204
    assert not Document.objects.filter(pk=signed_id).exists()
    assert not os.path.exists(signed_path)
    # Expired: upload, send, then mark expired.
    sent = upload_document(client, email=account.email, title="Expired")
    assert sent.status_code == 201, sent.content
    expired_id = sent.json()["document"]["id"]
    expired = Document.objects.get(pk=expired_id)
    expired.status = Document.Status.EXPIRED
    expired.save(update_fields=["status"])
    assert client.delete(f"/api/documents/{expired_id}/").status_code == 204
    assert not Document.objects.filter(pk=expired_id).exists()


@pytest.mark.django_db
def test_delete_rejects_non_owner_and_anonymous():
    owner = _make_account(email="dash-delete-owner@example.com")
    client = _auth_client(owner)
    sent = upload_document(client, email=owner.email, title="Pending")
    assert sent.status_code == 201, sent.content
    doc_id = sent.json()["document"]["id"]
    draft_token = Document.objects.get(pk=doc_id).draft_token
    other = _auth_client(_make_account(email="dash-delete-other@example.com"))
    assert other.delete(f"/api/documents/{doc_id}/").status_code == 403
    assert Document.objects.filter(pk=doc_id).exists()
    assert APIClient().delete(f"/api/documents/{doc_id}/").status_code == 403
    assert Document.objects.filter(pk=doc_id).exists()
    # The draft token authorizes draft edits only, not deleting a
    # sent document.
    assert APIClient().delete(
        f"/api/documents/{doc_id}/",
        HTTP_X_DRAFT_TOKEN=draft_token,
    ).status_code == 403
    assert Document.objects.filter(pk=doc_id).exists()
