"""Trust hardening: witness-photo EXIF anti-spoof assessment.

The photo is SignSeen's differentiator ("Seen"), so a photo that wasn't
taken at signing time weakens the whole ceremony. At submit time we compare
the photo's EXIF capture timestamp against the server's signing timestamp.

This is a *heuristic*, not proof, and it is documented as such everywhere
it surfaces:

- EXIF is client-controlled and trivially rewritten by a determined forger.
- EXIF timestamps are naive (no zone); we resolve the zone from the EXIF
  offset tag when present, else the signer's client timezone offset.
- A mismatch (or a missing/unreadable timestamp, as with screenshots and
  stripped uploads) lowers the photo's assurance to "reduced" in the audit
  trail. It never blocks signing.

Also here: `normalize_photo`, which applies the EXIF orientation so the
witness photo isn't stored sideways, and strips EXIF (including GPS) from
the stored copy — the timestamp evidence lives in the audit trail, the
location doesn't need to live on disk.
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone as dt_timezone

from PIL import Image, ImageOps

# EXIF tag IDs.
TAG_DATETIME_ORIGINAL = 36867  # when the shutter fired
TAG_DATETIME = 306  # file modification time (weaker fallback)
TAG_OFFSET_TIME_ORIGINAL = 36881  # e.g. "-05:00" (iOS 13+, some Android)
TAG_ORIENTATION = 274

# A phone clock may drift and EXIF has 1s resolution; beyond this the photo
# wasn't taken "at signing time".
EXIF_TOLERANCE = timedelta(minutes=5)


def _parse_exif_datetime(value: str) -> datetime | None:
    """Parse an EXIF 'YYYY:MM:DD HH:MM:SS' timestamp (naive)."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value.strip(), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None


def _parse_offset(value: str) -> dt_timezone | None:
    """Parse an EXIF offset like '-05:00' / '+0530' / 'Z'."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if v.upper() == "Z":
        return dt_timezone.utc
    sign = 1
    if v[:1] == "-":
        sign = -1
        v = v[1:]
    elif v[:1] == "+":
        v = v[1:]
    digits = v.replace(":", "")
    if len(digits) != 4 or not digits.isdigit():
        return None
    return dt_timezone(sign * timedelta(hours=int(digits[:2]), minutes=int(digits[2:])))


def assess_photo(
    photo_bytes: bytes,
    signed_at: datetime,
    tz_offset_minutes: int | None,
) -> dict:
    """Assess a witness photo against the server signing timestamp.

    Returns a report dict stored verbatim in the audit trail:
      exif_present, exif_timestamp (ISO, as interpreted), delta_seconds,
      assurance ("full" | "reduced"), reason.
    Never raises: unreadable input yields a "reduced" report.
    """
    try:
        img = Image.open(io.BytesIO(photo_bytes))
        exif = img.getexif()
    except Exception:
        return _report(False, None, None, "reduced", "photo_unreadable")

    raw_ts = exif.get(TAG_DATETIME_ORIGINAL) or exif.get(TAG_DATETIME)
    naive = _parse_exif_datetime(raw_ts) if raw_ts else None
    if raw_ts and naive is None:
        return _report(True, None, None, "reduced", "exif_timestamp_unparseable")
    if naive is None:
        return _report(bool(exif), None, None, "reduced", "exif_timestamp_missing")

    # Resolve the timestamp's timezone: EXIF offset tag first, else the
    # signer's client offset. Without either we can't honestly compare.
    tzinfo = _parse_offset(exif.get(TAG_OFFSET_TIME_ORIGINAL))
    if tzinfo is None and tz_offset_minutes is not None:
        try:
            tzinfo = dt_timezone(-timedelta(minutes=int(tz_offset_minutes)))
        except (TypeError, ValueError):
            tzinfo = None
    if tzinfo is None:
        return _report(
            True, naive.isoformat(), None, "reduced", "exif_timezone_unknown"
        )

    taken_at = naive.replace(tzinfo=tzinfo)
    if signed_at.tzinfo is None:
        signed_at = signed_at.replace(tzinfo=dt_timezone.utc)
    delta = abs((signed_at - taken_at).total_seconds())
    if delta <= EXIF_TOLERANCE.total_seconds():
        return _report(
            True, taken_at.isoformat(), delta, "full", "timestamp_match"
        )
    return _report(
        True, taken_at.isoformat(), delta, "reduced", "exif_timestamp_mismatch"
    )


def _report(exif_present, exif_timestamp, delta_seconds, assurance, reason):
    return {
        "exif_present": exif_present,
        "exif_timestamp": exif_timestamp,
        "delta_seconds": delta_seconds,
        "assurance": assurance,
        "reason": reason,
    }


def normalize_photo(photo_bytes: bytes) -> bytes:
    """Return photo bytes with EXIF orientation applied, EXIF stripped.

    Phones store portrait photos rotated with an EXIF orientation flag;
    without this the witness photo embeds sideways in the sealed PDF.
    EXIF (including GPS) is stripped from the stored copy — the capture
    timestamp is preserved separately in the audit trail.
    Raises on unreadable input (caller decides the fallback).
    """
    img = Image.open(io.BytesIO(photo_bytes))
    fmt = (img.format or "JPEG").upper()
    img = ImageOps.exif_transpose(img)  # applies orientation, drops the flag
    buf = io.BytesIO()
    if fmt in ("JPEG", "JPG"):
        if img.mode in ("RGBA", "LA", "PA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        img.save(buf, format="JPEG", quality=92)
    else:
        img.save(buf, format="PNG")
    return buf.getvalue()
