from django.urls import path

from . import views

urlpatterns = [
    path("documents/", views.create_document, name="document-create"),
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
        "sessions/<str:token>/events/",
        views.get_session_events,
        name="session-events",
    ),
]
