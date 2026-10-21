from django.urls import path

from . import views

urlpatterns = [
    path("checkout/", views.checkout, name="billing-checkout"),
    path("portal/", views.portal, name="billing-portal"),
    path("pause/", views.pause, name="billing-pause"),
    path("resume/", views.resume, name="billing-resume"),
    path("webhook/", views.webhook, name="billing-webhook"),
]
