"""Account API: signup, login, logout, me, password reset.

Tokens are DRF authtokens (``Authorization: Token <key>``), which work
cross-origin for the Next.js app without cookie/CORS plumbing.
"""

from django.contrib.auth import authenticate
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.mail import send_mail
from django.conf import settings
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .google_auth import verify_google_id_token
from .models import Account


def _claim_documents(account: Account) -> None:
    """Attach this email's unattached documents to the account.

    Free one-off sends are keyed by sender email with no owner (scope
    §3.10). When that sender signs up or logs in, those documents become
    theirs — otherwise they'd block sends (the pending limit is keyed on
    email) while never appearing in their dashboard.
    """
    from apps.signing.models import Document

    Document.objects.filter(
        owner__isnull=True, sender_email__iexact=account.email
    ).update(owner=account)

_token_generator = PasswordResetTokenGenerator()


def _error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": message}, status=code)


def _account_payload(account: Account) -> dict:
    return {
        "id": str(account.id),
        "email": account.email,
        "tier": account.tier,
        "is_premium": account.is_premium,
    }


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def signup(request):
    email = (request.data.get("email") or "").strip().lower()
    password = request.data.get("password") or ""
    if "@" not in email:
        return _error("a valid email is required")
    if len(password) < 10:
        return _error("password must be at least 10 characters")
    if Account.objects.filter(email=email).exists():
        return _error("an account with this email already exists", 409)
    account = Account.objects.create_user(email=email, password=password)
    _claim_documents(account)
    token, _ = Token.objects.get_or_create(user=account)
    return Response(
        {"token": token.key, "account": _account_payload(account)},
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def login(request):
    email = (request.data.get("email") or "").strip().lower()
    password = request.data.get("password") or ""
    account = authenticate(request, username=email, password=password)
    if account is None:
        # Same message for unknown email vs wrong password (no enumeration).
        return _error("invalid email or password", 401)
    _claim_documents(account)
    token, _ = Token.objects.get_or_create(user=account)
    return Response({"token": token.key, "account": _account_payload(account)})


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def google_login(request):
    """Sign up / log in with Google (scope §3.10).

    The Google ID token is verified server-side; the account is keyed
    by its verified email, so a Google sign-in for an existing password
    account links to that account (same id, tier, and library) instead
    of creating a duplicate. New accounts get an unusable password —
    they can set one later via password reset.
    """
    if not settings.GOOGLE_OAUTH_CLIENT_ID:
        return _error("google sign-in is not configured on this server", 503)
    try:
        identity = verify_google_id_token(request.data.get("id_token") or "")
    except ValueError:
        return _error("invalid google credential", 401)
    account = Account.objects.filter(email=identity["email"]).first()
    if account is None:
        account = Account.objects.create_user(email=identity["email"])
    _claim_documents(account)
    token, _ = Token.objects.get_or_create(user=account)
    return Response({"token": token.key, "account": _account_payload(account)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response({"status": "logged out"})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(_account_payload(request.user))


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def password_reset(request):
    """Email a reset link. Always 200 — never reveal whether the email exists."""
    email = (request.data.get("email") or "").strip().lower()
    try:
        account = Account.objects.get(email=email, is_active=True)
    except Account.DoesNotExist:
        return Response({"status": "ok"})
    uid = urlsafe_base64_encode(force_bytes(str(account.pk)))
    token = _token_generator.make_token(account)
    reset_url = (
        f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
    )
    send_mail(
        "Reset your SignSeen password",
        f"Reset your password here (valid 24 hours):\n\n{reset_url}\n\n"
        "If you didn't ask for this, ignore this email.",
        settings.DEFAULT_FROM_EMAIL,
        [email],
        fail_silently=True,
    )
    return Response({"status": "ok"})


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def password_reset_confirm(request):
    uid = request.data.get("uid") or ""
    token = request.data.get("token") or ""
    password = request.data.get("password") or ""
    if len(password) < 10:
        return _error("password must be at least 10 characters")
    try:
        pk = force_str(urlsafe_base64_decode(uid))
        account = Account.objects.get(pk=pk, is_active=True)
    except (ValueError, Account.DoesNotExist):
        return _error("invalid or expired reset link")
    if not _token_generator.check_token(account, token):
        return _error("invalid or expired reset link")
    account.set_password(password)
    account.save(update_fields=["password"])
    # Invalidate existing API tokens on password change.
    Token.objects.filter(user=account).delete()
    return Response({"status": "password updated"})
