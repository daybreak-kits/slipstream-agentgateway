"""Job wiring for the in-process background runner (PLAN §6).

Three periodic jobs run inside the control-plane process: incremental usage pull
(l05_service.usage_pull), cooldown expiry re-render (ADR-004) and the ledger/balance
reconcile (ADR-011). They share one interval (`job_interval_seconds`); a job that
needs a different cadence can be re-registered with its own.

The runner starts only when `jobs_enabled` is true, and the app factory exposes the
created runner on `app.state.job_runner` (None when disabled) so tests can assert both
states without racing a live background task. `SLIPSTREAM_JOBS_ENABLED=0` is the env
switch for the disabled state; a deployment running these on a separate worker sets it
and invokes `python -m l07_jobs.worker` instead.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy.orm import sessionmaker

from l01_core.settings import Settings, get_settings
from l07_jobs.cooldown_rerender import make_rerender_job
from l07_jobs.reconcile import make_reconcile_job
from l07_jobs.runner import JobRunner
from l07_jobs.usage_pull import make_pull_job

LOGGER = logging.getLogger("slipstream.jobs")


def build_runner(session_factory: sessionmaker, settings: Settings | None = None) -> JobRunner:
    """A runner with the three periodic jobs registered at the configured interval."""
    resolved = settings or get_settings()
    runner = JobRunner()
    interval = float(resolved.job_interval_seconds)
    runner.register("usage_pull", make_pull_job(session_factory, resolved), interval)
    runner.register(
        "cooldown_rerender", make_rerender_job(session_factory, interval), interval
    )
    runner.register("reconcile", make_reconcile_job(session_factory, resolved), interval)
    return runner


def start_runner(app, session_factory: sessionmaker, settings: Settings | None = None):
    """Register the runner on the app lifespan; returns the runner or None when disabled.

    The loop is started from the ASGI startup hook, not at build time, so nothing
    runs until the app actually serves; the shutdown hook stops it cleanly.
    """
    resolved = settings or get_settings()
    if not resolved.jobs_enabled:
        app.state.job_runner = None
        return None
    runner = build_runner(session_factory, resolved)
    app.state.job_runner = runner
    app.router.add_event_handler("startup", lambda: asyncio.create_task(runner.run_forever()))
    app.router.add_event_handler("shutdown", runner.stop)
    return runner


async def run_jobs_once(session_factory: sessionmaker, settings: Settings | None = None) -> None:
    """One tick of every job, sequentially; for smoke tests and manual runs."""
    from l07_jobs.runner import run_once

    resolved = settings or get_settings()
    runner = build_runner(session_factory, resolved)
    await run_once([factory for factory, _interval in runner._jobs.values()])
