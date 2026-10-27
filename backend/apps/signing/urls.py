from django.urls import path

from . import e2e_views, views

urlpatterns = [
    path("documents/", views.create_document, name="document-create"),
    path("documents/from-url/", views.create_document_from_url, name="document-from-url"),
    path("documents/mine/", views.my_documents, name="document-mine"),
    path("documents/<uuid:doc_id>/", views.get_document, name="document-detail"),
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
        views.delete_document_field,
        name="document-field-delete",
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
    # Test-stack only (e2e_views guards on ENABLE_E2E_FIXTURES): sealed
    # pages for the Playwright review gallery.
    path(
        "e2e/sealed/<uuid:doc_id>/page/<int:page>.png",
        e2e_views.sealed_page,
        name="e2e-sealed-page",
    ),
]
