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
from django.utils import timezone
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Account

log = logging.getLogger(__name__)

stripe.api_key = settings.STRIPE_SECRET_KEY


def _monthly_price() -> str:
    # Resolved at call time: STRIPE_PRICE_ID is the legacy monthly price.
    return settings.STRIPE_PRICE_ID_MONTHLY or settings.STRIPE_PRICE_ID


def _configured() -> bool:
    return bool(settings.STRIPE_SECRET_KEY and _monthly_price())


PLANS = ("monthly", "annual")


def _price_for(plan: str) -> str:
    if plan == "annual":
        return settings.STRIPE_PRICE_ID_ANNUAL
    return _monthly_price()


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


def _set_premium(
    account: Account,
    customer_id: str | None = None,
    subscription_id: str | None = None,
) -> None:
    """Activate (or renew) premium: tier on, billing in good standing."""
    fields = ["tier", "billing_status", "billing_suspended_at", "billing_expired_at"]
    account.tier = Account.Tier.PREMIUM
    account.billing_status = Account.BillingStatus.ACTIVE
    account.billing_suspended_at = None
    account.billing_expired_at = None
    if customer_id:
        account.stripe_customer_id = customer_id
        fields.append("stripe_customer_id")
    if subscription_id:
        account.stripe_subscription_id = subscription_id
        fields.append("stripe_subscription_id")
    account.save(update_fields=fields)


def _set_free(account: Account) -> None:
    account.tier = Account.Tier.FREE
    account.save(update_fields=["tier"])


def _suspend(account: Account) -> None:
    """Payment failed: premium features off, documents kept.

    The suspension clock starts at the FIRST failure; repeat failures
    while already suspended do not extend it.
    """
    if account.billing_status == Account.BillingStatus.SUSPENDED:
        return
    account.billing_status = Account.BillingStatus.SUSPENDED
    account.billing_suspended_at = timezone.now()
    account.save(update_fields=["billing_status", "billing_suspended_at"])


def _expire(account: Account) -> None:
    """Premium ended: tier off, documents kept for the purge window."""
    account.tier = Account.Tier.FREE
    account.billing_status = Account.BillingStatus.EXPIRED
    if account.billing_expired_at is None:
        account.billing_expired_at = timezone.now()
    account.save(
        update_fields=["tier", "billing_status", "billing_expired_at"]
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def checkout(request):
    """Start a Stripe Checkout subscription for the premium tier."""
    if not _configured():
        return _billing_disabled()
    account: Account = request.user
    if account.is_premium:
        return Response({"error": "already on the premium tier"}, status=409)
    plan = (request.data.get("plan") or "monthly").lower()
    if plan not in PLANS:
        return Response(
            {"error": "plan must be 'monthly' or 'annual'"}, status=400
        )
    price = _price_for(plan)
    if not price:
        return Response(
            {"error": f"the {plan} plan is not available on this server"},
            status=503,
        )
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
            line_items=[{"price": price, "quantity": 1}],
            success_url=f"{settings.FRONTEND_URL}/dashboard?upgraded=1",
            cancel_url=f"{settings.FRONTEND_URL}/dashboard",
            metadata={"account_id": str(account.id)},
            subscription_data={"metadata": {"account_id": str(account.id)}},
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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def pause(request):
    """Pause the subscription (Stripe pause_collection): premium
    features off, documents kept, no expiry clock. Resuming restores
    everything."""
    if not _configured():
        return _billing_disabled()
    account: Account = request.user
    if account.tier != Account.Tier.PREMIUM or not account.stripe_subscription_id:
        return Response({"error": "no active subscription to pause"}, status=409)
    if account.billing_status == Account.BillingStatus.PAUSED:
        return Response({"error": "subscription is already paused"}, status=409)
    try:
        stripe.Subscription.modify(
            account.stripe_subscription_id,
            pause_collection={"behavior": "void"},
        )
    except stripe.StripeError as exc:
        log.exception("stripe pause failed")
        return Response({"error": str(exc)}, status=502)
    account.billing_status = Account.BillingStatus.PAUSED
    account.save(update_fields=["billing_status"])
    return Response({"billing_status": account.billing_status})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def resume(request):
    """Resume a paused subscription."""
    if not _configured():
        return _billing_disabled()
    account: Account = request.user
    if account.billing_status != Account.BillingStatus.PAUSED:
        return Response({"error": "subscription is not paused"}, status=409)
    try:
        stripe.Subscription.modify(
            account.stripe_subscription_id, pause_collection=""
        )
    except stripe.StripeError as exc:
        log.exception("stripe resume failed")
        return Response({"error": str(exc)}, status=502)
    account.billing_status = Account.BillingStatus.ACTIVE
    account.save(update_fields=["billing_status"])
    return Response({"billing_status": account.billing_status})


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

    # construct_event returns a stripe Event object, not a dict, and
    # Event rejects dict methods like .get — convert once so the
    # dict-style access below works on real (unmocked) events.
    event = event.to_dict()

    etype = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}

    if etype == "checkout.session.completed":
        account = _account_from_event(obj)
        if account is not None:
            _set_premium(
                account, obj.get("customer"), obj.get("subscription")
            )
    elif etype == "invoice.paid":
        # Renewal: a successful payment restores a suspended account.
        account = _account_from_event(obj)
        if account is not None and (
            account.billing_status == Account.BillingStatus.SUSPENDED
            or account.tier == Account.Tier.PREMIUM
        ):
            _set_premium(
                account, obj.get("customer"), obj.get("subscription")
            )
    elif etype == "invoice.payment_failed":
        account = _account_from_event(obj)
        if account is not None and account.tier == Account.Tier.PREMIUM:
            _suspend(account)
    elif etype == "customer.subscription.deleted":
        account = _account_from_event(obj)
        if account is not None:
            _expire(account)
    elif etype == "customer.subscription.updated":
        account = _account_from_event(obj)
        if account is not None:
            if obj.get("id") and not account.stripe_subscription_id:
                account.stripe_subscription_id = obj["id"]
                account.save(update_fields=["stripe_subscription_id"])
            if obj.get("status") in ("canceled", "unpaid"):
                _expire(account)
            elif obj.get("pause_collection"):
                if account.billing_status != Account.BillingStatus.PAUSED:
                    account.billing_status = Account.BillingStatus.PAUSED
                    account.save(update_fields=["billing_status"])
            elif account.billing_status == Account.BillingStatus.PAUSED:
                account.billing_status = Account.BillingStatus.ACTIVE
                account.save(update_fields=["billing_status"])
    # Unknown event types: acknowledge, ignore.
    return HttpResponse(status=200)
