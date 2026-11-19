"""Periodic reconcile job: ledger sums vs user balances (ADR-011 / billing §6).

The AG budget bucket resets on restart and bills one request ahead, so the
control-plane ledger is the only authority. On drift (manual DB edits, partial
failures) this job rewrites balance_micro from ledger sums and then triggers one
re-render so the data-plane buckets see corrected balances.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy.orm import Session, sessionmaker

from l01_core.settings import Settings, get_settings
from l05_service.balances import reconcile_balances
from l05_service.rollout import Rollout
from l06_api.adapter_factory import get_adapter

RECONCILE_INTERVAL_S = 600


def reconcile_once(session: Session) -> list[str]:
    """Recompute balances from the ledger; returns the changed user ids."""
    return reconcile_balances(session)


async def reconcile_job(session_factory: sessionmaker, settings: Settings | None = None) -> int:
    """Runner-facing wrapper; a non-empty change list triggers one re-render."""
    with session_factory() as session:
        changed = reconcile_balances(session)
        if changed:
            session.commit()
            try:
                Rollout(session, get_adapter()).apply(
                    "reconcile-job", reason="balance-reconciled"
                )
                session.commit()
            except Exception:
                session.rollback()  # balances stay corrected; retry on next tick
        return len(changed)


def make_reconcile_job(
    session_factory: sessionmaker, settings: Settings | None = None
) -> Callable[[], Awaitable[int]]:
    """Coroutine factory registered with the JobRunner."""
    resolved = settings or get_settings()

    async def _job() -> int:
        return await reconcile_job(session_factory, resolved)

    return _job
