"""Incremental usage pull from the data plane request log (idempotent by event_id).

Lives in the service layer so the admin API can trigger a manual pull without
importing l07_jobs (l06 must never import l07); the job layer only wires it to a
timer.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from l01_core.timeutil import now_ms
from l03_adapters.spi import DataPlaneAdapter, UsageCursor
from l04_repo.repository import get_setting, put_setting
from l05_service.usage_ingest import ingest_usage_events, process_billing

CURSOR_KEY = "usage_cursor"


def pull_once(session: Session, adapter: DataPlaneAdapter) -> int:
    """One cursor-advanced pull plus the billing pass; replays are safe."""
    cursor_raw = get_setting(session, CURSOR_KEY)
    page = adapter.usage(UsageCursor(value=cursor_raw) if cursor_raw else None)
    added = ingest_usage_events(session, page.events)
    if added:
        # cost/charge entries + ledger deduction + daily aggregates for new rows.
        process_billing(session)
    if page.next_cursor is not None:
        put_setting(session, CURSOR_KEY, page.next_cursor.value, now_ms())
    return added
