from django.conf import settings
from rest_framework import serializers

from .models import AuditEvent, Document, SigningSession


def build_signing_url(token: str) -> str:
    base = settings.FRONTEND_URL.rstrip("/")
    return f"{base}/s/{token}"


class DocumentSerializer(serializers.ModelSerializer):
    signing_url = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            "id",
            "title",
            "status",
            "source",
            "source_url",
            "original_filename",
            "sender_email",
            "signed_file",
            "signing_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_signing_url(self, obj) -> str | None:
        """The active session's signing URL — for the document's owner only.

        The signing token is a credential: it is exposed only when the
        serializer context carries an authenticated request whose user
        owns this document. Serializations without a request context
        (upload / seal responses) and non-owner requesters get None,
        and the value is None whenever no pending, unexpired session
        exists.
        """
        request = self.context.get("request")
        user = getattr(request, "user", None) if request is not None else None
        if user is None or not user.is_authenticated:
            return None
        if obj.owner_id != user.pk:
            return None
        for session in obj.sessions.all():
            if session.is_usable():
                return build_signing_url(session.token)
        return None


class SigningSessionSerializer(serializers.ModelSerializer):
    signing_url = serializers.SerializerMethodField()
    usable = serializers.SerializerMethodField()
    document_title = serializers.CharField(source="document.title", read_only=True)
    document_status = serializers.CharField(source="document.status", read_only=True)

    class Meta:
        model = SigningSession
        fields = [
            "id",
            "document",
            "document_title",
            "document_status",
            "token",
            "signer_name",
            "signer_email",
            "status",
            "usable",
            "expires_at",
            "created_at",
            "signing_url",
        ]
        read_only_fields = fields

    def get_signing_url(self, obj) -> str:
        return build_signing_url(obj.token)

    def get_usable(self, obj) -> bool:
        return obj.is_usable()


class AuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEvent
        fields = [
            "id",
            "event_type",
            "payload",
            "prev_hash",
            "hash",
            "created_at",
        ]
        read_only_fields = fields
