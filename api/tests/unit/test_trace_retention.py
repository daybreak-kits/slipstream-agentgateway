"""M5-a trace span retention: only trace_spans is pruned by log_retention_days.

The daily log-cleanup job now appends a trace-span pass. These tests pin the
boundary: expired spans go, recent spans stay, and neither the control-plane
usage facts nor any request_logs/ledger table is touched by the span pass.
"""

from __future__ import annotations

from sqlalchemy import func, select, text

from l01_core.settings import Settings
from l01_core.timeutil import now_ms
from l04_repo.orm import GatewayUsageEventORM, TraceSpanORM
from l05_service.traces import cleanup_expired_spans
from l07_jobs.log_cleanup import cleanup_job

_DAY_MS = 86_400_000


def _span(span_id: str, start_ms: int, kind: str = "client") -> TraceSpanORM:
    return TraceSpanORM(
        span_id=span_id,
        trace_id="trace_retention",
        kind=kind,
        http_path="/ok/chat/completions",
        http_status=200,
        start_ms=start_ms,
        end_ms=start_ms + 5,
        duration_ms=5,
        attributes_json="{}",
    )


def _count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_cleanup_expired_spans_deletes_old_spans_only(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    now = now_ms()
    with factory() as session:
        session.add_all(
            [
                _span("span_old", now - 40 * _DAY_MS),
                _span("span_recent", now - 1 * _DAY_MS),
                GatewayUsageEventORM(event_id="evt_keep", started_at_ms=now),
            ]
        )
        session.commit()
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE request_logs (id TEXT PRIMARY KEY, started_at TEXT)"))
        connection.execute(
            text("INSERT INTO request_logs (id, started_at) VALUES ('log_old', '2020-01-01')")
        )

    with factory() as session:
        deleted = cleanup_expired_spans(session, 30, now_ms_value=now)
        session.commit()
        remaining = set(session.scalars(select(TraceSpanORM.span_id)).all())
        usage_rows = _count(session, GatewayUsageEventORM)
    with engine.connect() as connection:
        sentinel_rows = connection.execute(text("SELECT COUNT(*) FROM request_logs")).scalar()

    assert deleted == 1
    assert remaining == {"span_recent"}
    # The span pass never touches usage facts or any request-log table.
    assert usage_rows == 1
    assert sentinel_rows == 1


def test_log_cleanup_job_appends_the_span_pass(engine_and_sessionmaker, tmp_path):
    _, factory = engine_and_sessionmaker
    old = now_ms() - 400 * _DAY_MS
    with factory() as session:
        session.add_all(
            [
                _span("span_expired", old),
                _span("span_fresh", now_ms()),
                GatewayUsageEventORM(event_id="evt_usage_keep", started_at_ms=old),
            ]
        )
        session.commit()

    # A missing AG request-log DB is already a no-op (fresh install / API-only
    # deployment); the appended control-plane span pass must still run.
    counts = cleanup_job(factory, Settings(ag_config_dir=str(tmp_path / "ag-config")))

    assert counts == {"request_logs": 0, "request_log_payloads": 0, "trace_spans": 1}
    with factory() as session:
        assert set(session.scalars(select(TraceSpanORM.span_id)).all()) == {"span_fresh"}
        assert _count(session, GatewayUsageEventORM) == 1


def test_retention_is_day_granular_and_uses_the_configured_window(
    engine_and_sessionmaker,
):
    _, factory = engine_and_sessionmaker
    now = 1_800_000_000_000
    with factory() as session:
        session.add_all(
            [
                _span("span_31d", now - 31 * _DAY_MS),
                _span("span_29d", now - 29 * _DAY_MS),
            ]
        )
        session.commit()
        assert cleanup_expired_spans(session, 30, now_ms_value=now) == 1
        session.commit()
        assert set(session.scalars(select(TraceSpanORM.span_id)).all()) == {"span_29d"}
