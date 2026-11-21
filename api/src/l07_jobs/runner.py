"""Minimal async job runner: per-job next-due scheduling with graceful shutdown.

Each registered job carries its own interval: the loop waits until the earliest
per-job due time, runs only the due jobs (sequentially awaited, so one job can
never re-enter itself), then advances that job by its own interval. A job
registered with ``daily=True`` anchors its first due time to just after the
NEXT local midnight (a random offset inside 00:05 spreads multi-replica
deployments) and re-anchors to the following midnight after each pass, so a
daily job really runs once per local day instead of once per fastest interval
(W6 review P1-1). Wall-clock (``time.time``) is the scheduler clock: daily
anchoring is inherently local-time based.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from datetime import datetime, timedelta

from l01_core.logging import setup_logging
from l01_core.timeutil import ms_to_iso

LOGGER = logging.getLogger("slipstream.jobs")

#: Daily jobs fire inside this window after local midnight; the random offset
#: keeps several replicas from hitting the same target at the same second.
DAILY_ANCHOR_JITTER_S = 5 * 60


def next_local_midnight(epoch_seconds: float) -> float:
    """Epoch seconds of the NEXT local midnight (strictly the following day)."""
    local = datetime.fromtimestamp(epoch_seconds).astimezone()
    following = (local + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return following.timestamp()


class JobRunner:
    """Runs registered async callables on per-job intervals until stopped."""

    def __init__(self) -> None:
        self._jobs: dict[str, tuple[object, float]] = {}
        self._daily: set[str] = set()
        self._stop = asyncio.Event()

    def register(
        self, name: str, coroutine_factory, interval_seconds: float, *, daily: bool = False
    ) -> None:
        """Register one job; ``daily=True`` anchors each pass to local midnight."""
        self._jobs[name] = (coroutine_factory, float(interval_seconds))
        if daily:
            self._daily.add(name)

    def stop(self) -> None:
        self._stop.set()

    def _daily_anchor(self, epoch_seconds: float) -> float:
        return next_local_midnight(epoch_seconds) + random.uniform(0.0, DAILY_ANCHOR_JITTER_S)

    def _advance(self, name: str, epoch_seconds: float) -> float:
        """The job's next due time after a pass: its own interval, daily re-anchored."""
        if name in self._daily:
            return self._daily_anchor(epoch_seconds)
        return epoch_seconds + self._jobs[name][1]

    async def run_forever(self) -> None:
        setup_logging()
        now = time.time()
        next_run: dict[str, float] = {}
        for name, (_factory, _interval) in self._jobs.items():
            if name in self._daily:
                next_run[name] = self._daily_anchor(now)
                LOGGER.info(
                    "job %s anchored to %s (daily)", name, ms_to_iso(int(next_run[name] * 1000))
                )
            else:
                next_run[name] = now
        LOGGER.info("job runner started with %d jobs", len(self._jobs))
        while not self._stop.is_set():
            now = time.time()
            for name, (factory, _interval) in self._jobs.items():
                if self._stop.is_set():
                    break
                if next_run[name] > now:
                    continue
                try:
                    await factory()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # external boundary: keep the loop alive
                    LOGGER.exception("job %s failed: %s", name, exc)
                next_run[name] = self._advance(name, time.time())
            if self._stop.is_set():
                break
            delay = min(next_run.values()) - time.time() if next_run else None
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=max(delay, 0.0) if delay is not None else None,
                )
            except TimeoutError:
                continue
        LOGGER.info("job runner stopped cleanly")


async def run_once(jobs: list[object]) -> None:
    """Run the given coroutine factories once, sequentially (tests and smoke runs)."""
    for factory in jobs:
        await factory()
