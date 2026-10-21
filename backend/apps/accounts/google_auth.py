"""Google ID-token verification for Google sign-in (scope §3.10).

Wraps google-auth's verifier behind one small function so the view (and
its tests, which stub this function) never touch the network library
directly. Only verified emails are returned: an unverified Google email
proves nothing about mailbox ownership, and the email is the account
key — account linking rides on it.
"""

from django.conf import settings
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token


def verify_google_id_token(token: str) -> dict:
    """Return {"email": ..., "name": ...} for a valid Google ID token.

    Raises ValueError on any failure: missing/expired/forged token,
    wrong audience, or an unverified email.
    """
    if not token:
        raise ValueError("missing ID token")
    try:
        claims = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), settings.GOOGLE_OAUTH_CLIENT_ID
        )
    except Exception as exc:
        raise ValueError("Google ID token verification failed") from exc
    if claims.get("email_verified") not in (True, "true"):
        raise ValueError("Google account email is not verified")
    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise ValueError("Google ID token carries no email")
    return {"email": email, "name": claims.get("name") or ""}
