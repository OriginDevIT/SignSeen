"""Transactional email for the signing ceremony (scope §3.10).

On seal, the sender gets the signed PDF + audit receipt; the signer gets a
copy too if they left an email. Best-effort: failures are logged, never
raised — email must not fail a completed signing.
"""

import logging

from django.conf import settings
from django.core.mail import EmailMessage

log = logging.getLogger(__name__)


def send_sealed_notifications(document, session, audit_seal: str) -> None:
    recipients = []
    if document.sender_email:
        recipients.append(document.sender_email)
    signer_email = (session.signer_email or "").strip()
    if signer_email and signer_email.lower() != document.sender_email.lower():
        recipients.append(signer_email)
    if not recipients:
        return

    track_url = f"{settings.FRONTEND_URL}/d/{document.id}"
    body = (
        f'"{document.title}" has been signed.\n\n'
        f"Audit seal: {audit_seal}\n"
        f"Track status: {track_url}\n\n"
        "The signed PDF is attached."
    )
    with document.signed_file.open("rb") as f:
        pdf_bytes = f.read()

    for email in recipients:
        msg = EmailMessage(
            subject=f"Signed: {document.title}",
            body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[email],
        )
        msg.attach(f"signed-{document.id}.pdf", pdf_bytes, "application/pdf")
        try:
            msg.send()
        except Exception:
            log.exception("failed to email sealed document to %s", email)
