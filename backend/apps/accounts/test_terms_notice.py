"""Tests for the terms-change notice command (issue #210)."""

from datetime import timedelta

import pytest
from django.core import mail
from django.core.management import CommandError, call_command
from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import Account, TermsNotice

LOC_MEM = override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)


def future(days=15):
    return (timezone.now().date() + timedelta(days=days)).isoformat()


def make_account(email, is_active=True):
    return Account.objects.create_user(
        email=email, password="password-123", is_active=is_active
    )


@pytest.mark.django_db
@LOC_MEM
def test_command_sends_to_active_account_holders():
    make_account("a@example.com")
    make_account("b@example.com")
    make_account("gone@example.com", is_active=False)
    call_command(
        "send_terms_notice",
        "--terms-version",
        "2026-11-25",
        "--effective-date",
        future(),
    )
    assert [m.to for m in mail.outbox] == [["a@example.com"], ["b@example.com"]]
    assert (
        mail.outbox[0].subject
        == "Upcoming changes to the SignSeen Terms of Service"
    )
    assert "2026-11-25" in mail.outbox[0].body
    assert future() in mail.outbox[0].body
    assert "/terms" in mail.outbox[0].body
    notice = TermsNotice.objects.get(version="2026-11-25")
    assert notice.notified_at is not None


@pytest.mark.django_db
@LOC_MEM
def test_second_run_for_same_version_does_not_resend():
    make_account("a@example.com")
    args = ("--terms-version", "2026-11-25", "--effective-date", future())
    call_command("send_terms_notice", *args)
    assert len(mail.outbox) == 1
    call_command("send_terms_notice", *args)
    assert len(mail.outbox) == 1


@pytest.mark.django_db
@LOC_MEM
def test_new_version_sends_again():
    make_account("a@example.com")
    call_command(
        "send_terms_notice",
        "--terms-version",
        "2026-11-25",
        "--effective-date",
        future(),
    )
    assert len(mail.outbox) == 1
    call_command(
        "send_terms_notice",
        "--terms-version",
        "2026-12-01",
        "--effective-date",
        future(),
    )
    assert len(mail.outbox) == 2
    assert "2026-12-01" in mail.outbox[1].body


@pytest.mark.django_db
@LOC_MEM
def test_effective_date_under_14_days_is_refused():
    make_account("a@example.com")
    too_soon = future(days=5)
    with pytest.raises(CommandError):
        call_command(
            "send_terms_notice",
            "--terms-version",
            "2026-11-25",
            "--effective-date",
            too_soon,
        )
    assert mail.outbox == []
    assert not TermsNotice.objects.filter(version="2026-11-25").exists()
    past = (timezone.now().date() - timedelta(days=1)).isoformat()
    with pytest.raises(CommandError):
        call_command(
            "send_terms_notice",
            "--terms-version",
            "2026-11-25",
            "--effective-date",
            past,
        )
    assert mail.outbox == []
