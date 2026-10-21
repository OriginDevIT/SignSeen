"""Core signing ceremony models.

A Document is uploaded by a sender. A SigningSession is the per-signer,
token-addressed ceremony (the QR code / link target). AuditEvents form a
hash-chained, tamper-evident trail of everything that happened.
"""

import secrets
import uuid
from datetime import timedelta

from django.db import models
from django.utils import timezone


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def default_session_expiry():
    return timezone.now() + timedelta(days=30)


class Document(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SIGNED = "signed", "Signed"
        EXPIRED = "expired", "Expired"

    class Source(models.TextChoices):
        UPLOAD = "upload", "Upload"
        URL = "url", "URL"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    original_file = models.FileField(upload_to="originals/")
    original_filename = models.CharField(max_length=255, default="", blank=True)
    source = models.CharField(
        max_length=16, choices=Source.choices, default=Source.UPLOAD
    )
    source_url = models.URLField(blank=True, default="")
    signed_file = models.FileField(upload_to="signed/", null=True, blank=True)
    sender_email = models.EmailField()
    # Owning account for storage-tier senders; null = free one-off send
    # (identity is the sender email). Set when created while logged in.
    owner = models.ForeignKey(
        "accounts.Account",
        related_name="documents",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


class SigningSession(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SIGNED = "signed", "Signed"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document, related_name="sessions", on_delete=models.CASCADE
    )
    token = models.CharField(max_length=64, unique=True, default=generate_token)
    signer_name = models.CharField(max_length=255, blank=True, default="")
    signer_email = models.EmailField(blank=True, default="")
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING
    )
    expires_at = models.DateTimeField(default=default_session_expiry)
    # Signing alerts: first time the signer opened the link, and when
    # the expiring-soon (24h) alert was sent. Null = not yet.
    viewed_at = models.DateTimeField(null=True, blank=True)
    expiry_alert_sent_at = models.DateTimeField(null=True, blank=True)
    # v1 device evidence: normalized snapshot of the signer's device at
    # submit time (user agent, platform, screen, tz offset). The raw
    # client payload stays in the audit trail; this is the queryable copy.
    device_evidence = models.JSONField(default=dict, blank=True)
    # Reserved for future passkey-bound sessions (WebAuthn). Unused in v1.
    webauthn_credential_id = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    def is_usable(self) -> bool:
        """A session can accept a signature iff pending and unexpired."""
        return (
            self.status == self.Status.PENDING
            and timezone.now() < self.expires_at
        )

    def __str__(self) -> str:
        return f"session {self.id} for {self.document_id} ({self.status})"


class AuditEvent(models.Model):
    """One link in the hash-chained audit trail.

    `hash` covers (prev_hash, timestamp, event_type, payload): any tampering
    with an earlier event breaks every later link. Images themselves are
    stored as files; the payload carries their SHA-256 digests.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        SigningSession, related_name="events", on_delete=models.CASCADE
    )
    event_type = models.CharField(max_length=64)
    payload = models.JSONField(default=dict)
    prev_hash = models.CharField(max_length=64)
    hash = models.CharField(max_length=64)
    # default= (not auto_now_add) so record_event can set the exact
    # timestamp that went into the hash.
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.event_type} @ {self.created_at.isoformat()}"
