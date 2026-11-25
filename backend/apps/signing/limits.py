"""Free-tier enforcement (scope §3.6).

Identity = the logged-in account when present, else the sender email (free
one-off sends, scope §3.10). Free tier: 1 pending document at a time,
100 MB total storage, 2 signers per document (the signer + the sender),
parallel signing only. Premium raises the storage cap, drops the
watermark, and lifts the per-document signer cap (up to 10 signers,
sequential or parallel).

Drafts (#89) have their own caps and never count toward the pending
limit: 3 drafts free, 10 premium.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email

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
    """Raise LimitExceeded if this identity may not start another draft.

    Starting a document creates a draft (#89): the draft cap applies
    here, not the pending limit - a draft only becomes pending at send
    time, where check_pending_limit runs instead.
    """
    check_draft_limit(account, sender_email)
    check_storage_limit(account, sender_email, upload_bytes)


def _is_premium(account) -> bool:
    return (
        account is not None
        and getattr(account, "is_authenticated", False)
        and account.is_premium
    )


def _draft_documents(account, sender_email):
    """This identity's drafts (account-owned, else anonymous by email)."""
    if account is not None and getattr(account, "is_authenticated", False):
        return Document.objects.filter(
            owner=account, status=Document.Status.DRAFT
        )
    return Document.objects.filter(
        owner__isnull=True,
        sender_email__iexact=(sender_email or "").strip(),
        status=Document.Status.DRAFT,
    )


def check_draft_limit(account, sender_email) -> None:
    """Draft caps (#89): 3 free, 10 premium. Drafts never count toward
    the 1-pending-document limit."""
    limit = (
        settings.PREMIUM_DRAFT_LIMIT
        if _is_premium(account)
        else settings.FREE_DRAFT_LIMIT
    )
    if _draft_documents(account, sender_email).count() >= limit:
        raise LimitExceeded(
            f"Draft limit reached ({limit} draft(s)). "
            "Send or discard a draft to start another."
        )


def _has_control_chars(value: str) -> bool:
    """Newlines and other control characters, which must never reach
    a stored name, email, or brand (they break invite delivery and
    can inject extra lines into the certificate)."""
    return any(ord(ch) < 32 or ord(ch) == 127 for ch in value)


def clean_signer_email(raw) -> str:
    """One signer email: stripped and validated with Django's
    validate_email (a bare '@' check accepts newlines). Raises
    ValueError with a user-facing message."""
    email = str(raw or "").strip()
    try:
        validate_email(email)
    except ValidationError:
        raise ValueError("each signer needs a valid email")
    return email


def clean_signer_name(raw) -> str:
    """One signer name: stripped; newlines/control characters are
    rejected. An empty name is fine (the email identifies the
    signer). Raises ValueError with a user-facing message."""
    name = str(raw or "").strip()
    if _has_control_chars(name):
        raise ValueError(
            "signer names must not contain newlines or control characters"
        )
    return name


def clean_signer_list(raw, sender_email, is_premium) -> list[dict]:
    """Validate a step-1 signer list (#89). Returns the cleaned list
    (name/email dicts, in order) or raises ValueError with a
    user-facing message.

    Free: 1–2 signers, and a second signer must be the sender
    themselves ("Send to me for signature also"). Premium: 1–10
    signers, any emails. Duplicate emails are rejected either way.
    """
    if not isinstance(raw, list) or not raw:
        raise ValueError("at least one signer is required")
    max_signers = 10 if is_premium else 2
    if len(raw) > max_signers:
        raise ValueError(
            f"at most {max_signers} signer(s)"
            + ("" if is_premium else " on the free tier - upgrade for more")
        )
    sender = (sender_email or "").strip().lower()
    cleaned = []
    seen = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValueError("each signer needs a name and an email")
        email = clean_signer_email(entry.get("email"))
        if email.lower() in seen:
            raise ValueError("each signer email can only appear once")
        seen.add(email.lower())
        cleaned.append(
            {"name": clean_signer_name(entry.get("name")), "email": email}
        )
    if not is_premium and len(cleaned) == 2 and sender not in seen:
        raise ValueError(
            "on the free tier the second signer must be you - "
            "use 'Send to me for signature also'"
        )
    return cleaned


def check_pending_limit(account, sender_email) -> None:
    # The free tier's "1 pending document" rule is keyed on the sender email
    # itself - not on whether there's an account. An email address gets one
    # pending document at a time, anonymous or logged in. Drafts are not
    # pending (#89), so they never count here; the check runs at send time.
    pending = Document.objects.filter(
        status=Document.Status.PENDING,
        sender_email__iexact=(sender_email or "").strip(),
    )
    if not _is_premium(account) and pending.count() >= settings.FREE_PENDING_DOC_LIMIT:
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


def check_can_create_session(document: Document, signer_email: str = "") -> None:
    """Per-document signer cap (#89): free documents allow a second
    session only for the sender themselves ("Send to me for signature
    also"); premium documents allow up to 10 sessions. The first
    session is always allowed."""
    count = document.sessions.count()
    if count == 0:
        return
    owner = document.owner
    if owner is not None and getattr(owner, "is_premium", False):
        if count >= 10:
            raise LimitExceeded("Premium documents allow up to 10 signers.")
        return
    if count == 1 and (signer_email or "").strip().lower() == (
        document.sender_email or ""
    ).strip().lower():
        return
    raise LimitExceeded(
        "Free tier allows up to 2 signers, and the second signer must "
        "be you - upgrade for more signers."
    )


def wants_watermark(document: Document) -> bool:
    """Free tier gets the watermark; premium documents don't."""
    owner = document.owner
    return not (
        owner is not None and getattr(owner, "is_premium", False)
    )
