import importlib

import pytest
from rest_framework.test import APIClient


def _reload_settings():
    import config.settings as app_settings

    importlib.reload(app_settings)
    return app_settings


def test_empty_from_email_env_falls_back_to_default(monkeypatch):
    # The compose files pass DEFAULT_FROM_EMAIL through with an empty
    # default, and os.environ.get only falls back when the variable is
    # absent - so a present-but-empty value wiped the default and every
    # invite was rejected with an invalid from-address (#98).
    monkeypatch.setenv("DEFAULT_FROM_EMAIL", "")
    app_settings = _reload_settings()
    try:
        assert (
            app_settings.DEFAULT_FROM_EMAIL
            == "SignSeen <hello@getsignseen.com>"
        )
    finally:
        monkeypatch.delenv("DEFAULT_FROM_EMAIL", raising=False)
        _reload_settings()


def test_explicit_from_email_env_is_honored(monkeypatch):
    monkeypatch.setenv("DEFAULT_FROM_EMAIL", "Example <hello@example.com>")
    app_settings = _reload_settings()
    try:
        assert app_settings.DEFAULT_FROM_EMAIL == "Example <hello@example.com>"
    finally:
        monkeypatch.delenv("DEFAULT_FROM_EMAIL", raising=False)
        _reload_settings()


@pytest.mark.django_db
def test_health_check_returns_ok():
    client = APIClient()
    response = client.get("/api/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "signseen-api"}


@pytest.mark.django_db
def test_cors_allows_the_local_frontend_origin():
    # The compose dev stack serves the web app from :3000 and this API
    # from :8000 - without the allow header the browser blocks every
    # call, which is what the Playwright suite caught.
    client = APIClient()
    response = client.get(
        "/api/health/", HTTP_ORIGIN="http://localhost:3000"
    )
    assert (
        response.headers.get("Access-Control-Allow-Origin")
        == "http://localhost:3000"
    )


@pytest.mark.django_db
def test_cors_preflight_for_a_json_post():
    client = APIClient()
    response = client.options(
        "/api/documents/",
        HTTP_ORIGIN="http://localhost:3000",
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type",
    )
    assert response.status_code == 200
    assert (
        response.headers.get("Access-Control-Allow-Origin")
        == "http://localhost:3000"
    )


@pytest.mark.django_db
def test_cors_preflight_allows_the_draft_token_header():
    # The draft token (#89) travels as X-Draft-Token. A browser only
    # sends it after a preflight that lists it - the default allowed
    # headers do not include it, so without an explicit allow the
    # browser blocks every draft-token call (field placement, send)
    # and the send step fails with a network error.
    client = APIClient()
    response = client.options(
        "/api/documents/",
        HTTP_ORIGIN="http://localhost:3000",
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization, x-draft-token",
    )
    assert response.status_code == 200
    assert (
        response.headers.get("Access-Control-Allow-Origin")
        == "http://localhost:3000"
    )
    allowed = response.headers.get("Access-Control-Allow-Headers", "")
    assert "x-draft-token" in allowed.lower()
