import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_health_check_returns_ok():
    client = APIClient()
    response = client.get("/api/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "signseen-api"}


@pytest.mark.django_db
def test_cors_allows_the_local_frontend_origin():
    # The compose dev stack serves the web app from :3000 and this API
    # from :8000 — without the allow header the browser blocks every
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
