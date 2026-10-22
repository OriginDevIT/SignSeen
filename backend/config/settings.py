"""Django settings for the SignSeen API (Phase 0 scaffold)."""

import os
import urllib.parse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-key")


def _env_int(name: str, default: int) -> int:
    """Integer env var where a BLANK value means 'use the default'.

    Compose passthroughs and copied .env examples routinely set
    variables to empty strings, and os.environ.get's default only
    applies when the variable is absent — int('') crashed settings
    import on staging (#49). A non-blank non-numeric value still
    raises, failing loud on a real misconfiguration.
    """
    raw = os.environ.get(name, "")
    if raw.strip() == "":
        return default
    return int(raw)


DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "*").split(",")

INSTALLED_APPS = [
    "corsheaders",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "rest_framework.authtoken",
    "apps.core",
    "apps.accounts",
    "apps.signing",
    "apps.billing",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# The app is never meant to be framed by another site.
X_FRAME_OPTIONS = "DENY"

# --- Production hardening (issue #39) ----------------------------------------
# All opt-in via env so local development is unaffected; the
# self-hosting guide (docs/self-hosting.md) sets them for production.
# Behind the Caddy TLS proxy, tell Django the original scheme so secure
# redirects and absolute URLs are correct.
if os.environ.get("DJANGO_BEHIND_TLS_PROXY", "0") == "1":
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
# Secure cookies default ON when DEBUG is off; override explicitly if a
# deployment terminates TLS elsewhere.
_secure_cookies = os.environ.get("DJANGO_SECURE_COOKIES")
if _secure_cookies is None:
    SESSION_COOKIE_SECURE = not DEBUG
    CSRF_COOKIE_SECURE = not DEBUG
else:
    SESSION_COOKIE_SECURE = _secure_cookies == "1"
    CSRF_COOKIE_SECURE = _secure_cookies == "1"
SECURE_HSTS_SECONDS = _env_int("DJANGO_HSTS_SECONDS", 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
# Login brute-force guard (apps.accounts): failed attempts allowed per
# email+IP inside the window before the login endpoint answers 429.
LOGIN_MAX_FAILED_ATTEMPTS = _env_int("LOGIN_MAX_FAILED_ATTEMPTS", 10)
LOGIN_FAILURE_WINDOW_SECONDS = _env_int("LOGIN_FAILURE_WINDOW_SECONDS", 900)
# SSRF guard escape hatch for local development only (issue #39).
URL_FETCH_ALLOW_PRIVATE = os.environ.get("URL_FETCH_ALLOW_PRIVATE", "0") == "1"

# The web app is served from a different origin than this API in the
# compose dev stack (localhost:3000 -> localhost:8000), and browsers
# refuse those calls without CORS permission. Same-origin deployments
# (one proxy in front of both) don't need it and are unaffected.
# Comma-separated env override, e.g. for a split-origin deployment.
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

ROOT_URLCONF = "config.urls"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# Use Postgres when DATABASE_URL is set (docker-compose, staging, prod).
_db_url = os.environ.get("DATABASE_URL")
if _db_url:
    _u = urllib.parse.urlparse(_db_url)
    DATABASES["default"] = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": _u.path.lstrip("/"),
        "USER": _u.username,
        "PASSWORD": _u.password,
        "HOST": _u.hostname,
        "PORT": _u.port or 5432,
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Sender accounts (apps.accounts): email is the login.
AUTH_USER_MODEL = "accounts.Account"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
}

# --- Freemium limits (scope §3.6) -------------------------------------------
FREE_PENDING_DOC_LIMIT = 1
FREE_STORAGE_BYTES = 100 * 1024 * 1024  # 100 MB total
# Premium storage cap: 5 GB default, sized for the $5/mo price
# (documents are PDFs; 5 GB is thousands of typical documents).
PREMIUM_STORAGE_BYTES = _env_int(
    "PREMIUM_STORAGE_BYTES", 5 * 1024 * 1024 * 1024
)

# --- Email (transactional: signed copies, password resets) ------------------
# Default backend prints to the server log; set EMAIL_HOST for real SMTP.
EMAIL_BACKEND = os.environ.get(
    "EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend"
)
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = _env_int("EMAIL_PORT", 587)
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "1") == "1"
DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL", "SignSeen <hello@getsignseen.com>"
)

# --- E2E fixtures -----------------------------------------------------------
# Set only by docker-compose.test.yml. Gates the seed_e2e management
# command, which creates known-password test accounts.
ENABLE_E2E_FIXTURES = os.environ.get("ENABLE_E2E_FIXTURES", "0") == "1"

# --- Stripe billing (premium tier) ------------------------------------------
# All optional: with no keys set, billing endpoints answer 503 and the app
# runs free-tier only. STRIPE_PRICE_ID is the Price created in the Stripe
# dashboard; no amount is hardcoded here. Premium is sold monthly and
# annually (Matt, Oct 21: $5/mo, $50/yr) — one Stripe Price per plan;
# STRIPE_PRICE_ID remains as the legacy monthly fallback.
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
STRIPE_PRICE_ID_MONTHLY = (
    os.environ.get("STRIPE_PRICE_ID_MONTHLY", "") or STRIPE_PRICE_ID
)
STRIPE_PRICE_ID_ANNUAL = os.environ.get("STRIPE_PRICE_ID_ANNUAL", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
# Billing lifecycle (issue #36): days a payment-failed premium account
# stays suspended before it expires, and days an expired account's
# stored documents are kept before they are purged.
BILLING_SUSPENSION_DAYS = _env_int("BILLING_SUSPENSION_DAYS", 180)
BILLING_PURGE_DAYS = _env_int("BILLING_PURGE_DAYS", 180)

# --- Google sign-in (OAuth for sender accounts, scope §3.10) ----------------
# All optional: with no client ID set, /api/auth/google/ answers 503 and
# password accounts are the only login. The web app uses the same client
# ID as NEXT_PUBLIC_GOOGLE_CLIENT_ID.
GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")

# File storage for uploads, evidence images, and sealed PDFs.
# (Object storage like GCS comes with the hosted deployment; local disk is
# the self-host default.)
MEDIA_ROOT = BASE_DIR / "media"
MEDIA_URL = "/media/"

# Public base URL of the Next.js web app, used to build signing links.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
