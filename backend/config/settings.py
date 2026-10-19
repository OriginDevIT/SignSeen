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
    "apps.core",
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

REST_FRAMEWORK = {}

# File storage for uploads, evidence images, and sealed PDFs.
# (Object storage like GCS comes with the hosted deployment; local disk is
# the self-host default.)
MEDIA_ROOT = BASE_DIR / "media"
MEDIA_URL = "/media/"

# Public base URL of the Next.js web app, used to build signing links.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
