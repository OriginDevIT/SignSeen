# Written by hand — backfills signed_at for sessions signed before
# the field existed (issue #141).

from django.db import migrations


def backfill_signed_at(apps, schema_editor):
    """Set signed_at from each session's signature.submitted audit event.

    Sessions signed before the signed_at field landed have it null, so
    the document page shows a bare "signed" with no time. The signed
    moment is already recorded: the signature.submitted event's
    timestamp is the same instant the certificate reports, and it is
    what submit-time code uses for new signatures. Sessions with no
    such event are left null.
    """
    SigningSession = apps.get_model("signing", "SigningSession")
    AuditEvent = apps.get_model("signing", "AuditEvent")
    for session in SigningSession.objects.filter(signed_at__isnull=True):
        submitted = (
            AuditEvent.objects.filter(
                session=session, event_type="signature.submitted"
            )
            .order_by("created_at")
            .first()
        )
        if submitted is not None:
            session.signed_at = submitted.created_at
            session.save(update_fields=["signed_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("signing", "0012_alter_documentfield_field_type"),
    ]

    operations = [
        migrations.RunPython(backfill_signed_at, migrations.RunPython.noop),
    ]
