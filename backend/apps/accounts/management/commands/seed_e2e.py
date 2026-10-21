"""Seed the deterministic accounts the E2E suite signs in with.

Guarded by the ENABLE_E2E_FIXTURES setting (set only by
docker-compose.test.yml): the command refuses to run anywhere else, so
these known-password accounts can never appear in staging/production.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import Account

FIXTURES = [
    ("e2e-free@example.com", Account.Tier.FREE),
    ("e2e-premium@example.com", Account.Tier.PREMIUM),
]
PASSWORD = "e2e-password-123"


class Command(BaseCommand):
    help = "Create/update the E2E fixture accounts (test stacks only)."

    def handle(self, *args, **options):
        if not settings.ENABLE_E2E_FIXTURES:
            raise CommandError(
                "ENABLE_E2E_FIXTURES is not set — refusing to seed "
                "known-password accounts outside a test stack."
            )
        for email, tier in FIXTURES:
            account, created = Account.objects.get_or_create(email=email)
            account.tier = tier
            account.set_password(PASSWORD)
            account.save()
            self.stdout.write(
                f"{'created' if created else 'updated'} {email} ({tier})"
            )
