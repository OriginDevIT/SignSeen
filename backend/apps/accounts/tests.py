"""Tests for sender accounts: signup, login, tokens, password reset."""

import pytest
from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import Account


def signup(client, email="a@example.com", password="longpassword1"):
    return client.post(
        "/api/auth/signup/", {"email": email, "password": password}, format="json"
    )


@pytest.mark.django_db
def test_signup_creates_account_and_token():
    client = APIClient()
    response = signup(client)
    assert response.status_code == 201
    body = response.json()
    assert body["account"]["email"] == "a@example.com"
    assert body["account"]["tier"] == "free"
    assert body["token"]
    assert Account.objects.filter(email="a@example.com").exists()


@pytest.mark.django_db
def test_signup_rejects_duplicate_and_short_password():
    client = APIClient()
    assert signup(client).status_code == 201
    assert signup(client).status_code == 409
    assert signup(client, email="b@example.com", password="short").status_code == 400


@pytest.mark.django_db
def test_login_returns_token_and_rejects_bad_password():
    client = APIClient()
    signup(client)
    good = client.post(
        "/api/auth/login/",
        {"email": "a@example.com", "password": "longpassword1"},
        format="json",
    )
    assert good.status_code == 200
    assert good.json()["token"]
    bad = client.post(
        "/api/auth/login/",
        {"email": "a@example.com", "password": "wrongpassword"},
        format="json",
    )
    assert bad.status_code == 401


@pytest.mark.django_db
def test_me_requires_auth_and_logout_kills_token():
    client = APIClient()
    assert client.get("/api/auth/me/").status_code == 401
    token = signup(client).json()["token"]
    client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
    assert client.get("/api/auth/me/").json()["email"] == "a@example.com"
    assert client.post("/api/auth/logout/").status_code == 200
    assert client.get("/api/auth/me/").status_code == 401
    assert not Token.objects.filter(key=token).exists()


@pytest.mark.django_db
@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_password_reset_flow():
    from django.core import mail

    client = APIClient()
    signup(client)
    # Unknown emails still get 200 (no enumeration).
    assert client.post(
        "/api/auth/password-reset/", {"email": "nobody@example.com"}, format="json"
    ).status_code == 200
    assert len(mail.outbox) == 0
    assert client.post(
        "/api/auth/password-reset/", {"email": "a@example.com"}, format="json"
    ).status_code == 200
    assert len(mail.outbox) == 1
    assert "reset-password" in mail.outbox[0].body

    # Extract uid/token from the emailed link and confirm.
    link = next(
        line for line in mail.outbox[0].body.splitlines() if "reset-password" in line
    )
    query = link.split("?", 1)[1]
    params = dict(part.split("=") for part in query.split("&"))
    assert client.post(
        "/api/auth/password-reset/confirm/",
        {"uid": params["uid"], "token": params["token"], "password": "newpassword99"},
        format="json",
    ).status_code == 200
    # Old password dead, new password works.
    assert client.post(
        "/api/auth/login/",
        {"email": "a@example.com", "password": "longpassword1"},
        format="json",
    ).status_code == 401
    assert client.post(
        "/api/auth/login/",
        {"email": "a@example.com", "password": "newpassword99"},
        format="json",
    ).status_code == 200


@pytest.mark.django_db
def test_auth_endpoints_ignore_stale_sender_token():
    # A browser holding a token the server no longer knows (DB reset,
    # token deleted elsewhere) must still be able to sign up and log in;
    # otherwise the stale header deadlocks account recovery entirely.
    stale = APIClient()
    stale.credentials(HTTP_AUTHORIZATION="Token stale-token-no-longer-in-db")
    assert signup(stale).status_code == 201

    stale2 = APIClient()
    stale2.credentials(HTTP_AUTHORIZATION="Token stale-token-no-longer-in-db")
    good = stale2.post(
        "/api/auth/login/",
        {"email": "a@example.com", "password": "longpassword1"},
        format="json",
    )
    assert good.status_code == 200
    assert good.json()["token"]


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Custom branding (premium; issue #10 / scope §3.6)
# ---------------------------------------------------------------------------

from django.core.files.uploadedfile import SimpleUploadedFile

TINY_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _account_client(email, tier=Account.Tier.FREE):
    account = Account.objects.create_user(email=email, password="longpassword1")
    if tier != Account.Tier.FREE:
        account.tier = tier
        account.save(update_fields=["tier"])
    token, _ = Token.objects.get_or_create(user=account)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return client, account


@pytest.mark.django_db
def test_branding_requires_auth_and_get_returns_defaults():
    assert APIClient().get("/api/auth/branding/").status_code == 401
    client, _ = _account_client("free@example.com")
    body = client.get("/api/auth/branding/").json()
    assert body == {"brand_name": "", "brand_color": "", "brand_logo": None}


@pytest.mark.django_db
def test_branding_patch_is_premium_only():
    client, account = _account_client("free2@example.com")
    response = client.patch(
        "/api/auth/branding/", {"brand_name": "Acme"}, format="json"
    )
    assert response.status_code == 403
    account.refresh_from_db()
    assert account.brand_name == ""


@pytest.mark.django_db
def test_branding_premium_patch_persists_name_color_and_logo():
    client, account = _account_client("pro@example.com", tier=Account.Tier.PREMIUM)
    response = client.patch(
        "/api/auth/branding/",
        {"brand_name": "Acme Legal", "brand_color": "#1a2B3c"},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["brand_name"] == "Acme Legal"
    assert response.json()["brand_color"] == "#1a2B3c"
    account.refresh_from_db()
    assert account.brand_name == "Acme Legal"
    assert account.brand_color == "#1a2B3c"

    logo = SimpleUploadedFile("logo.png", TINY_PNG_BYTES, content_type="image/png")
    response = client.patch(
        "/api/auth/branding/", {"brand_logo": logo}, format="multipart"
    )
    assert response.status_code == 200
    assert "branding/" in response.json()["brand_logo"]
    account.refresh_from_db()
    assert account.brand_logo.name.startswith("branding/")
    # The name/color set earlier survive a logo-only PATCH.
    assert account.brand_name == "Acme Legal"


@pytest.mark.django_db
def test_branding_patch_rejects_invalid_color():
    client, account = _account_client("pro2@example.com", tier=Account.Tier.PREMIUM)
    for bad in ("blue", "#12345", "#1234567", "123456", "#gggggg"):
        response = client.patch(
            "/api/auth/branding/", {"brand_color": bad}, format="json"
        )
        assert response.status_code == 400, bad
    account.refresh_from_db()
    assert account.brand_color == ""

@pytest.mark.django_db
def test_signup_accepts_optional_name_and_returns_it():
    client = APIClient()
    response = client.post(
        "/api/auth/signup/",
        {"email": "a@example.com", "password": "longpassword1", "name": " Ada "},
        format="json",
    )
    assert response.status_code == 201
    assert response.json()["account"]["name"] == "Ada"
    assert Account.objects.get(email="a@example.com").name == "Ada"


@pytest.mark.django_db
def test_signup_without_name_defaults_to_blank_and_rejects_overlong_name():
    client = APIClient()
    assert signup(client).json()["account"]["name"] == ""
    assert Account.objects.get(email="a@example.com").name == ""
    long_name = client.post(
        "/api/auth/signup/",
        {
            "email": "b@example.com",
            "password": "longpassword1",
            "name": "x" * 121,
        },
        format="json",
    )
    assert long_name.status_code == 400
    assert not Account.objects.filter(email="b@example.com").exists()


@pytest.mark.django_db
def test_me_patch_updates_and_clears_name():
    client = APIClient()
    token = signup(client).json()["token"]
    client.credentials(HTTP_AUTHORIZATION=f"Token {token}")

    assert client.get("/api/auth/me/").json()["name"] == ""

    patched = client.patch("/api/auth/me/", {"name": " Ada "}, format="json")
    assert patched.status_code == 200
    assert patched.json()["name"] == "Ada"
    assert client.get("/api/auth/me/").json()["name"] == "Ada"

    cleared = client.patch("/api/auth/me/", {"name": ""}, format="json")
    assert cleared.status_code == 200
    assert cleared.json()["name"] == ""

    assert client.patch("/api/auth/me/", {"name": 42}, format="json").status_code == 400
    overlong = client.patch(
        "/api/auth/me/", {"name": "x" * 121}, format="json"
    )
    assert overlong.status_code == 400
    assert client.get("/api/auth/me/").json()["name"] == ""


@pytest.mark.django_db
def test_me_includes_alerts_enabled_and_patch_toggles_it():
    client = APIClient()
    token = signup(client).json()["token"]
    client.credentials(HTTP_AUTHORIZATION=f"Token {token}")

    body = client.get("/api/auth/me/").json()
    assert body["alerts_enabled"] is True

    patched = client.patch(
        "/api/auth/me/", {"alerts_enabled": False}, format="json"
    )
    assert patched.status_code == 200
    assert patched.json()["alerts_enabled"] is False
    assert client.get("/api/auth/me/").json()["alerts_enabled"] is False

    bad = client.patch(
        "/api/auth/me/", {"alerts_enabled": "yes"}, format="json"
    )
    assert bad.status_code == 400

    back = client.patch("/api/auth/me/", {"alerts_enabled": True}, format="json")
    assert back.json()["alerts_enabled"] is True

# ---------------------------------------------------------------------------
# Google sign-in: the verifier is stubbed (no network, no credentials).
# ---------------------------------------------------------------------------


def _stub_google(monkeypatch, email="g@example.com", name="G User"):
    monkeypatch.setattr(
        "apps.accounts.views.verify_google_id_token",
        lambda token: {"email": email, "name": name},
    )


@pytest.mark.django_db
def test_google_login_creates_account_with_working_token(settings, monkeypatch):
    settings.GOOGLE_OAUTH_CLIENT_ID = "client-123"
    _stub_google(monkeypatch)
    client = APIClient()
    response = client.post(
        "/api/auth/google/", {"id_token": "fake-token"}, format="json"
    )
    assert response.status_code == 200
    body = response.json()
    assert body["account"]["email"] == "g@example.com"
    assert body["account"]["tier"] == "free"
    account = Account.objects.get(email="g@example.com")
    assert not account.has_usable_password()
    client.credentials(HTTP_AUTHORIZATION=f"Token {body['token']}")
    assert client.get("/api/auth/me/").status_code == 200


@pytest.mark.django_db
def test_google_login_seeds_name_for_new_account(settings, monkeypatch):
    settings.GOOGLE_OAUTH_CLIENT_ID = "client-123"
    _stub_google(monkeypatch)
    client = APIClient()
    response = client.post(
        "/api/auth/google/", {"id_token": "fake-token"}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["account"]["name"] == "G User"
    assert Account.objects.get(email="g@example.com").name == "G User"


@pytest.mark.django_db
def test_google_login_links_existing_password_account(settings, monkeypatch):
    settings.GOOGLE_OAUTH_CLIENT_ID = "client-123"
    client = APIClient()
    password_id = signup(client).json()["account"]["id"]
    _stub_google(monkeypatch, email="a@example.com")
    response = client.post(
        "/api/auth/google/", {"id_token": "fake-token"}, format="json"
    )
    assert response.status_code == 200
    # Linked, not duplicated - and the password still works afterwards.
    assert response.json()["account"]["id"] == password_id
    assert Account.objects.filter(email="a@example.com").count() == 1
    assert client.post(
        "/api/auth/login/",
        {"email": "a@example.com", "password": "longpassword1"},
        format="json",
    ).status_code == 200


@pytest.mark.django_db
def test_google_login_keeps_existing_account_name(settings, monkeypatch):
    settings.GOOGLE_OAUTH_CLIENT_ID = "client-123"
    client = APIClient()
    client.post(
        "/api/auth/signup/",
        {"email": "a@example.com", "password": "longpassword1", "name": "Ada"},
        format="json",
    )
    _stub_google(monkeypatch, email="a@example.com", name="G User")
    response = client.post(
        "/api/auth/google/", {"id_token": "fake-token"}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["account"]["name"] == "Ada"


@pytest.mark.django_db
def test_google_login_unconfigured_is_503(settings):
    settings.GOOGLE_OAUTH_CLIENT_ID = ""
    response = APIClient().post(
        "/api/auth/google/", {"id_token": "fake-token"}, format="json"
    )
    assert response.status_code == 503


@pytest.mark.django_db
def test_google_login_invalid_token_is_401(settings, monkeypatch):
    settings.GOOGLE_OAUTH_CLIENT_ID = "client-123"

    def _boom(token):
        raise ValueError("bad token")

    monkeypatch.setattr("apps.accounts.views.verify_google_id_token", _boom)
    response = APIClient().post(
        "/api/auth/google/", {"id_token": "forged"}, format="json"
    )
    assert response.status_code == 401
    assert Account.objects.count() == 0


# --- Login brute-force guard (issue #39) -------------------------------------

import pytest
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient


@pytest.mark.django_db
@override_settings(LOGIN_MAX_FAILED_ATTEMPTS=3)
def test_login_throttles_after_repeated_failures():
    cache.clear()
    Account.objects.create_user(
        email="victim@example.com", password="<redacted>"
    )
    client = APIClient()
    for _ in range(3):
        response = client.post(
            "/api/auth/login/",
            {"email": "victim@example.com", "password": "wrong-password"},
            format="json",
        )
        assert response.status_code == 401
    # Even the correct password is refused while throttled.
    response = client.post(
        "/api/auth/login/",
        {"email": "victim@example.com", "password": "<redacted>"},
        format="json",
    )
    assert response.status_code == 429
    cache.clear()


# ----------------------------------------------------------------------
# Account close / delete (#183)
# ----------------------------------------------------------------------

import os
from unittest import mock

import stripe
from django.core.files.base import ContentFile

from apps.signing.models import AuditEvent, Document, DocumentField, SigningSession


def _auth_client_for(email="a@example.com", password="longpassword1"):
    client = APIClient()
    response = signup(client, email=email, password=password)
    assert response.status_code == 201
    token = response.json()["token"]
    client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
    return client, Account.objects.get(email=email)


def _owned_document(account, title="Contract"):
    doc = Document.objects.create(
        title=title, sender_email=account.email, owner=account
    )
    doc.original_file.save("doc.pdf", ContentFile(b"%PDF-1.4 fake"), save=True)
    doc.signed_file.save("signed.pdf", ContentFile(b"%PDF-1.4 sealed"), save=True)
    session = SigningSession.objects.create(
        document=doc, signer_email="jane@example.com"
    )
    field = DocumentField.objects.create(
        document=doc,
        session=session,
        field_type=DocumentField.Type.SIGNATURE,
        page=1,
        x=0.1,
        y=0.1,
    )
    field.value_file.save("sig.png", ContentFile(b"fake png"), save=True)
    AuditEvent.objects.create(
        session=session,
        event_type="signature.submitted",
        payload={},
        prev_hash="0" * 64,
        hash="1" * 64,
    )
    return doc


@pytest.mark.django_db
def test_delete_account_removes_account_documents_and_files():
    client, account = _auth_client_for()
    doc = _owned_document(account)
    paths = [
        doc.original_file.path,
        doc.signed_file.path,
        doc.fields.first().value_file.path,
    ]
    for path in paths:
        assert os.path.exists(path)
    # An anonymous send from the same email is the account's too.
    anon = Document.objects.create(
        title="Anonymous", sender_email=account.email, owner=None
    )
    anon.original_file.save("anon.pdf", ContentFile(b"%PDF-1.4 anon"), save=True)
    anon_path = anon.original_file.path

    response = client.delete("/api/auth/me/")
    assert response.status_code == 204
    assert not Account.objects.filter(email="a@example.com").exists()
    assert not Document.objects.filter(pk=doc.pk).exists()
    assert not Document.objects.filter(pk=anon.pk).exists()
    assert not SigningSession.objects.filter(document_id=doc.pk).exists()
    assert not DocumentField.objects.filter(document_id=doc.pk).exists()
    assert not AuditEvent.objects.filter(
        session__document_id=doc.pk
    ).exists()
    for path in paths + [anon_path]:
        assert not os.path.exists(path)
    # The token died with the account.
    assert client.get("/api/auth/me/").status_code == 401


@pytest.mark.django_db
def test_delete_account_requires_auth():
    client = APIClient()
    assert client.delete("/api/auth/me/").status_code == 401


@pytest.mark.django_db
def test_delete_account_keeps_other_accounts_and_counterparty_documents():
    client_a, account_a = _auth_client_for(email="a@example.com")
    client_b, account_b = _auth_client_for(email="b@example.com")
    own_doc = _owned_document(account_a, title="A's doc")
    # B's document, where A is only a signer: not A's to delete, and
    # its audit chain must survive A's account closing.
    other_doc = _owned_document(account_b, title="B's doc")
    other_session = other_doc.sessions.get()
    other_session.signer_email = account_a.email
    other_session.save(update_fields=["signer_email"])

    assert client_a.delete("/api/auth/me/").status_code == 204
    assert not Document.objects.filter(pk=own_doc.pk).exists()
    assert Account.objects.filter(email="b@example.com").exists()
    assert Document.objects.filter(pk=other_doc.pk).exists()
    assert SigningSession.objects.filter(pk=other_session.pk).exists()
    assert AuditEvent.objects.filter(
        session__document_id=other_doc.pk
    ).exists()
    assert client_b.get("/api/auth/me/").status_code == 200


@pytest.mark.django_db
@override_settings(STRIPE_SECRET_KEY="sk_test_x")
def test_delete_account_cancels_stripe_subscription():
    client, account = _auth_client_for()
    account.tier = Account.Tier.PREMIUM
    account.stripe_subscription_id = "sub_123"
    account.save(update_fields=["tier", "stripe_subscription_id"])
    with mock.patch(
        "apps.accounts.views.stripe.Subscription.delete"
    ) as cancel:
        assert client.delete("/api/auth/me/").status_code == 204
    cancel.assert_called_once_with("sub_123")
    assert not Account.objects.filter(email="a@example.com").exists()


@pytest.mark.django_db
@override_settings(STRIPE_SECRET_KEY="sk_test_x")
def test_delete_account_tolerates_already_cancelled_subscription():
    client, account = _auth_client_for()
    account.stripe_subscription_id = "sub_gone"
    account.save(update_fields=["stripe_subscription_id"])
    with mock.patch(
        "apps.accounts.views.stripe.Subscription.delete",
        side_effect=stripe.InvalidRequestError(
            "No such subscription: sub_gone", param="id"
        ),
    ):
        assert client.delete("/api/auth/me/").status_code == 204
    assert not Account.objects.filter(email="a@example.com").exists()


@pytest.mark.django_db
@override_settings(STRIPE_SECRET_KEY="sk_test_x")
def test_delete_account_fails_when_stripe_cancel_fails():
    client, account = _auth_client_for()
    account.stripe_subscription_id = "sub_123"
    account.save(update_fields=["stripe_subscription_id"])
    with mock.patch(
        "apps.accounts.views.stripe.Subscription.delete",
        side_effect=stripe.StripeError("stripe is down"),
    ):
        response = client.delete("/api/auth/me/")
    assert response.status_code == 502
    assert Account.objects.filter(email="a@example.com").exists()
