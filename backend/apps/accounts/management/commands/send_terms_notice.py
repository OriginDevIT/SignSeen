"""Email account holders about an upcoming terms change (issue #210).

Terms section 10 promises account holders are emailed at least 14
days before material terms changes take effect. Run when new terms
are posted, with the new version (the "last updated" date) and the
date they take effect:

    python manage.py send_terms_notice --terms-version 2026-11-25 --effective-date 2026-12-09

The notice is recorded so re-running the command for the same version
never re-sends; a new version sends again. No GHL involvement.
"""

from datetime import date, timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.accounts.models import Account, TermsNotice

MIN_NOTICE_DAYS = 14


class Command(BaseCommand):
    help = "Email all account holders about an upcoming terms change."

    def add_arguments(self, parser):
        parser.add_argument(
            "--terms-version",
            required=True,
            help='Terms version, e.g. the "last updated" date "2026-11-25".',
        )
        parser.add_argument(
            "--effective-date",
            required=True,
            help="Date the new terms take effect (YYYY-MM-DD), "
            "at least 14 days out.",
        )

    def handle(self, *args, **options):
        try:
            effective = date.fromisoformat(options["effective_date"])
        except ValueError:
            raise CommandError("effective date must be YYYY-MM-DD")
        earliest = timezone.now().date() + timedelta(days=MIN_NOTICE_DAYS)
        if effective < earliest:
            raise CommandError(
                f"effective date must be at least {MIN_NOTICE_DAYS} days out "
                f"(earliest {earliest}); the Terms promise 14 days notice"
            )
        notice, _ = TermsNotice.objects.get_or_create(
            version=options["terms_version"],
            defaults={"effective_date": effective},
        )
        if notice.notified_at is not None:
            self.stdout.write(
                f"terms {notice.version} notice already sent "
                f"({notice.notified_at}); nothing to do"
            )
            return
        if notice.effective_date != effective:
            # Version reused with a different effective date, and the
            # notice never went out: update the record and send.
            notice.effective_date = effective
            notice.save(update_fields=["effective_date"])
        subject = "Upcoming changes to the SignSeen Terms of Service"
        body = (
            "The SignSeen Terms of Service are changing.\n\n"
            f"New version: {notice.version}\n"
            f"Effective: {notice.effective_date}\n\n"
            "Read the updated Terms here:\n\n"
            f"{settings.FRONTEND_URL}/terms\n\n"
            "Continued use after the effective date means acceptance."
        )
        recipients = Account.objects.filter(is_active=True).values_list(
            "email", flat=True
        )
        failed = []
        sent = 0
        for email in recipients:
            try:
                send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [email])
            except Exception:
                failed.append(email)
            else:
                sent += 1
        if failed:
            self.stderr.write(
                f"failed to email {len(failed)} account holder(s)"
            )
            raise CommandError(
                "some notices failed to send; notice not recorded"
            )
        notice.notified_at = timezone.now()
        notice.save(update_fields=["notified_at"])
        self.stdout.write(
            f"sent terms {notice.version} notice to {sent} account holder(s)"
        )
