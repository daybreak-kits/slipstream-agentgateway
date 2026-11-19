"""Job wiring: the app starts the three periodic jobs, or not when disabled.

P0-3 regression: l07_jobs existed with factories but nothing ever registered them,
so no background task ran in a real deployment. These tests pin both states of the
switch (app flag and `jobs_enabled` setting) and smoke-run one tick of each job.
"""

from __future__ import annotations

from fastapi import FastAPI

from l01_core.settings import Settings
from l04_repo.orm import LedgerEntryORM, UserORM
from l07_jobs import wiring
from server import create_app


def test_app_registers_the_runner_when_jobs_enabled(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    app = create_app(session_factory=factory, init_tables=False, jobs=True)
    runner = app.state.job_runner
    assert runner is not None, "the app must register a JobRunner when jobs are on"
    assert set(runner._jobs) == {"usage_pull", "cooldown_rerender", "reconcile"}
    # Every job shares the configured interval unless re-registered.
    assert {interval for _f, interval in runner._jobs.values()} == {60.0}


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


def test_one_tick_runs_every_job_without_touching_balances(engine_and_sessionmaker):
    """Smoke: a full tick is safe on a clean DB - the reconcile keeps balances put."""
    import asyncio

    from l01_core.timeutil import now_ms
    from l05_service import balances

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

    asyncio.run(wiring.run_jobs_once(factory))

    with factory() as session:
        assert session.get(UserORM, "usr_smoke").balance_micro == before
        assert session.query(LedgerEntryORM).count() == ledger_before
