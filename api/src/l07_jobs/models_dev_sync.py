"""Daily models.dev snapshot sync (W4-H): fetch + adopt across all upstream models.

One cadence with log_cleanup (24h): a live fetch of the models.dev snapshot
followed by the same fill-blank adoption the console buttons trigger — blank
parameter/cost keys get filled, anything the user typed stays untouched. A
failed fetch keeps the previous snapshot (l05_service.models_dev handles the
degradation) and the job still adopts from it, so an offline deployment
converges from its last good snapshot instead of erroring out.

The runner anchors the pass to just after local midnight, and the job itself
carries a freshness gate: a pull younger than 24h (app_settings
``models_dev_last_fetch_ms``) satisfies the cadence, so a restart or a second
replica never re-hits the external API on the same day (W6 review P1-1). The
manual console buttons hit the adopt endpoints directly and are never gated.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy.orm import sessionmaker

from l01_core.settings import Settings, get_settings
from l01_core.timeutil import now_ms
from l04_repo.repository import get_setting, put_setting
from l05_service.models_dev import adopt_all

#: models.dev refreshes slowly; syncing daily is the ticketed cadence.
MODELS_DEV_INTERVAL_S = 24 * 3600

#: app_settings key recording the last SUCCESSFUL pull (epoch ms, raw string
#: like the usage cursor); a pull younger than the cadence skips the fetch.
MODELS_DEV_LAST_FETCH_KEY = "models_dev_last_fetch_ms"
MODELS_DEV_FRESH_WINDOW_MS = MODELS_DEV_INTERVAL_S * 1000

__all__ = [
    "MODELS_DEV_FRESH_WINDOW_MS",
    "MODELS_DEV_INTERVAL_S",
    "MODELS_DEV_LAST_FETCH_KEY",
    "make_models_dev_job",
    "models_dev_sync_job",
]


def models_dev_sync_job(
    session_factory: sessionmaker, settings: Settings | None = None
) -> dict:
    """One fetch + adopt pass; fetch failures degrade to the stored snapshot.

    Freshness gate (W6 review P1-1): when the last successful pull is younger
    than 24h the pass returns without touching the external API. Freshness is
    recorded only after a successful refresh, so a failed pull retries on the
    next scheduled pass.
    """
    with session_factory() as session:
        last_raw = get_setting(session, MODELS_DEV_LAST_FETCH_KEY)
        try:
            last_ms = int(last_raw) if last_raw is not None else None
        except (TypeError, ValueError):
            last_ms = None  # corrupt record self-heals: treated as never pulled
        if last_ms is not None and now_ms() - last_ms < MODELS_DEV_FRESH_WINDOW_MS:
            return {"refreshed": False, "skipped": True}
        summary = adopt_all(session, settings=settings, actor="job:models_dev_sync")
        if summary.get("refreshed"):
            put_setting(session, MODELS_DEV_LAST_FETCH_KEY, str(now_ms()), now_ms())
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
