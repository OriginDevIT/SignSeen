"""Tests for Stripe billing: checkout, portal, webhooks (all mocked)."""

from unittest import mock

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Account

STRIPE_ENV = {
    "STRIPE_SECRET_KEY": "sk_test_x",
    "STRIPE_PRICE_ID": "price_x",
    "STRIPE_WEBHOOK_SECRET": "whsec_x",
}


def authed_client():
    client = APIClient()
    account = Account.objects.create_user(
        email="payer@example.com", password="longpassword1"
    )
    token = client.post(
        "/api/auth/login/",
        {"email": "payer@example.com", "password": "longpassword1"},
        format="json",
    ).json()["token"]
    client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
    return client, account


@pytest.mark.django_db
def test_checkout_disabled_without_keys():
    client, _ = authed_client()
    assert client.post("/api/billing/checkout/").status_code == 503


@pytest.mark.django_db
@override_settings(**STRIPE_ENV)
def test_checkout_creates_customer_and_session():
    client, account = authed_client()
    with mock.patch("apps.billing.views.stripe.Customer.create") as create_cust, mock.patch(
        "apps.billing.views.stripe.checkout.Session.create"
    ) as create_session:
        create_cust.return_value = mock.Mock(id="cus_123")
        create_session.return_value = mock.Mock(url="https://checkout.stripe/x")
        response = client.post("/api/billing/checkout/")
    assert response.status_code == 200
    assert response.json()["url"] == "https://checkout.stripe/x"
    account.refresh_from_db()
    assert account.stripe_customer_id == "cus_123"


@pytest.mark.django_db
@override_settings(**STRIPE_ENV)
def test_checkout_rejected_when_already_premium():
    client, account = authed_client()
    account.tier = Account.Tier.PREMIUM
    account.save(update_fields=["tier"])
    assert client.post("/api/billing/checkout/").status_code == 409


def _webhook_event(etype, obj):
    return {"type": etype, "data": {"object": obj}}


@pytest.mark.django_db
@override_settings(**STRIPE_ENV)
def test_webhook_upgrades_on_checkout_completed():
    account = Account.objects.create_user(
        email="w@example.com", password="longpassword1"
    )
    client = APIClient()
    event = _webhook_event(
        "checkout.session.completed",
        {"customer": "cus_9", "metadata": {"account_id": str(account.id)}},
    )
    with mock.patch(
        "apps.billing.views.stripe.Webhook.construct_event", return_value=event
    ):
        response = client.post(
            "/api/billing/webhook/", {"x": 1}, format="json",
            HTTP_STRIPE_SIGNATURE="sig",
        )
    assert response.status_code == 200
    account.refresh_from_db()
    assert account.tier == Account.Tier.PREMIUM
    assert account.stripe_customer_id == "cus_9"


@pytest.mark.django_db
@override_settings(**STRIPE_ENV)
def test_webhook_downgrades_on_subscription_deleted():
    account = Account.objects.create_user(
        email="w2@example.com", password="longpassword1"
    )
    account.tier = Account.Tier.PREMIUM
    account.stripe_customer_id = "cus_9"
    account.save()
    client = APIClient()
    event = _webhook_event("customer.subscription.deleted", {"customer": "cus_9"})
    with mock.patch(
        "apps.billing.views.stripe.Webhook.construct_event", return_value=event
    ):
        response = client.post(
            "/api/billing/webhook/", {"x": 1}, format="json",
            HTTP_STRIPE_SIGNATURE="sig",
        )
    assert response.status_code == 200
    account.refresh_from_db()
    assert account.tier == Account.Tier.FREE


@pytest.mark.django_db
@override_settings(**STRIPE_ENV)
def test_webhook_rejects_bad_signature():
    client = APIClient()
    with mock.patch(
        "apps.billing.views.stripe.Webhook.construct_event",
        side_effect=ValueError("bad sig"),
    ):
        response = client.post(
            "/api/billing/webhook/", {"x": 1}, format="json",
            HTTP_STRIPE_SIGNATURE="bogus",
        )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Dual pricing + lifecycle (issue #36)
# ---------------------------------------------------------------------------

PRICE_ENV = {
    "STRIPE_SECRET_KEY": "sk_test_x",
    "STRIPE_PRICE_ID_MONTHLY": "price_monthly",
    "STRIPE_PRICE_ID_ANNUAL": "price_annual",
    "STRIPE_WEBHOOK_SECRET": "whsec_x",
}


def _post_event(client, event):
    with mock.patch(
        "apps.billing.views.stripe.Webhook.construct_event", return_value=event
    ):
        return client.post(
            "/api/billing/webhook/", {"x": 1}, format="json",
            HTTP_STRIPE_SIGNATURE="sig",
        )


def _premium_account(email="life@example.com"):
    account = Account.objects.create_user(email=email, password="<redacted>")
    account.tier = Account.Tier.PREMIUM
    account.stripe_customer_id = "cus_life"
    account.stripe_subscription_id = "sub_life"
    account.save()
    return account


@pytest.mark.django_db
@override_settings(**PRICE_ENV)
def test_checkout_annual_plan_uses_annual_price():
    client, _ = authed_client()
    with mock.patch(
        "apps.billing.views.stripe.Customer.create"
    ) as create_cust, mock.patch(
        "apps.billing.views.stripe.checkout.Session.create"
    ) as create_session:
        create_cust.return_value = mock.Mock(id="cus_123")
        create_session.return_value = mock.Mock(url="https://checkout.stripe/x")
        response = client.post(
            "/api/billing/checkout/", {"plan": "annual"}, format="json"
        )
    assert response.status_code == 200
    line_items = create_session.call_args.kwargs["line_items"]
    assert line_items == [{"price": "price_annual", "quantity": 1}]


@pytest.mark.django_db
@override_settings(**PRICE_ENV)
def test_checkout_rejects_unknown_plan():
    client, _ = authed_client()
    response = client.post(
        "/api/billing/checkout/", {"plan": "weekly"}, format="json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
@override_settings(**PRICE_ENV)
def test_webhook_payment_failed_suspends_and_keeps_clock():
    from django.utils import timezone

    account = _premium_account()
    client = APIClient()
    event = _webhook_event("invoice.payment_failed", {"customer": "cus_life"})
    assert _post_event(client, event).status_code == 200
    account.refresh_from_db()
    assert account.tier == Account.Tier.PREMIUM  # tier kept
    assert account.billing_status == Account.BillingStatus.SUSPENDED
    assert account.is_premium is False  # features off
    first_suspended_at = account.billing_suspended_at
    assert first_suspended_at is not None

    # A second failure does not restart the 180-day clock.
    later = timezone.now()
    account.billing_suspended_at = first_suspended_at
    account.save(update_fields=["billing_suspended_at"])
    assert _post_event(client, event).status_code == 200
    account.refresh_from_db()
    assert account.billing_suspended_at == first_suspended_at
    assert later >= first_suspended_at


@pytest.mark.django_db
@override_settings(**PRICE_ENV)
def test_webhook_invoice_paid_renews_suspended_account():
    account = _premium_account()
    account.billing_status = Account.BillingStatus.SUSPENDED
    from django.utils import timezone

    account.billing_suspended_at = timezone.now()
    account.save()
    event = _webhook_event(
        "invoice.paid", {"customer": "cus_life", "subscription": "sub_life"}
    )
    assert _post_event(APIClient(), event).status_code == 200
    account.refresh_from_db()
    assert account.billing_status == Account.BillingStatus.ACTIVE
    assert account.billing_suspended_at is None
    assert account.is_premium is True


@pytest.mark.django_db
@override_settings(**PRICE_ENV)
def test_webhook_subscription_deleted_expires_with_purge_clock():
    account = _premium_account()
    event = _webhook_event(
        "customer.subscription.deleted", {"customer": "cus_life"}
    )
    assert _post_event(APIClient(), event).status_code == 200
    account.refresh_from_db()
    assert account.tier == Account.Tier.FREE
    assert account.billing_status == Account.BillingStatus.EXPIRED
    assert account.billing_expired_at is not None


@pytest.mark.django_db
@override_settings(**PRICE_ENV)
def test_pause_and_resume_endpoints():
    client, account = authed_client()
    account.tier = Account.Tier.PREMIUM
    account.stripe_subscription_id = "sub_life"
    account.save()
    with mock.patch(
        "apps.billing.views.stripe.Subscription.modify"
    ) as modify:
        response = client.post("/api/billing/pause/")
        assert response.status_code == 200
        assert modify.call_args.kwargs["pause_collection"] == {"behavior": "void"}
        account.refresh_from_db()
        assert account.billing_status == Account.BillingStatus.PAUSED
        assert account.is_premium is False

        response = client.post("/api/billing/resume/")
        assert response.status_code == 200
        account.refresh_from_db()
        assert account.billing_status == Account.BillingStatus.ACTIVE
        assert account.is_premium is True


@pytest.mark.django_db
def test_lifecycle_command_expires_then_purges(tmp_path):
    from datetime import timedelta

    from django.core.files.base import ContentFile
    from django.core.management import call_command
    from django.utils import timezone

    from apps.signing.models import Document

    now = timezone.now()
    suspended = _premium_account("stale@example.com")
    suspended.billing_status = Account.BillingStatus.SUSPENDED
    suspended.billing_suspended_at = now - timedelta(days=181)
    suspended.save()

    fresh = _premium_account("fresh@example.com")
    fresh.billing_status = Account.BillingStatus.SUSPENDED
    fresh.billing_suspended_at = now - timedelta(days=179)
    fresh.save()

    expired = _premium_account("gone@example.com")
    expired.tier = Account.Tier.FREE
    expired.billing_status = Account.BillingStatus.EXPIRED
    expired.billing_expired_at = now - timedelta(days=181)
    expired.save()

    with override_settings(MEDIA_ROOT=str(tmp_path)):
        doc = Document(
            owner=expired, title="Old", sender_email=expired.email,
            status=Document.Status.SIGNED,
        )
        doc.original_file.save("old.pdf", ContentFile(b"%PDF-1.4 old"))
        doc.save()
        doc_path = doc.original_file.path

        call_command("enforce_billing_lifecycle")

    suspended.refresh_from_db()
    assert suspended.billing_status == Account.BillingStatus.EXPIRED
    assert suspended.tier == Account.Tier.FREE
    assert suspended.billing_expired_at is not None
    fresh.refresh_from_db()
    assert fresh.billing_status == Account.BillingStatus.SUSPENDED
    assert not Document.objects.filter(owner=expired).exists()
    import os

    assert not os.path.exists(doc_path)


@pytest.mark.django_db
def test_premium_storage_default_is_five_gb():
    from django.conf import settings

    assert settings.PREMIUM_STORAGE_BYTES == 5 * 1024 * 1024 * 1024
