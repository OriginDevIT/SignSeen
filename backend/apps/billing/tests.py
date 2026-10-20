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
