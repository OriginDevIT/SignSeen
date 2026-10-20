from django.urls import path

from . import views

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
    path("sessions/<str:token>/", views.get_session, name="session-detail"),
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
]
