"""Request-attempt ingestion, query and retention (ADR-028, W5-W1.7).

The control plane stores normalized upstream attempts, not OTel spans. Adapters
collect their own telemetry (agentgateway uses OTLP internally) and hand the
layer-neutral RequestAttempt facts to this service through an AttemptSink. That
keeps the database and API independent of whatever transport a future adapter
(LiteLLM, in-house) uses.

Attempts are keyed by (correlation_key, attempt_no) so an exporter retry is
idempotent. correlation_key is the request-log join key (AG fills
request_logs.trace_id). Retention deletes only request_attempts rows; request
logs, usage events and the ledger are never touched here.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from l01_core.timeutil import now_ms
from l02_domain.models import AttemptSink, RequestAttempt
from l04_repo.orm import GatewayUsageEventORM, RequestAttemptORM

_DAY_MS = 86_400_000


def _row_values(attempt: RequestAttempt, recorded_at_ms: int) -> dict[str, Any]:
    return {
        "correlation_key": attempt.correlation_key,
        "attempt_no": int(attempt.attempt_no),
        "upstream_ref": attempt.upstream_ref,
        "model": attempt.model,
        "status_code": attempt.status_code,
        "error_type": attempt.error_type,
        "error_message": attempt.error_message,
        "started_at_ms": int(attempt.started_at_ms),
        "duration_ms": int(attempt.duration_ms),
        "outcome": attempt.outcome,
        "adapter_id": attempt.adapter_id,
        "recorded_at_ms": recorded_at_ms,
    }


def record_attempts(session: Session, attempts: Iterable[RequestAttempt]) -> int:
    """Upsert normalized attempts; returns how many rows were written.

    The adapter owns ordering and correlation. A repeated export updates the same
    (correlation_key, attempt_no) row rather than duplicating the chain; the
    caller commits once per export. Empty correlation keys and non-positive
    attempt numbers are skipped as malformed adapter output.
    """
    prepared: list[dict[str, Any]] = []
    for attempt in attempts:
        if not attempt.correlation_key or attempt.attempt_no < 1:
            continue
        prepared.append(_row_values(attempt, 0))
    if not prepared:
        return 0
    stamp = now_ms()
    for row in prepared:
        row["recorded_at_ms"] = stamp
        existing = session.get(
            RequestAttemptORM, (row["correlation_key"], row["attempt_no"])
        )
        if existing is None:
            session.add(RequestAttemptORM(**row))
        else:
            for key, value in row.items():
                setattr(existing, key, value)
    session.flush()
    return len(prepared)


def build_attempt_sink(session_factory: sessionmaker) -> AttemptSink:
    """Composition-root adapter hand-off: commit one OTLP export per call."""

    def sink(attempts: Sequence[RequestAttempt]) -> int:
        with session_factory() as session:
            stored = record_attempts(session, attempts)
            session.commit()
            return stored

    return sink


def get_attempts(session: Session, correlation_key: str) -> list[RequestAttemptORM]:
    """Ordered attempts for one correlation key; empty when the adapter had none."""
    if not correlation_key:
        return []
    return list(
        session.scalars(
            select(RequestAttemptORM)
            .where(RequestAttemptORM.correlation_key == correlation_key)
            .order_by(RequestAttemptORM.attempt_no)
        ).all()
    )


def attempts_for_event(
    session: Session, event_id: str
) -> tuple[str, list[RequestAttemptORM]] | None:
    """Resolve a request-log event to its normalized attempts.

    Returns None when the log row does not exist. A row without a correlation key
    (old log or adapter without telemetry) yields an empty list, which the UI
    renders as "no routing chain" rather than an error.
    """
    row = session.get(GatewayUsageEventORM, event_id)
    if row is None:
        return None
    key = row.trace_id or ""
    return key, get_attempts(session, key)


def _day_start_ms(instant_ms: int) -> int:
    return (instant_ms // _DAY_MS) * _DAY_MS


def cleanup_expired_attempts(
    session: Session, retention_days: int, *, now_ms_value: int | None = None
) -> int:
    """Delete attempts older than the daily retention cutoff; returns rows removed."""
    days = max(1, int(retention_days))
    anchor = now_ms() if now_ms_value is None else int(now_ms_value)
    cutoff_ms = _day_start_ms(anchor - days * _DAY_MS)
    result = session.execute(
        delete(RequestAttemptORM).where(RequestAttemptORM.started_at_ms < cutoff_ms)
    )
    deleted = max(result.rowcount or 0, 0)
    session.flush()
    return deleted


__all__ = [
    "attempts_for_event",
    "build_attempt_sink",
    "cleanup_expired_attempts",
    "get_attempts",
    "record_attempts",
]
