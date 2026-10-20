"""Django settings for the SignSeen API (Phase 0 scaffold)."""

import os
import urllib.parse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-key")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "*").split(",")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "rest_framework.authtoken",
    "apps.core",
    "apps.accounts",
    "apps.signing",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
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
PREMIUM_STORAGE_BYTES = int(
    os.environ.get("PREMIUM_STORAGE_BYTES", str(10 * 1024 * 1024 * 1024))
)

# --- Email (transactional: signed copies, password resets) ------------------
# Default backend prints to the server log; set EMAIL_HOST for real SMTP.
EMAIL_BACKEND = os.environ.get(
    "EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend"
)
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "1") == "1"
DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL", "SignSeen <hello@getsignseen.com>"
)

# --- Stripe billing (premium tier) ------------------------------------------
# All optional: with no keys set, billing endpoints answer 503 and the app
# runs free-tier only. STRIPE_PRICE_ID is the Price created in the Stripe
# dashboard; no amount is hardcoded here.
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

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
