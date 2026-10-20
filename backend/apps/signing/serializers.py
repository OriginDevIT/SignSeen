from rest_framework import serializers

from .models import AuditEvent, Document, SigningSession


class DocumentSerializer(serializers.ModelSerializer):
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
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


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
        from django.conf import settings

        base = settings.FRONTEND_URL.rstrip("/")
        return f"{base}/s/{obj.token}"

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
