"""Regression tests for blank env values crashing settings import (#49).

PR #46's compose passthrough set PREMIUM_STORAGE_BYTES to an empty
string on staging; int(os.environ.get(...)) only falls back when the
variable is ABSENT, so int('') raised ValueError at settings import
and the api container crash-looped. _env_int treats blank as unset.
"""

import os
import subprocess
import sys

import pytest

from config.settings import _env_int

INT_ENV_VARS = [
    "PREMIUM_STORAGE_BYTES",
    "EMAIL_PORT",
    "DJANGO_HSTS_SECONDS",
    "BILLING_SUSPENSION_DAYS",
    "BILLING_PURGE_DAYS",
    "LOGIN_MAX_FAILED_ATTEMPTS",
    "LOGIN_FAILURE_WINDOW_SECONDS",
]


def test_missing_returns_default(monkeypatch):
    monkeypatch.delenv("SS_TEST_INT", raising=False)
    assert _env_int("SS_TEST_INT", 42) == 42


def test_blank_returns_default(monkeypatch):
    monkeypatch.setenv("SS_TEST_INT", "")
    assert _env_int("SS_TEST_INT", 42) == 42
    monkeypatch.setenv("SS_TEST_INT", "   ")
    assert _env_int("SS_TEST_INT", 42) == 42


def test_value_is_parsed(monkeypatch):
    monkeypatch.setenv("SS_TEST_INT", "123")
    assert _env_int("SS_TEST_INT", 42) == 123


def test_garbage_still_raises(monkeypatch):
    # Fail loud on a real misconfiguration; only blank means unset.
    monkeypatch.setenv("SS_TEST_INT", "abc")
    with pytest.raises(ValueError):
        _env_int("SS_TEST_INT", 42)


def test_settings_import_with_blank_int_env_vars():
    """The exact staging crash: every int-parsed variable set to ''."""
    env = dict(os.environ, DJANGO_SETTINGS_MODULE="config.settings")
    env.pop("DATABASE_URL", None)
    for name in INT_ENV_VARS:
        env[name] = ""
    result = subprocess.run(
        [sys.executable, "-c", "import django; django.setup(); print('ok')"],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert "ok" in result.stdout
