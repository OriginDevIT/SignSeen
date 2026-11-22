from django.urls import path

from . import e2e_views, verify, views

urlpatterns = [
    path("documents/", views.create_document, name="document-create"),
    path("documents/from-url/", views.create_document_from_url, name="document-from-url"),
    path("documents/mine/", views.my_documents, name="document-mine"),
    path(
        "documents/<uuid:doc_id>/",
        views.document_detail,
        name="document-detail",
    ),
    path(
        "documents/<uuid:doc_id>/send/",
        views.send_document,
        name="document-send",
    ),
    path(
        "documents/<uuid:doc_id>/sessions/",
        views.create_session,
        name="session-create",
    ),
    path(
        "documents/<uuid:doc_id>/fields/",
        views.document_fields,
        name="document-fields",
    ),
    path(
        "documents/<uuid:doc_id>/fields/<uuid:field_id>/",
        views.document_field_detail,
        name="document-field-detail",
    ),
    path(
        "documents/<uuid:doc_id>/page/<int:page>.png",
        views.document_page_png,
        name="document-page-png",
    ),
    path("sessions/<str:token>/", views.get_session, name="session-detail"),
    path(
        "sessions/<str:token>/page/<int:page>.png",
        views.session_page_png,
        name="session-page-png",
    ),
    path(
        "sessions/<str:token>/fields/<uuid:field_id>/image/",
        views.session_field_image,
        name="session-field-image",
    ),
    path(
        "sessions/<str:token>/document/",
        views.session_document,
        name="session-document",
    ),
    path(
        "sessions/<str:token>/sign/",
        views.submit_signature,
        name="session-sign",
    ),
    path(
        "sessions/<str:token>/signer-email/",
        views.set_signer_email,
        name="session-signer-email",
    ),
    path(
        "sessions/<str:token>/events/",
        views.get_session_events,
        name="session-events",
    ),
    # Public document verification (#74): anyone can upload a PDF and
    # check whether this system sealed it. No auth, no storage.
    path("verify/", verify.verify_document, name="verify-document"),
    # Test-stack only (e2e_views guards on ENABLE_E2E_FIXTURES): sealed
    # pages for the Playwright review gallery.
    path(
        "e2e/sealed/<uuid:doc_id>/page/<int:page>.png",
        e2e_views.sealed_page,
        name="e2e-sealed-page",
    ),
]
