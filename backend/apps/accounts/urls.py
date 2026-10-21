from django.urls import path

from . import views

urlpatterns = [
    path("signup/", views.signup, name="account-signup"),
    path("login/", views.login, name="account-login"),
    path("logout/", views.logout, name="account-logout"),
    path("me/", views.me, name="account-me"),
    path("branding/", views.branding, name="account-branding"),
    path("password-reset/", views.password_reset, name="account-password-reset"),
    path(
        "password-reset/confirm/",
        views.password_reset_confirm,
        name="account-password-reset-confirm",
    ),
]
