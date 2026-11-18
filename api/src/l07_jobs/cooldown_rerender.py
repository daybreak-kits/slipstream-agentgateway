"""Re-render the data plane when a cooldown window just expired (ADR-002)."""

from __future__ import annotations

from sqlalchemy.orm import Session, sessionmaker

from l01_core.timeutil import now_ms
from l04_repo.orm import AvailabilityRuleORM
from l05_service.availability import rules_changed_since, sync_all_cooldown_projections
from l05_service.rollout import Rollout
from l06_api.adapter_factory import get_adapter


def expired_since(session: Session, since_ms: int) -> list[AvailabilityRuleORM]:
    """Cooldown rules whose active state changed in (since_ms, now].

    Broader than once-expiry: a recurring daily/weekly/monthly window opening or
    closing is also a configuration change the data plane must re-render for.
    """
    return rules_changed_since(session, since_ms, now_ms())


def rerender_if_cooldowns_expired(
    session: Session, *, since_ms: int, operator: str = "job"
) -> str | None:
    """Apply a fresh revision when cooldowns expired in the window; else None."""
    if expired_since(session, since_ms):
        # Keep the legacy projection column in step with the rule table before
        # the new revision reads the evaluator.
        sync_all_cooldown_projections(session)
        row = Rollout(session, get_adapter()).apply(operator, reason="cooldown-expiry")
        return row.id if row else None
    return None


async def rerender_job(session_factory: sessionmaker, poll_seconds: float) -> str | None:
    """Runner-facing wrapper: tracks the last check in-process (v1, no persistence)."""
    current = now_ms()
    with session_factory() as session:
        revision = rerender_if_cooldowns_expired(
            session, since_ms=current - int(poll_seconds * 1000) - 1
        )
        session.commit()
        return revision


def make_rerender_job(session_factory: sessionmaker, poll_seconds: float):
    async def _job() -> str | None:
        return await rerender_job(session_factory, poll_seconds)

    return _job
