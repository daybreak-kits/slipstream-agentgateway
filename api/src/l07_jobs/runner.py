"""Minimal async job runner: sequential registered jobs with graceful shutdown."""

from __future__ import annotations

import asyncio
import logging

from l01_core.logging import setup_logging

LOGGER = logging.getLogger("slipstream.jobs")


class JobRunner:
    """Runs registered async callables on fixed intervals until stopped."""

    def __init__(self) -> None:
        self._jobs: dict[str, tuple[object, float]] = {}
        self._stop = asyncio.Event()

    def register(self, name: str, coroutine_factory, interval_seconds: float) -> None:
        self._jobs[name] = (coroutine_factory, interval_seconds)

    def stop(self) -> None:
        self._stop.set()

    async def run_forever(self) -> None:
        setup_logging()
        LOGGER.info("job runner started with %d jobs", len(self._jobs))
        while not self._stop.is_set():
            for name, (factory, _interval) in self._jobs.items():
                if self._stop.is_set():
                    break
                try:
                    await factory()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # external boundary: keep the loop alive
                    LOGGER.exception("job %s failed: %s", name, exc)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=min(
                    interval for _, interval in self._jobs.values()
                ) if self._jobs else None)
            except TimeoutError:
                continue
        LOGGER.info("job runner stopped cleanly")


async def run_once(jobs: list[object]) -> None:
    """Run the given coroutine factories once, sequentially (tests and smoke runs)."""
    for factory in jobs:
        await factory()
