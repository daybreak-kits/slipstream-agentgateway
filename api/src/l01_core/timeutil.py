"""UTC-millisecond time helpers: storage is integer ms, ISO strings are render-only."""

from __future__ import annotations

from datetime import UTC, datetime


def now_ms() -> int:
    """Current UTC time in whole milliseconds."""
    return int(datetime.now(UTC).timestamp() * 1000)


def local_today() -> str:
    """The process-local calendar date (ISO ``YYYY-MM-DD``) right now.

    Daily housekeeping jobs record it in app_settings as their last-run date so
    a restart or a second replica never repeats the same local day's pass.
    """
    return datetime.now().astimezone().date().isoformat()


def ms_to_iso(ms: int) -> str:
    """Render epoch milliseconds as `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC)."""
    base = datetime.fromtimestamp(ms // 1000, tz=UTC).strftime("%Y-%m-%dT%H:%M:%S")
    return f"{base}.{ms % 1000:03d}Z"


def iso_to_ms(iso: str) -> int:
    """Parse an ISO-8601 instant (`Z` or explicit offset; naive means UTC) to epoch ms."""
    text = iso.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return int(parsed.timestamp() * 1000)
