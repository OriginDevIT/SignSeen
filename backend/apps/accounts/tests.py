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
