"""Job wiring for the incremental usage pull (the logic lives in l05_service)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy.orm import sessionmaker

from l01_core.settings import Settings, get_settings
from l03_adapters.spi import DataPlaneAdapter
from l05_service.usage_pull import CURSOR_KEY, pull_once
from l06_api.adapter_factory import make_adapter

__all__ = ["CURSOR_KEY", "make_pull_job", "pull_job", "pull_once"]


async def pull_job(session_factory: sessionmaker, adapter: DataPlaneAdapter | None = None) -> int:
    """Runner-facing wrapper: opens a session, pulls once, commits."""
    if adapter is None:
        adapter = make_adapter(get_settings())
    with session_factory() as session:
        added = pull_once(session, adapter)
        session.commit()
        return added


def make_pull_job(
    session_factory: sessionmaker, settings: Settings | None = None
) -> Callable[[], Awaitable[int]]:
    """Coroutine factory registered with the JobRunner."""
    resolved = settings or get_settings()

    async def _job() -> int:
        return await pull_job(session_factory, make_adapter(resolved))

    return _job
