from django.conf import settings
from rest_framework import serializers

from .models import AuditEvent, Document, DocumentField, SigningSession


class SessionSummarySerializer(serializers.ModelSerializer):
    """Per-signer state embedded in document payloads so senders can see
    who has signed and who is still pending (multi-signer tracking)."""

    class Meta:
        model = SigningSession
        fields = ["id", "signer_name", "signer_email", "status", "order", "signed_at"]
        read_only_fields = fields


class DocumentFieldSerializer(serializers.ModelSerializer):
    """One sender-placed field (#13). `type` is the wire name for the
    model's field_type; `value` exposes the text value (signature /
    initials images stay server-side as files, like ceremony evidence).
    """

    type = serializers.CharField(source="field_type", read_only=True)
    value = serializers.CharField(source="value_text", read_only=True)
    completed = serializers.BooleanField(source="is_completed", read_only=True)

    class Meta:
        model = DocumentField
        fields = [
            "id",
            "document",
            "session",
            "signer_index",
            "type",
            "page",
            "x",
            "y",
            "width",
            "height",
            "required",
            "value",
            "completed",
            "completed_at",
            "created_at",
        ]
        read_only_fields = fields
def build_signing_url(token: str) -> str:
    base = settings.FRONTEND_URL.rstrip("/")
    return f"{base}/s/{token}"


class DocumentSerializer(serializers.ModelSerializer):
    sessions = SessionSummarySerializer(many=True, read_only=True)
    signing_url = serializers.SerializerMethodField()
    # The draft token (#89) is a credential: it is exposed only when
    # the view sets show_draft_token in the serializer context (draft
    # creation, or a detail read by the owner / token holder). List
    # payloads never carry it, and the key is dropped entirely when
    # the value is None.
    draft_token = serializers.SerializerMethodField()

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
            "original_file",
            "signed_file",
            "signing_mode",
            "photo_required",
            "signer_list",
            "draft_token",
            "sessions",
            "signing_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if data.get("draft_token") is None:
            data.pop("draft_token", None)
        return data

    def get_draft_token(self, obj) -> str | None:
        if self.context.get("show_draft_token"):
            return obj.draft_token
        return None

    def get_signing_url(self, obj) -> str | None:
        """The active session's signing URL - for the document's owner only.

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
    waiting = serializers.SerializerMethodField()
    fields = DocumentFieldSerializer(many=True, read_only=True)
    # Fields other signers already completed on this document (#105):
    # completed only, so a later signer in the sequence sees the
    # signatures and filled-in fields on the document, while other
    # signers' empty fields stay hidden. Values come from the stored
    # field records; signature/initials images are served separately
    # by the token-addressed field-image endpoint.
    completed_fields = serializers.SerializerMethodField()
    branding = serializers.SerializerMethodField()
    document_title = serializers.CharField(source="document.title", read_only=True)
    document_status = serializers.CharField(source="document.status", read_only=True)
    # Sender option (#73), read from the document: the ceremony gates
    # the photo step on this, and names the sender in the message.
    photo_required = serializers.BooleanField(
        source="document.photo_required", read_only=True
    )
    sender_email = serializers.CharField(
        source="document.sender_email", read_only=True
    )

    class Meta:
        model = SigningSession
        fields = [
            "id",
            "document",
            "document_title",
            "document_status",
            "photo_required",
            "sender_email",
            "token",
            "signer_name",
            "signer_email",
            "status",
            "order",
            "usable",
            "waiting",
            "fields",
            "completed_fields",
            "branding",
            "expires_at",
            "created_at",
            "signing_url",
        ]
        read_only_fields = fields

    def get_completed_fields(self, obj) -> list:
        others = DocumentField.objects.filter(
            document=obj.document, completed_at__isnull=False
        ).exclude(session=obj)
        return DocumentFieldSerializer(others, many=True).data

    def get_signing_url(self, obj) -> str:
        return build_signing_url(obj.token)

    def get_usable(self, obj) -> bool:
        return obj.is_usable()

    def get_waiting(self, obj) -> bool:
        """True when this link is not active yet because an earlier
        signer in the sequence has not signed - distinct from a link
        that is signed or expired."""
        return obj.is_waiting()
    def get_branding(self, obj) -> dict:
        """Sender branding for the ceremony (premium accounts; §3.6).

        Sourced from the document's owning account. Empty name/color
        and a null logo mean "no branding configured" - the ceremony
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
