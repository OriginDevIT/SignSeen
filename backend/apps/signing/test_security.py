"""Security-pass tests (issue #39): SSRF guard on URL intake and
response hardening headers."""

import socket

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.signing.convert import ConversionError, validate_public_url


def _addrinfo(ip):
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    return [(family, socket.SOCK_STREAM, 6, "", (ip, 443))]


def _patch_dns(monkeypatch, ip):
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **kw: _addrinfo(ip)
    )


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",  # loopback
        "10.0.0.5",  # private
        "192.168.1.10",  # private
        "172.16.0.9",  # private
        "169.254.169.254",  # link-local (cloud metadata)
        "::1",  # IPv6 loopback
        "0.0.0.0",  # unspecified
    ],
)
def test_validate_public_url_rejects_non_public(monkeypatch, ip):
    _patch_dns(monkeypatch, ip)
    with pytest.raises(ConversionError):
        validate_public_url("https://example.com/page")


def test_validate_public_url_allows_public(monkeypatch):
    _patch_dns(monkeypatch, "93.184.216.34")
    validate_public_url("https://example.com/page")  # no raise


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://x/y", "notaurl", "https://"])
def test_validate_public_url_rejects_bad_shapes(url):
    with pytest.raises(ConversionError):
        validate_public_url(url)


def test_validate_public_url_unresolvable_host(monkeypatch):
    def boom(*a, **kw):
        raise OSError("no dns")

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    with pytest.raises(ConversionError):
        validate_public_url("https://missing.example/page")


@override_settings(URL_FETCH_ALLOW_PRIVATE=True)
def test_validate_public_url_dev_escape_hatch(monkeypatch):
    _patch_dns(monkeypatch, "127.0.0.1")
    validate_public_url("http://localhost:3000/page")  # no raise


def test_x_frame_options_deny_header():
    response = APIClient().get("/api/health/")
    assert response.headers.get("X-Frame-Options") == "DENY"
