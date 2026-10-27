"""Billing lifecycle enforcement (issue #36) — run daily from cron.

Premium lifecycle rules:
- payment failed -> SUSPENDED (premium features off, documents kept)
- suspended for BILLING_SUSPENSION_DAYS (180) -> EXPIRED (subscription
  cancelled at Stripe, tier reverts to free, documents still kept)
- expired for BILLING_PURGE_DAYS (180) -> stored documents PURGED
  (files and records deleted)

Webhook transitions live in apps.billing.views; this command only
applies the time-based ones. Safe to run repeatedly (idempotent).
"""

import logging
from datetime import timedelta

import stripe
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import Account
from apps.signing.models import Document

log = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        "Expire premium accounts suspended for 180+ days and purge the "
        "stored documents of accounts expired for 180+ days."
    )

    def handle(self, *args, **options):
        now = timezone.now()
        suspension_cutoff = now - timedelta(days=settings.BILLING_SUSPENSION_DAYS)
        purge_cutoff = now - timedelta(days=settings.BILLING_PURGE_DAYS)

        expired = 0
        stale_suspended = Account.objects.filter(
            billing_status=Account.BillingStatus.SUSPENDED,
            billing_suspended_at__lte=suspension_cutoff,
        )
        for account in stale_suspended:
            if account.stripe_subscription_id and settings.STRIPE_SECRET_KEY:
                stripe.api_key = settings.STRIPE_SECRET_KEY
                try:
                    stripe.Subscription.cancel(account.stripe_subscription_id)
                except stripe.StripeError:
                    log.warning(
                        "could not cancel subscription %s for %s; expiring anyway",
                        account.stripe_subscription_id,
                        account.email,
                    )
            account.tier = Account.Tier.FREE
            account.billing_status = Account.BillingStatus.EXPIRED
            account.billing_expired_at = now
            account.save(
                update_fields=["tier", "billing_status", "billing_expired_at"]
            )
            expired += 1

        purged_accounts = 0
        purged_documents = 0
        long_expired = Account.objects.filter(
            billing_status=Account.BillingStatus.EXPIRED,
            billing_expired_at__lte=purge_cutoff,
        )
        for account in long_expired:
            documents = list(Document.objects.filter(owner=account))
            for document in documents:
                if document.original_file:
                    document.original_file.delete(save=False)
                if document.signed_file:
                    document.signed_file.delete(save=False)
                document.delete()  # cascades sessions + audit events
                purged_documents += 1
            if documents:
                purged_accounts += 1

        self.stdout.write(
            f"expired={expired} purged_accounts={purged_accounts} "
            f"purged_documents={purged_documents}"
        )
