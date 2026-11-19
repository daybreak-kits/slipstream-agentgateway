"""Daily models.dev snapshot sync (W4-H): fetch + adopt across all upstream models.

One cadence with log_cleanup (24h): a live fetch of the models.dev snapshot
followed by the same fill-blank adoption the console buttons trigger — blank
parameter/cost keys get filled, anything the user typed stays untouched. A
failed fetch keeps the previous snapshot (l05_service.models_dev handles the
degradation) and the job still adopts from it, so an offline deployment
converges from its last good snapshot instead of erroring out.

Registering here means the job follows SLIPSTREAM_JOBS_ENABLED like the other
in-process jobs; the manual console buttons hit the adopt endpoints directly.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy.orm import sessionmaker

from l01_core.settings import Settings, get_settings
from l05_service.models_dev import adopt_all

#: models.dev refreshes slowly; syncing daily is the ticketed cadence.
MODELS_DEV_INTERVAL_S = 24 * 3600

__all__ = ["MODELS_DEV_INTERVAL_S", "make_models_dev_job", "models_dev_sync_job"]


def models_dev_sync_job(
    session_factory: sessionmaker, settings: Settings | None = None
) -> dict:
    """One fetch + adopt pass; fetch failures degrade to the stored snapshot."""
    with session_factory() as session:
        summary = adopt_all(session, settings=settings, actor="job:models_dev_sync")
        session.commit()
        return summary


def make_models_dev_job(
    session_factory: sessionmaker, settings: Settings | None = None
) -> Callable[[], Awaitable[dict]]:
    """Coroutine factory registered with the JobRunner (daily cadence)."""
    resolved = settings or get_settings()

    async def _job() -> dict:
        return models_dev_sync_job(session_factory, resolved)

    return _job
