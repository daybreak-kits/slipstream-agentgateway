"""Job wiring: the app starts the six periodic jobs, or not when disabled.

P0-3 regression: l07_jobs existed with factories but nothing ever registered them,
so no background task ran in a real deployment. These tests pin both states of the
switch (app flag and `jobs_enabled` setting) and smoke-run one tick of each job.
W6 review P1-1: they also pin the execution rhythm -- each job follows its own
interval (not the fastest registered one), daily jobs anchor to just after the
next local midnight, and a daily job never re-runs inside the same local day.
"""

from __future__ import annotations

import asyncio
import sqlite3
import time
from datetime import datetime

import pytest
from fastapi import FastAPI

from l01_core.settings import Settings
from l01_core.timeutil import now_ms
from l04_repo.orm import LedgerEntryORM, UserORM
from l04_repo.repository import get_setting, put_setting
from l07_jobs import wiring
from l07_jobs.runner import JobRunner, next_local_midnight
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
        "daily_status_check",
    }
    # Three jobs share the configured interval; the three daily jobs run daily.
    intervals = {name: interval for name, (_f, interval) in runner._jobs.items()}
    assert intervals.pop("log_cleanup") == 86_400.0
    assert intervals.pop("models_dev_sync") == 86_400.0
    assert intervals.pop("daily_status_check") == 86_400.0
    assert set(intervals.values()) == {60.0}


def test_status_check_job_failure_does_not_kill_the_runner(
    engine_and_sessionmaker, monkeypatch, caplog
):
    """W6 ticket 08: a broken daily check is logged and the loop moves on."""
    import asyncio
    import logging

    from l07_jobs import status_notice
    from l07_jobs.runner import JobRunner

    _, factory = engine_and_sessionmaker

    def _explode(*args, **kwargs):
        raise RuntimeError("status check exploded")

    monkeypatch.setattr(status_notice, "run_status_check", _explode)
    ran_after_failure = []

    async def _healthy_job():
        ran_after_failure.append(True)

    runner = JobRunner()
    runner.register("daily_status_check", status_notice.make_status_check_job(factory), 0.01)
    runner.register("after_failure", _healthy_job, 0.01)

    async def _scenario():
        task = asyncio.create_task(runner.run_forever())
        for _ in range(200):
            await asyncio.sleep(0.01)
            if ran_after_failure:
                break
        runner.stop()
        await asyncio.wait_for(task, timeout=5)

    with caplog.at_level(logging.ERROR, logger="slipstream.jobs"):
        asyncio.run(_scenario())

    assert ran_after_failure, "the loop keeps running later jobs after one fails"
    assert any(
        "daily_status_check" in record.getMessage() for record in caplog.records
    ), "the failure leaves a visible log line"
    assert runner._stop.is_set()


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


# ---------------------------------------------------------------------------
# Execution rhythm (W6 review P1-1): per-job next-due scheduling.


def test_per_job_interval_keeps_a_slow_job_idle_across_fast_cycles():
    """Each job advances by its own interval, not by the fastest registered one.

    The old loop awaited every job each round and then slept min(interval)
    seconds, so a job registered with 86400s re-ran every ``job_interval_seconds``
    alongside the fast jobs. With per-job next-due scheduling the slow job runs
    once (its startup pass) and stays idle while the fast one laps it.
    """
    ran = {"fast": 0, "slow": 0}

    async def _fast():
        ran["fast"] += 1

    async def _slow():
        ran["slow"] += 1

    runner = JobRunner()
    runner.register("fast", _fast, 0.03)
    runner.register("slow_daily_cadence", _slow, 86_400.0)

    async def _scenario():
        task = asyncio.create_task(runner.run_forever())
        await asyncio.sleep(0.4)
        runner.stop()
        await asyncio.wait_for(task, timeout=5)

    asyncio.run(_scenario())

    assert ran["fast"] >= 5, ran
    assert ran["slow"] == 1, "86400s 任务在多轮快速周期里只能执行一次"


def test_daily_job_first_run_anchors_to_next_local_midnight():
    """A daily-anchored job does not run at startup; it waits for next midnight."""
    ran = {"daily": 0, "fast": 0}

    async def _daily():
        ran["daily"] += 1

    async def _fast():
        ran["fast"] += 1

    runner = JobRunner()
    runner.register("daily_anchor", _daily, 86_400.0, daily=True)
    runner.register("fast", _fast, 0.03)

    async def _scenario():
        task = asyncio.create_task(runner.run_forever())
        await asyncio.sleep(0.35)
        runner.stop()
        await asyncio.wait_for(task, timeout=5)

    asyncio.run(_scenario())

    if next_local_midnight(time.time()) - time.time() < 1.0:
        pytest.skip("test window overlaps the local-midnight anchor")
    assert ran["daily"] == 0, "daily 任务首跑必须锚定到次日本地 0 点后"
    assert ran["fast"] >= 5, ran


def test_next_local_midnight_lands_on_the_next_local_midnight():
    now = time.time()
    anchor = next_local_midnight(now)
    anchor_local = datetime.fromtimestamp(anchor).astimezone()
    now_local = datetime.fromtimestamp(now).astimezone()
    assert (anchor_local.hour, anchor_local.minute, anchor_local.second) == (0, 0, 0)
    assert anchor_local.date() > now_local.date(), (
        "strictly the following day, even when called exactly at midnight"
    )
    assert anchor > now


# ---------------------------------------------------------------------------
# Daily-job self gates (W6 review P1-1): a restart or second replica in the
# same local day must not repeat a daily pass; state rides in app_settings.


def test_status_check_job_runs_once_per_local_day(engine_and_sessionmaker, monkeypatch):
    _, factory = engine_and_sessionmaker
    from l07_jobs import status_notice as job_module

    calls = {"n": 0}

    def _counting_check(*args, **kwargs):
        calls["n"] += 1
        return {"checked_at_ms": 0, "checks": {}}

    monkeypatch.setattr(job_module, "run_status_check", _counting_check)
    job = job_module.make_status_check_job(factory)

    asyncio.run(job())
    asyncio.run(job())
    assert calls["n"] == 1, "同日第二次触发必须跳过（app_settings 已记 last-run 日期）"
    with factory() as session:
        assert get_setting(session, job_module.STATUS_CHECK_LAST_RUN_KEY) == (
            datetime.now().astimezone().date().isoformat()
        )

    with factory() as session:
        put_setting(session, job_module.STATUS_CHECK_LAST_RUN_KEY, "2020-01-01", now_ms())
        session.commit()
    asyncio.run(job())
    assert calls["n"] == 2, "记录的是昨天 -> 允许再跑一轮"


def test_log_cleanup_job_runs_once_per_local_day(engine_and_sessionmaker, monkeypatch):
    _, factory = engine_and_sessionmaker
    from l07_jobs import log_cleanup as job_module

    calls = {"n": 0}

    def _counting_cleanup(*args, **kwargs):
        calls["n"] += 1
        return {"request_logs": 0, "request_log_payloads": 0, "request_attempts": 0}

    monkeypatch.setattr(job_module, "cleanup_job", _counting_cleanup)
    job = job_module.make_cleanup_job(factory)

    asyncio.run(job())
    asyncio.run(job())
    assert calls["n"] == 1, "同日第二次触发必须跳过"
    with factory() as session:
        assert get_setting(session, job_module.LOG_CLEANUP_LAST_RUN_KEY) == (
            datetime.now().astimezone().date().isoformat()
        )

    with factory() as session:
        put_setting(session, job_module.LOG_CLEANUP_LAST_RUN_KEY, "2020-01-01", now_ms())
        session.commit()
    asyncio.run(job())
    assert calls["n"] == 2


def test_models_dev_job_freshness_gate_skips_a_recent_successful_pull(
    engine_and_sessionmaker, monkeypatch
):
    """距上次成功拉取 <24h 的调度直接返回，不再打外部 API（P1-1 后果之一）。"""
    from l05_service import models_dev
    from l07_jobs import models_dev_sync as job_module

    _, factory = engine_and_sessionmaker
    fetches = {"n": 0}

    def _fake_fetch(*args, **kwargs):
        fetches["n"] += 1
        return {}

    monkeypatch.setattr(models_dev, "fetch_snapshot", _fake_fetch)

    first = job_module.models_dev_sync_job(factory)
    assert fetches["n"] == 1
    assert first["refreshed"] is True

    again = job_module.models_dev_sync_job(factory)
    assert fetches["n"] == 1, "24h 内的成功拉取必须让下一轮直接跳过"
    assert again["skipped"] is True

    with factory() as session:
        put_setting(
            session,
            job_module.MODELS_DEV_LAST_FETCH_KEY,
            str(now_ms() - 25 * 3600 * 1000),
            now_ms(),
        )
        session.commit()
    job_module.models_dev_sync_job(factory)
    assert fetches["n"] == 2, "超过 24h 的记录放行新一轮拉取"
