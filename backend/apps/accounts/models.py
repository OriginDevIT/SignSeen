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

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    tier = models.CharField(
        max_length=16, choices=Tier.choices, default=Tier.FREE
    )
    stripe_customer_id = models.CharField(
        max_length=255, blank=True, default=""
    )
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AccountManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    @property
    def is_premium(self) -> bool:
        return self.tier == self.Tier.PREMIUM

    def __str__(self) -> str:
        return f"{self.email} ({self.tier})"
