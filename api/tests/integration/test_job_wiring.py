"""Job wiring: the app starts the four periodic jobs, or not when disabled.

P0-3 regression: l07_jobs existed with factories but nothing ever registered them,
so no background task ran in a real deployment. These tests pin both states of the
switch (app flag and `jobs_enabled` setting) and smoke-run one tick of each job.
"""

from __future__ import annotations

import sqlite3

from fastapi import FastAPI

from l01_core.settings import Settings
from l04_repo.orm import LedgerEntryORM, UserORM
from l07_jobs import wiring
from server import create_app

#: Minimal data-plane request-log schema (same shape AG 1.7 creates).
_AG_SCHEMA = """
CREATE TABLE request_logs (
    id TEXT PRIMARY KEY, started_at TEXT, completed_at TEXT,
    duration_ms INTEGER, trace_id TEXT, span_id TEXT,
    http_status INTEGER, error TEXT, gen_ai_operation_name TEXT,
    gen_ai_provider_name TEXT, gen_ai_request_model TEXT,
    gen_ai_response_model TEXT, input_tokens INTEGER,
    output_tokens INTEGER, total_tokens INTEGER, cost REAL,
    agentgateway_user TEXT, agentgateway_group TEXT,
    user_agent_name TEXT, has_payload INTEGER, attributes_json TEXT,
    cache_read_input_tokens INTEGER, cache_creation_input_tokens INTEGER,
    reasoning_tokens INTEGER, time_to_first_token_ms INTEGER,
    time_per_output_token_ms INTEGER
);
CREATE TABLE request_log_payloads (
    log_id TEXT PRIMARY KEY, request_prompt_json TEXT,
    response_completion_json TEXT
);
"""


def test_app_registers_the_runner_when_jobs_enabled(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    app = create_app(session_factory=factory, init_tables=False, jobs=True)
    runner = app.state.job_runner
    assert runner is not None, "the app must register a JobRunner when jobs are on"
    assert set(runner._jobs) == {
        "usage_pull",
        "cooldown_rerender",
        "reconcile",
        "log_cleanup",
        "models_dev_sync",
    }
    # Three jobs share the configured interval; the two daily jobs run daily.
    intervals = {name: interval for name, (_f, interval) in runner._jobs.items()}
    assert intervals.pop("log_cleanup") == 86_400.0
    assert intervals.pop("models_dev_sync") == 86_400.0
    assert set(intervals.values()) == {60.0}


def test_app_does_not_start_jobs_when_disabled(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    app = create_app(session_factory=factory, init_tables=False, jobs=False)
    assert app.state.job_runner is None


def test_jobs_setting_switch_disables_the_runner(engine_and_sessionmaker):
    """SLIPSTREAM_JOBS_ENABLED=0 has the same effect as the app flag."""
    _, factory = engine_and_sessionmaker
    disabled = Settings(jobs_enabled=False)
    assert wiring.start_runner(FastAPI(), factory, disabled) is None
    # The env-backed default stays on, so a real deployment needs no extra flag.
    assert wiring.start_runner(FastAPI(), factory, Settings())._jobs


def test_one_tick_runs_every_job_without_touching_balances(
    engine_and_sessionmaker, tmp_path, monkeypatch
):
    """Smoke: a full tick is safe on a clean DB - the reconcile keeps balances put."""
    import asyncio

    from l01_core.timeutil import now_ms
    from l05_service import balances, models_dev

    # Hermetic: the models.dev job must never reach the network from a test.
    monkeypatch.setattr(models_dev, "fetch_snapshot", lambda *a, **k: {})

    _, factory = engine_and_sessionmaker
    with factory() as session:
        user = UserORM(id="usr_smoke", name="smoke", balance_micro=0, created_at_ms=now_ms())
        session.add(user)
        session.commit()
        balances.record_topup(
            session, user_id="usr_smoke", amount_micro=1_000, currency="CNY"
        )
        session.commit()
        before = session.get(UserORM, "usr_smoke").balance_micro
        ledger_before = session.query(LedgerEntryORM).count()

    ag_dir = tmp_path / "ag-config"
    ag_dir.mkdir(parents=True, exist_ok=True)
    ag_db = ag_dir / "ag-data.db"
    connection = sqlite3.connect(ag_db)
    try:
        connection.executescript(_AG_SCHEMA)
        connection.commit()
    finally:
        connection.close()
    asyncio.run(wiring.run_jobs_once(factory, Settings(data_plane_config_dir=str(ag_dir))))

    with factory() as session:
        assert session.get(UserORM, "usr_smoke").balance_micro == before
        assert session.query(LedgerEntryORM).count() == ledger_before
