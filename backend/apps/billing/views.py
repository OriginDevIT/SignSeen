"""Stripe billing for the premium tier (scope §3.6).

Premium = storage/library, multi-signer (flow deferred), status dashboard,
alerts (deferred), no watermark, higher limits, custom branding (deferred).

All Stripe config comes from env vars (see settings); with no keys set the
endpoints answer 503 and the app runs free-tier only. The price lives in the
Stripe dashboard (STRIPE_PRICE_ID) — no amount is hardcoded here.
"""

import logging

import stripe
from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Account

log = logging.getLogger(__name__)

stripe.api_key = settings.STRIPE_SECRET_KEY


def _configured() -> bool:
    return bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_PRICE_ID)


def _billing_disabled():
    return Response(
        {"error": "billing is not configured on this server"}, status=503
    )


def _account_from_event(obj: dict) -> Account | None:
    """Find the account for a Stripe object, via metadata or customer id."""
    metadata = obj.get("metadata") or {}
    account_id = metadata.get("account_id")
    if account_id:
        try:
            return Account.objects.get(pk=account_id)
        except Account.DoesNotExist:
            pass
    customer_id = obj.get("customer")
    if customer_id:
        return Account.objects.filter(stripe_customer_id=customer_id).first()
    return None


def _set_premium(account: Account, customer_id: str | None = None) -> None:
    fields = ["tier"]
    account.tier = Account.Tier.PREMIUM
    if customer_id:
        account.stripe_customer_id = customer_id
        fields.append("stripe_customer_id")
    account.save(update_fields=fields)


def _set_free(account: Account) -> None:
    account.tier = Account.Tier.FREE
    account.save(update_fields=["tier"])


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def checkout(request):
    """Start a Stripe Checkout subscription for the premium tier."""
    if not _configured():
        return _billing_disabled()
    account: Account = request.user
    if account.is_premium:
        return Response({"error": "already on the premium tier"}, status=409)
    try:
        if not account.stripe_customer_id:
            customer = stripe.Customer.create(
                email=account.email,
                metadata={"account_id": str(account.id)},
            )
            account.stripe_customer_id = customer.id
            account.save(update_fields=["stripe_customer_id"])
        session = stripe.checkout.Session.create(
            customer=account.stripe_customer_id,
            mode="subscription",
            line_items=[{"price": settings.STRIPE_PRICE_ID, "quantity": 1}],
            success_url=f"{settings.FRONTEND_URL}/dashboard?upgraded=1",
            cancel_url=f"{settings.FRONTEND_URL}/dashboard",
            metadata={"account_id": str(account.id)},
        )
    except stripe.StripeError as exc:
        log.exception("stripe checkout failed")
        return Response({"error": str(exc)}, status=502)
    return Response({"url": session.url})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def portal(request):
    """Billing portal: let the customer manage/cancel their subscription."""
    if not _configured():
        return _billing_disabled()
    account: Account = request.user
    if not account.stripe_customer_id:
        return Response({"error": "no billing account yet"}, status=409)
    try:
        session = stripe.billing_portal.Session.create(
            customer=account.stripe_customer_id,
            return_url=f"{settings.FRONTEND_URL}/dashboard",
        )
    except stripe.StripeError as exc:
        log.exception("stripe portal failed")
        return Response({"error": str(exc)}, status=502)
    return Response({"url": session.url})


@csrf_exempt
def webhook(request):
    """Stripe event receiver. Signature-verified; never trust the payload."""
    if request.method != "POST":
        return HttpResponse(status=405)
    if not settings.STRIPE_WEBHOOK_SECRET:
        return HttpResponse(status=503)
    sig = request.META.get("HTTP_STRIPE_SIGNATURE", "")
    try:
        event = stripe.Webhook.construct_event(
            request.body, sig, settings.STRIPE_WEBHOOK_SECRET
        )
    except Exception:
        return HttpResponse(status=400)

    etype = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}

    if etype == "checkout.session.completed":
        account = _account_from_event(obj)
        if account is not None:
            _set_premium(account, obj.get("customer"))
    elif etype == "customer.subscription.deleted":
        account = _account_from_event(obj)
        if account is not None:
            _set_free(account)
    elif etype == "customer.subscription.updated":
        if obj.get("status") in ("canceled", "unpaid"):
            account = _account_from_event(obj)
            if account is not None:
                _set_free(account)
    # Unknown event types: acknowledge, ignore.
    return HttpResponse(status=200)
