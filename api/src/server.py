"""Composition root: the control-plane app plus in-process side services.

ADR-010 (DECISIONS.md) forbids l06_api from importing l07_jobs, so the job
wiring lives here, at the top of the dependency graph: l06 builds the app, l07
starts the runner, and this module composes them. ADR-028 adds the adapter-owned
telemetry intake; a bind failure is a warning, never a crash.
This file is not a numbered layer (no lXX_ prefix), so the downward-import lint
leaves it alone.

Run:  cd api && uvicorn server:create_app --factory --port 3700
Disable the jobs with SLIPSTREAM_JOBS_ENABLED=0 (or jobs=False for tests and
single-purpose workers); the runner then never starts and app.state.job_runner
is None.
"""

from __future__ import annotations

from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from l01_core.settings import get_settings
from l03_adapters.registry import start_telemetry
from l05_service.attempts import build_attempt_sink
from l06_api.adapter_factory import make_adapter
from l06_api.app import create_app as build_api_app
from l07_jobs.wiring import start_runner


def create_app(
    session_factory: sessionmaker | None = None,
    *,
    init_tables: bool = True,
    jobs: bool | None = None,
) -> FastAPI:
    """The full control plane; `jobs` overrides SLIPSTREAM_JOBS_ENABLED."""
    app = build_api_app(session_factory=session_factory, init_tables=init_tables)
    settings = get_settings()
    if jobs is not None:
        settings = settings.model_copy(update={"jobs_enabled": jobs})
    start_runner(app, app.state.session_factory, settings)
    # ADR-028/ADR-029: the selected adapter owns its telemetry intake; the
    # composition root only supplies the normalized-attempt sink. The registry
    # delegates the lifecycle without branching on an adapter name, and a bind
    # failure degrades to a warning and never stops the control plane.
    adapter = make_adapter(settings)
    start_telemetry(app, build_attempt_sink(app.state.session_factory), adapter)
    return app
