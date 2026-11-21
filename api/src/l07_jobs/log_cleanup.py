"""Daily retention cleanup for the data-plane request logs (ADR-021).

The adapter owns the request-log store: request metadata and the optional
prompt/completion bodies. Rows older than the operator setting
log_retention_days are deleted through the adapter's ``prune_logs`` SPI port,
and only there: the control-plane ledger (ledger_entries / gateway_usage_events
/ charge_entries) lives in a separate database and must never be touched by
retention. ADR-028 appends a control-plane request_attempts pass under the same
day-granular setting; that pass only prunes normalized attempts, never usage
facts or the ledger.

Registering this as a job means the cleanup follows SLIPSTREAM_JOBS_ENABLED like
the other in-process jobs; a deployment running jobs on a separate worker gets
it through build_runner as well. The runner anchors the pass to just after local
midnight and the wrapper self-gates on the app_settings last-run date, so a
restart or a second replica never repeats the pass inside the same local day
(W6 review P1-1).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable

from sqlalchemy.orm import sessionmaker

from l01_core.settings import (
    DEFAULT_LOG_RETENTION_DAYS,
    Settings,
    get_settings,
)
from l01_core.timeutil import local_today, now_ms
from l03_adapters.spi import DataPlaneAdapter
from l04_repo.repository import get_setting, put_setting
from l05_service.attempts import cleanup_expired_attempts
from l06_api.adapter_factory import make_adapter

LOGGER = logging.getLogger("slipstream.jobs")

#: Retention is a daily housekeeping task, not a per-minute one.
LOG_CLEANUP_INTERVAL_S = 24 * 3600

RETENTION_KEY = "log_retention_days"

#: app_settings key recording the last-run local date (restart/multi-replica gate).
LOG_CLEANUP_LAST_RUN_KEY = "log_cleanup_last_run"

__all__ = [
    "LOG_CLEANUP_INTERVAL_S",
    "LOG_CLEANUP_LAST_RUN_KEY",
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
    session_factory: sessionmaker,
    settings: Settings | None = None,
    *,
    adapter: DataPlaneAdapter | None = None,
) -> dict[str, int]:
    """One retention pass: data-plane request logs + control-plane attempts.

    W6 ticket 02: the data-plane half always runs through the adapter's
    ``prune_logs`` SPI port. The production default resolves the configured
    driver via the composition factory; tests may inject a driver (the fake)
    directly over the same port.
    """
    resolved = settings or get_settings()
    days = _retention_days(session_factory)
    driver = adapter if adapter is not None else make_adapter(resolved)
    counts = dict(driver.prune_logs(days))
    # ADR-028: attempts live in the control-plane DB, not AG's request-log SQLite.
    # Only request_attempts is pruned; usage events / ledger rows are never retention.
    with session_factory() as session:
        counts["request_attempts"] = cleanup_expired_attempts(session, days)
        session.commit()
    return counts


def make_cleanup_job(
    session_factory: sessionmaker, settings: Settings | None = None
) -> Callable[[], Awaitable[dict[str, int]]]:
    """Coroutine factory registered with the JobRunner (daily cadence).

    The pass body is :func:`cleanup_job`; this wrapper records the last-run
    local date under ``LOG_CLEANUP_LAST_RUN_KEY`` so a restart or a second
    replica never repeats the retention pass inside the same local day.
    """
    resolved = settings or get_settings()

    async def _job() -> dict[str, int]:
        with session_factory() as session:
            last_run_date = get_setting(session, LOG_CLEANUP_LAST_RUN_KEY)
        if last_run_date == local_today():
            LOGGER.info("log cleanup already ran today (%s); skipping", last_run_date)
            return {}
        counts = cleanup_job(session_factory, resolved)
        with session_factory() as session:
            put_setting(session, LOG_CLEANUP_LAST_RUN_KEY, local_today(), now_ms())
            session.commit()
        return counts

    return _job
