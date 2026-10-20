"""Document intake conversions.

- Office docs (.doc/.docx) -> PDF via headless LibreOffice.
- Web pages (URL) -> PDF via WeasyPrint (static HTML/CSS; JS-heavy pages
  render partially — documented limitation, not a bug).

Both paths are verified against real binaries (see tests).
"""

import os
import subprocess
import tempfile
from urllib.parse import urlparse

from weasyprint import HTML

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


def render_url_to_pdf(url: str) -> bytes:
    """Render a web page URL to PDF.

    NOTE (self-host): this fetches a remote URL server-side. The hosted
    deployment should add SSRF egress controls (Phase 4 hardening); the
    scheme allowlist below is the Phase 2 minimum.
    """
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ConversionError("url must be an http(s) address")
    try:
        return HTML(url=url).write_pdf()
    except ConversionError:
        raise
    except Exception as exc:
        raise ConversionError(f"could not render page: {exc}")
