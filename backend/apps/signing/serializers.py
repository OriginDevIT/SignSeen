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
    branding = serializers.SerializerMethodField()
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
            "branding",
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

    def get_branding(self, obj) -> dict:
        """Sender branding for the ceremony (premium accounts; §3.6).

        Sourced from the document's owning account. Empty name/color
        and a null logo mean "no branding configured" — the ceremony
        falls back to SignSeen defaults. Anonymous sends have no
        owner, so they always get the empty form.
        """
        empty = {"name": "", "color": "", "logo": None}
        owner = obj.document.owner
        if owner is None:
            return empty
        return {
            "name": owner.brand_name or "",
            "color": owner.brand_color or "",
            "logo": owner.brand_logo.url if owner.brand_logo else None,
        }


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
