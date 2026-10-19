"""Hash-chained audit trail.

Each event's hash covers the previous event's hash, the server timestamp,
the event type, and the canonical payload. Verifying the chain means
recomputing every link: a single altered byte anywhere breaks the chain.
"""

import hashlib
import json

from django.utils import timezone

GENESIS_HASH = "0" * 64


def _canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def chain_hash(prev_hash: str, event_type: str, payload: dict, timestamp_iso: str) -> str:
    h = hashlib.sha256()
    h.update(prev_hash.encode())
    h.update(timestamp_iso.encode())
    h.update(event_type.encode())
    h.update(_canonical(payload))
    return h.hexdigest()


def record_event(session, event_type: str, payload: dict):
    """Append an event to the session's chain and return it."""
    from .models import AuditEvent

    last = session.events.order_by("-created_at").first()
    prev_hash = last.hash if last else GENESIS_HASH
    timestamp = timezone.now()
    event_hash = chain_hash(prev_hash, event_type, payload, timestamp.isoformat())
    return AuditEvent.objects.create(
        session=session,
        event_type=event_type,
        payload=payload,
        prev_hash=prev_hash,
        hash=event_hash,
        created_at=timestamp,
    )


def verify_chain(session) -> bool:
    """Recompute every link. Returns True iff the chain is intact."""
    prev_hash = GENESIS_HASH
    for event in session.events.order_by("created_at"):
        expected = chain_hash(
            prev_hash, event.event_type, event.payload, event.created_at.isoformat()
        )
        if expected != event.hash or event.prev_hash != prev_hash:
            return False
        prev_hash = event.hash
    return True
