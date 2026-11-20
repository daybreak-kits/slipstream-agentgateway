"""Daily retention cleanup for the agentgateway request-log database (ADR-021).

The data-plane SQLite DB keeps request metadata (request_logs) and optional
prompt/completion bodies (request_log_payloads). Rows older than the operator
setting log_retention_days are deleted here, and only here: the control-plane
ledger (ledger_entries / gateway_usage_events / charge_entries) lives in a
separate database and must never be touched by retention. M5-a appends a
control-plane trace_spans pass under the same day-granular setting; that pass
only prunes spans, never usage facts or the ledger.

Registering this as a job means the cleanup follows SLIPSTREAM_JOBS_ENABLED like
the other in-process jobs; a deployment running jobs on a separate worker gets
it through build_runner as well.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable

from sqlalchemy.orm import sessionmaker

from l01_core.settings import (
    DEFAULT_LOG_RETENTION_DAYS,
    Settings,
    get_settings,
)
from l03_adapters.agentgateway.usage import cleanup_expired_logs
from l04_repo.repository import get_setting
from l05_service.traces import cleanup_expired_spans

#: Retention is a daily housekeeping task, not a per-minute one.
LOG_CLEANUP_INTERVAL_S = 24 * 3600

RETENTION_KEY = "log_retention_days"

__all__ = [
    "LOG_CLEANUP_INTERVAL_S",
    "RETENTION_KEY",
    "cleanup_job",
    "make_cleanup_job",
]


def _retention_days(session_factory: sessionmaker) -> int:
    """Read log_retention_days (JSON int, 1..365); default on absence/garbage."""
    with session_factory() as session:
        raw = get_setting(session, RETENTION_KEY)
    if raw is None:
        return DEFAULT_LOG_RETENTION_DAYS
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        value = raw
    try:
        days = int(value)
    except (TypeError, ValueError):
        return DEFAULT_LOG_RETENTION_DAYS
    return max(1, min(365, days))


def cleanup_job(
    session_factory: sessionmaker, settings: Settings | None = None
) -> dict[str, int]:
    """One retention pass: data-plane request logs + control-plane trace spans."""
    resolved = settings or get_settings()
    days = _retention_days(session_factory)
    counts = cleanup_expired_logs(resolved.ag_log_db_path, days)
    # M5-a: spans live in the control-plane DB, not AG's request-log SQLite.
    # Only trace_spans is pruned; usage events / ledger rows are never retention.
    with session_factory() as session:
        counts["trace_spans"] = cleanup_expired_spans(session, days)
        session.commit()
    return counts


def make_cleanup_job(
    session_factory: sessionmaker, settings: Settings | None = None
) -> Callable[[], Awaitable[dict[str, int]]]:
    """Coroutine factory registered with the JobRunner (daily cadence)."""
    resolved = settings or get_settings()

    async def _job() -> dict[str, int]:
        return cleanup_job(session_factory, resolved)

    return _job
