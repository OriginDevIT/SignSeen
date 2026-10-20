"""Free-tier enforcement (scope §3.6).

Identity = the logged-in account when present, else the sender email (free
one-off sends, scope §3.10). Free tier: 1 pending document at a time,
100 MB total storage, 1 signer per document. Premium raises the storage cap,
drops the watermark, and lifts the per-document signer cap (multi-signer
flow: sessions sign strictly sequentially by order).
"""

from django.conf import settings

from .models import Document


class LimitExceeded(Exception):
    """Raised when a freemium limit blocks an action. Message is user-facing."""


def _identity_documents(account, sender_email):
    """All documents belonging to this identity (account or email)."""
    if account is not None and getattr(account, "is_authenticated", False):
        return Document.objects.filter(owner=account)
    return Document.objects.filter(owner__isnull=True, sender_email=sender_email)


def storage_limit_bytes(account) -> int:
    if account is not None and getattr(account, "is_authenticated", False):
        if account.is_premium:
            return settings.PREMIUM_STORAGE_BYTES
    return settings.FREE_STORAGE_BYTES


def storage_used_bytes(account, sender_email) -> int:
    total = 0
    for doc in _identity_documents(account, sender_email).only(
        "original_file", "signed_file"
    ):
        if doc.original_file:
            total += doc.original_file.size
        if doc.signed_file:
            total += doc.signed_file.size
    return total


def check_can_create_document(account, sender_email, upload_bytes: int) -> None:
    """Raise LimitExceeded if this identity may not start another document."""
    check_pending_limit(account, sender_email)
    check_storage_limit(account, sender_email, upload_bytes)


def check_pending_limit(account, sender_email) -> None:
    # The free tier's "1 pending document" rule is keyed on the sender email
    # itself — not on whether there's an account. An email address gets one
    # pending document at a time, anonymous or logged in.
    pending = Document.objects.filter(
        status=Document.Status.PENDING,
        sender_email__iexact=(sender_email or "").strip(),
    )
    is_premium = (
        account is not None
        and getattr(account, "is_authenticated", False)
        and account.is_premium
    )
    if not is_premium and pending.count() >= settings.FREE_PENDING_DOC_LIMIT:
        raise LimitExceeded(
            "Free tier allows 1 document pending signature at a time. "
            "Wait for it to be signed or expired, or upgrade for more."
        )


def check_storage_limit(account, sender_email, additional_bytes: int) -> None:
    limit = storage_limit_bytes(account)
    if storage_used_bytes(account, sender_email) + additional_bytes > limit:
        raise LimitExceeded(
            f"Storage limit reached ({limit // (1024 * 1024)} MB). "
            "Delete old documents or upgrade for more storage."
        )


def check_can_create_session(document: Document) -> None:
    """One signing session per document; premium documents may add more
    signers (each new session takes the next position in signing order)."""
    if not document.sessions.exists():
        return
    owner = document.owner
    if owner is not None and getattr(owner, "is_premium", False):
        return
    raise LimitExceeded("This document already has a signing session.")


def wants_watermark(document: Document) -> bool:
    """Free tier gets the watermark; premium documents don't."""
    owner = document.owner
    return not (
        owner is not None and getattr(owner, "is_premium", False)
    )
