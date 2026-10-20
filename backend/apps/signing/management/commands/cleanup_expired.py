"""Expire stale signing sessions (free-tier 30-day rule, scope §3.6).

Sessions already refuse signatures past expiry (410 at request time), but
without this their rows sit in PENDING forever. Run nightly, e.g.:

    0 3 * * * cd /app && python manage.py cleanup_expired

Documents older than 30 days whose sessions are all settled are flagged
EXPIRED too. Files are NOT deleted — storage enforcement is a Phase 4
concern. Expiry is operational, not ceremonial, so no audit events are
recorded (the hash chain covers the signing ceremony itself).
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.signing.models import Document, SigningSession


class Command(BaseCommand):
    help = "Mark expired signing sessions (and stale pending documents) as expired."

    def handle(self, *args, **options):
        now = timezone.now()

        expired_sessions = SigningSession.objects.filter(
            status=SigningSession.Status.PENDING, expires_at__lt=now
        )
        n_sessions = expired_sessions.update(status=SigningSession.Status.EXPIRED)

        cutoff = now - timedelta(days=30)
        stale_docs = (
            Document.objects.filter(
                status=Document.Status.PENDING, created_at__lt=cutoff
            )
            .exclude(sessions__status=SigningSession.Status.PENDING)
            .distinct()
        )
        n_docs = stale_docs.update(status=Document.Status.EXPIRED)

        self.stdout.write(f"expired {n_sessions} session(s), {n_docs} document(s)")
