from django.urls import path

from . import views

urlpatterns = [
    path("checkout/", views.checkout, name="billing-checkout"),
    path("portal/", views.portal, name="billing-portal"),
    path("webhook/", views.webhook, name="billing-webhook"),
]
