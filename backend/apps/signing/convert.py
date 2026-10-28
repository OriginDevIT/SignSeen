"""Document intake conversions.

- Office docs (.doc/.docx) -> PDF via headless LibreOffice.
- Web pages (URL) -> PDF via WeasyPrint (static HTML/CSS; JS-heavy pages
  render partially — documented limitation, not a bug).

Both paths are verified against real binaries (see tests).
"""

import ipaddress
import logging
import os
import socket
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

from django.conf import settings
from weasyprint import HTML
from weasyprint.urls import URLFetcher

log = logging.getLogger(__name__)

SOFFICE_TIMEOUT_SECONDS = 120


class ConversionError(Exception):
    pass


def convert_office_to_pdf(data: bytes, filename: str) -> bytes:
    """Convert .doc/.docx bytes to PDF. Raises ConversionError on failure."""
    suffix = os.path.splitext(filename)[1].lower()
    if suffix not in (".doc", ".docx"):
        raise ConversionError(f"unsupported office format: {suffix or '(none)'}")

    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, f"input{suffix}")
        with open(src, "wb") as f:
            f.write(data)
        # A private user profile per conversion: concurrent workers must not
        # share LibreOffice's default profile (it refuses a second instance).
        profile = f"file://{tmp}/profile"
        try:
            proc = subprocess.run(
                [
                    "soffice",
                    "--headless",
                    f"-env:UserInstallation={profile}",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmp,
                    src,
                ],
                capture_output=True,
                timeout=SOFFICE_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            raise ConversionError("document conversion timed out")
        if proc.returncode != 0:
            detail = proc.stderr.decode(errors="replace")[-500:]
            raise ConversionError(f"document conversion failed: {detail}")
        out = os.path.join(tmp, "input.pdf")
        if not os.path.exists(out):
            raise ConversionError("document conversion produced no output")
        with open(out, "rb") as f:
            return f.read()


def validate_public_url(url: str) -> None:
    """SSRF guard for server-side URL fetching (issue #39).

    The URL must be http(s) and EVERY address its host resolves to must
    be a public address — loopback, private, link-local (cloud metadata
    lives there), multicast, reserved, and unspecified addresses are
    refused. Local development against a local server can opt out with
    URL_FETCH_ALLOW_PRIVATE=1; never set that in production. Residual
    risk: DNS answers can change between this check and the fetch
    (rebinding); the self-hosting guide recommends egress rules as the
    outer layer.
    """
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ConversionError("url must be an http(s) address")
    if getattr(settings, "URL_FETCH_ALLOW_PRIVATE", False):
        return
    try:
        infos = socket.getaddrinfo(
            parsed.hostname, None, proto=socket.IPPROTO_TCP
        )
    except OSError:
        raise ConversionError("url host could not be resolved")
    if not infos:
        raise ConversionError("url host could not be resolved")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise ConversionError("url must point to a public address")


class _GuardedURLFetcher(URLFetcher):
    """WeasyPrint fetcher that validates every fetched URL (including
    subresources) and refuses redirects — a public page redirecting to
    an internal address is the classic SSRF bypass, so the URL given
    must be the final one."""

    def __init__(self):
        super().__init__(
            allow_redirects=False, allowed_protocols={"http", "https"}
        )

    def fetch(self, url, headers=None):
        validate_public_url(url)
        return super().fetch(url, headers=headers)


def _render_url_to_pdf_sync(url: str) -> bytes:
    """Direct WeasyPrint render; runs in the child process (see below)."""
    validate_public_url(url)
    try:
        return HTML(url=url, url_fetcher=_GuardedURLFetcher()).write_pdf()
    except ConversionError:
        raise
    except Exception as exc:
        raise ConversionError(f"could not render page: {exc}")


def render_url_to_pdf(url: str) -> bytes:
    """Render a web page URL to PDF, bounded by an overall timeout.

    The render runs in a child process so a slow page can actually be
    killed: a timed-out render thread would keep consuming CPU on the
    box. On timeout the child is killed and this raises ConversionError,
    which the view turns into a clean 400 instead of a hung request.
    """
    validate_public_url(url)
    timeout = getattr(settings, "URL_RENDER_TIMEOUT_SECONDS", 60)
    cmd = [
        sys.executable,
        str(settings.BASE_DIR / "manage.py"),
        "render_url_pdf",
        url,
    ]
    # The settings module rarely survives into the process environment
    # under test runners; fall back to manage.py's default. Settings
    # the child render depends on are passed explicitly too, so an
    # in-process override (e.g. in tests) reaches the child.
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": os.environ.get("DJANGO_SETTINGS_MODULE")
        or "config.settings",
        "URL_FETCH_ALLOW_PRIVATE": (
            "1" if getattr(settings, "URL_FETCH_ALLOW_PRIVATE", False) else "0"
        ),
    }
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        raise ConversionError("page took too long to render")
    if proc.returncode != 0:
        log.warning(
            "url render child failed for %s: %s",
            url,
            proc.stderr.decode(errors="replace")[-500:],
        )
        raise ConversionError("could not render page")
    return proc.stdout
