"""Send expiring-soon signing alerts (issue #9, scope §3.6).

Pending sessions whose signing link expires within 24 hours get one
factual email alert to the sender — only when the document belongs to
a premium account with alerts enabled (the gating lives in
notifications._alert_recipient). Each alerted session is stamped so
re-runs never resend. Run on a schedule, e.g. hourly:

    0 * * * * cd /app && python manage.py send_expiry_alerts
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.signing.models import SigningSession
from apps.signing.notifications import send_expiry_alert


class Command(BaseCommand):
    help = "Email senders whose pending signing links expire within 24 hours."

    def handle(self, *args, **options):
        now = timezone.now()
        horizon = now + timedelta(hours=24)
        candidates = SigningSession.objects.filter(
            status=SigningSession.Status.PENDING,
            expires_at__gt=now,
            expires_at__lte=horizon,
            expiry_alert_sent_at__isnull=True,
        ).select_related("document__owner")

        sent = 0
        for session in candidates:
            if send_expiry_alert(session.document, session):
                session.expiry_alert_sent_at = now
                session.save(update_fields=["expiry_alert_sent_at"])
                sent += 1

        self.stdout.write(f"sent {sent} expiry alert(s)")
