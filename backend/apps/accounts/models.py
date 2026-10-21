"""Sender accounts (scope §3.10).

Signers never have accounts. Senders get one only for the storage tier:
dashboard, document library, billing. Login is email + password (scope
§3.10); API access uses DRF token auth so the Next.js app can call the API
cross-origin in local dev and same-origin behind the staging proxy.
"""

import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models


class AccountManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("email is required")
        email = self.normalize_email(email).lower()
        account = self.model(email=email, **extra)
        account.set_password(password)
        account.save(using=self._db)
        return account

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(email, password, **extra)


class Account(AbstractBaseUser, PermissionsMixin):
    class Tier(models.TextChoices):
        FREE = "free", "Free"
        PREMIUM = "premium", "Premium"

    class BillingStatus(models.TextChoices):
        ACTIVE = "active", "Active"
        # Payment failed: premium features suspended, documents kept.
        # 180 days suspended -> expired (see enforce_billing_lifecycle).
        SUSPENDED = "suspended", "Suspended (payment failed)"
        # Account holder paused the subscription: features off, data
        # kept, no expiry clock.
        PAUSED = "paused", "Paused"
        # Premium ended: documents kept 180 more days, then purged.
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    tier = models.CharField(
        max_length=16, choices=Tier.choices, default=Tier.FREE
    )
    stripe_customer_id = models.CharField(
        max_length=255, blank=True, default=""
    )
    stripe_subscription_id = models.CharField(
        max_length=255, blank=True, default=""
    )
    billing_status = models.CharField(
        max_length=16,
        choices=BillingStatus.choices,
        default=BillingStatus.ACTIVE,
    )
    billing_suspended_at = models.DateTimeField(null=True, blank=True)
    billing_expired_at = models.DateTimeField(null=True, blank=True)
    # Custom branding (premium; scope §3.6). Shown on the signing
    # ceremony, the sealed-PDF certificate page, and transactional
    # emails for documents this account owns. Blank = SignSeen defaults.
    # brand_color is stored as #RRGGBB; the format is enforced by the
    # branding API (a model validator alone does not run on save).
    brand_name = models.CharField(max_length=120, blank=True, default="")
    brand_color = models.CharField(max_length=7, blank=True, default="")
    brand_logo = models.FileField(upload_to="branding/", null=True, blank=True)
    # Signing alerts (viewed / expiring-soon emails) are a premium
    # feature; accounts can opt out. Default on for premium accounts.
    alerts_enabled = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AccountManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    @property
    def is_premium(self) -> bool:
        """Premium FEATURES gate: premium tier in good billing standing.

        Suspended (payment failed) and paused accounts keep their tier
        and their documents but lose premium features until they renew
        or resume.
        """
        return (
            self.tier == self.Tier.PREMIUM
            and self.billing_status == self.BillingStatus.ACTIVE
        )

    def __str__(self) -> str:
        return f"{self.email} ({self.tier})"
