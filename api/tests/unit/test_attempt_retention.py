"""ADR-028 request-attempt retention: only request_attempts is pruned by log_retention_days.

The daily log-cleanup job appends an attempt pass. These tests pin the boundary:
expired attempts go, recent attempts stay, and neither the control-plane usage
facts nor any request_logs/ledger table is touched by the attempt pass.
"""

from __future__ import annotations

from sqlalchemy import func, select, text

from l01_core.settings import Settings
from l01_core.timeutil import now_ms
from l04_repo.orm import GatewayUsageEventORM, RequestAttemptORM
from l05_service.attempts import cleanup_expired_attempts
from l07_jobs.log_cleanup import cleanup_job

_DAY_MS = 86_400_000


def _attempt(key: str, attempt_no: int, start_ms: int) -> RequestAttemptORM:
    return RequestAttemptORM(
        correlation_key=key,
        attempt_no=attempt_no,
        upstream_ref="ups_a",
        model="glm-4.6",
        status_code=200,
        error_type="",
        error_message="",
        started_at_ms=start_ms,
        duration_ms=5,
        outcome="ok",
        adapter_id="agentgateway",
        recorded_at_ms=start_ms,
    )


def _count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_cleanup_expired_attempts_deletes_old_attempts_only(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    now = now_ms()
    with factory() as session:
        session.add_all(
            [
                _attempt("trace_old", 1, now - 40 * _DAY_MS),
                _attempt("trace_recent", 1, now - 1 * _DAY_MS),
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
        deleted = cleanup_expired_attempts(session, 30, now_ms_value=now)
        session.commit()
        remaining = set(session.scalars(select(RequestAttemptORM.correlation_key)).all())
        usage_rows = _count(session, GatewayUsageEventORM)
    with engine.connect() as connection:
        sentinel_rows = connection.execute(text("SELECT COUNT(*) FROM request_logs")).scalar()

    assert deleted == 1
    assert remaining == {"trace_recent"}
    # The attempt pass never touches usage facts or any request-log table.
    assert usage_rows == 1
    assert sentinel_rows == 1


def test_log_cleanup_job_appends_the_attempt_pass(engine_and_sessionmaker, tmp_path):
    _, factory = engine_and_sessionmaker
    old = now_ms() - 400 * _DAY_MS
    with factory() as session:
        session.add_all(
            [
                _attempt("trace_expired", 1, old),
                _attempt("trace_fresh", 1, now_ms()),
                GatewayUsageEventORM(event_id="evt_usage_keep", started_at_ms=old),
            ]
        )
        session.commit()

    # A missing AG request-log DB is already a no-op (fresh install / API-only
    # deployment); the appended control-plane attempt pass must still run.
    counts = cleanup_job(factory, Settings(ag_config_dir=str(tmp_path / "ag-config")))

    assert counts == {"request_logs": 0, "request_log_payloads": 0, "request_attempts": 1}
    with factory() as session:
        assert set(session.scalars(select(RequestAttemptORM.correlation_key)).all()) == {
            "trace_fresh"
        }
        assert _count(session, GatewayUsageEventORM) == 1


def test_retention_is_day_granular_and_uses_the_configured_window(
    engine_and_sessionmaker,
):
    _, factory = engine_and_sessionmaker
    now = 1_800_000_000_000
    with factory() as session:
        session.add_all(
            [
                _attempt("trace_31d", 1, now - 31 * _DAY_MS),
                _attempt("trace_29d", 1, now - 29 * _DAY_MS),
            ]
        )
        session.commit()
        assert cleanup_expired_attempts(session, 30, now_ms_value=now) == 1
        session.commit()
        assert set(session.scalars(select(RequestAttemptORM.correlation_key)).all()) == {
            "trace_29d"
        }
