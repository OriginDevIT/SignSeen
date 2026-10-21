"""Transactional email for the signing ceremony (scope §3.10).

On seal, the sender gets the signed PDF + audit receipt; the signer gets a
copy too if they left an email. Best-effort: failures are logged, never
raised — email must not fail a completed signing.
"""

import logging

from django.conf import settings
from django.core.mail import EmailMessage

from .models import Document

log = logging.getLogger(__name__)


def _brand_name(document) -> str:
    """The owning account's brand name, or "" for SignSeen defaults."""
    owner = document.owner
    return (owner.brand_name or "").strip() if owner is not None else ""


def _email_copy(document, audit_seal: str, recipient: str) -> None:
    track_url = f"{settings.FRONTEND_URL}/d/{document.id}"
    brand_name = _brand_name(document)
    # Branded sends (premium) open with the sender's brand; SignSeen
    # remains named as the platform. Default body otherwise.
    opening = f"{brand_name} — signed document via SignSeen\n\n" if brand_name else ""
    body = (
        f"{opening}"
        f'"{document.title}" has been signed.\n\n'
        f"Audit seal: {audit_seal}\n"
        f"Track status: {track_url}\n\n"
        "The signed PDF is attached."
    )
    with document.signed_file.open("rb") as f:
        pdf_bytes = f.read()
    msg = EmailMessage(
        subject=f"Signed: {document.title}",
        body=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient],
    )
    msg.attach(f"signed-{document.id}.pdf", pdf_bytes, "application/pdf")
    try:
        msg.send()
    except Exception:
        log.exception("failed to email sealed document to %s", recipient)


def send_sealed_notifications(document, session, audit_seal: str) -> None:
    """Seal-time copies: the sender plus every signer who left an email
    (multi-signer documents seal once, at the final signature, so all
    signers' copies go out here — including signers who left their
    email at their own completion step earlier in the sequence)."""
    recipients = []
    if document.sender_email:
        recipients.append(document.sender_email)
    seen = {r.lower() for r in recipients}
    sessions = document.sessions.all()
    if session is not None and all(s.pk != session.pk for s in sessions):
        sessions = [session, *sessions]
    for s in sessions:
        signer_email = (s.signer_email or "").strip()
        if signer_email and signer_email.lower() not in seen:
            recipients.append(signer_email)
            seen.add(signer_email.lower())

    for email in recipients:
        _email_copy(document, audit_seal, email)


# ---------------------------------------------------------------------------
# Signing alerts (issue #9, scope §3.6): premium, per-account opt-out,
# factual tone. The alert record is the audit event + the timestamp
# fields on the session (viewed_at / expiry_alert_sent_at); there is no
# separate alert log table. Best-effort like every mail here.
# ---------------------------------------------------------------------------


def _alert_recipient(document) -> str | None:
    """The sender address to alert, or None when alerts do not apply:
    the document must belong to an account that is premium and has
    alerts enabled (ownerless and free-tier documents never alert)."""
    owner = document.owner
    if owner is None or not owner.is_premium or not owner.alerts_enabled:
        return None
    return document.sender_email or owner.email


def _send_alert(document, subject: str, body: str) -> bool:
    recipient = _alert_recipient(document)
    if not recipient:
        return False
    msg = EmailMessage(
        subject=subject,
        body=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient],
    )
    try:
        msg.send()
    except Exception:
        log.exception("failed to send signing alert to %s", recipient)
        return False
    return True


def _track_url(document) -> str:
    return f"{settings.FRONTEND_URL}/d/{document.id}"


def send_viewed_alert(document, session) -> bool:
    """Email the sender that the signer opened the signing link."""
    body = (
        f'"{document.title}" was opened by the signer.\n\n'
        f"Track status: {_track_url(document)}\n"
    )
    return _send_alert(document, f"Viewed: {document.title}", body)


def send_expiry_alert(document, session) -> bool:
    """Email the sender that a pending signing link expires within
    about 24 hours, unless this session was already alerted."""
    body = (
        f'"{document.title}" is still waiting for a signature, and the '
        f"signing link expires at {session.expires_at.isoformat()} "
        f"(within about 24 hours).\n\n"
        f"Track status: {_track_url(document)}\n"
    )
    return _send_alert(document, f"Expiring soon: {document.title}", body)


def send_signer_copy(document, session, audit_seal: str) -> None:
    """Email the signer their copy after they leave an email at completion
    (scope §3.3: the email step happens on the Sealed screen, after the
    ceremony, so it cannot ride the seal-time notification).

    Multi-signer: if the document has not sealed yet there is no final
    PDF to send — the copy goes out at final seal via
    send_sealed_notifications, which covers every session's email."""
    signer_email = (session.signer_email or "").strip()
    if signer_email and document.signed_file:
        _email_copy(document, audit_seal, signer_email)


def send_signer_invite(document, session) -> None:
    """Invite a pre-defined signer to their signing session (#13).

    Complex documents are delivered by email: when a session with a
    signer_email becomes active — at creation if it is already usable,
    or when its predecessor signs in sequential mode — the signer gets
    their own signing link. Best-effort, like every notification here.
    """
    signer_email = (session.signer_email or "").strip()
    if not signer_email:
        return
    signing_url = f"{settings.FRONTEND_URL}/s/{session.token}"
    order_note = (
        " Signing happens in order; your link is active now."
        if document.signing_mode == Document.SigningMode.SEQUENTIAL
        and document.sessions.count() > 1
        else ""
    )
    body = (
        f"{session.signer_name or 'You'} are asked to sign "
        f'"{document.title}".\n\n'
        f"Your signing link: {signing_url}\n"
        f"{order_note}\n"
        "No account needed — open the link, complete your fields, and sign."
    )
    msg = EmailMessage(
        subject=f"Please sign: {document.title}",
        body=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[signer_email],
    )
    try:
        msg.send()
    except Exception:
        log.exception("failed to email signer invite to %s", signer_email)
