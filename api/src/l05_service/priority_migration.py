"""Ticket 08: migrate legacy model-target priority semantics to v2.

Legacy data encoded preference as "bigger wins"; v2 renders priority as the sort
key where smaller is preferred (docs/contracts/ir-and-rendering.md §3,
sort_targets ascending). legacy_priority_to_v2 flips one model's scale, and this
module applies it per public model (max_priority differs per model) while the
priority_semantics app setting records that the data has been migrated, so a
second run is a no-op instead of flipping the values back.

Only failover public models are touched: weighted targets carry a weight ratio
and conditional targets carry when_expr; neither has a meaningful ordering.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.timeutil import now_ms
from l02_domain.ir import legacy_priority_to_v2
from l04_repo.orm import ModelTargetORM, PublicModelORM
from l04_repo.repository import get_setting, put_setting

SEMANTICS_KEY = "priority_semantics"
SEMANTICS_LEGACY = "legacy"
SEMANTICS_V2 = "v2"


@dataclass(frozen=True, slots=True)
class TargetChange:
    """One planned priority flip; old/new are both recorded for the audit trail."""

    target_id: str
    public_model_id: str
    old_priority: int
    new_priority: int


@dataclass(frozen=True, slots=True)
class MigrationPlan:
    """Dry-run result; apply_priority_migration executes exactly these changes."""

    semantics: str
    already_v2: bool
    changes: tuple[TargetChange, ...] = ()

    @property
    def changed(self) -> int:
        return len(self.changes)


def stored_semantics(session: Session) -> str:
    """Recorded priority semantics; "unknown" for databases migrated before v2."""
    raw = get_setting(session, SEMANTICS_KEY)
    if not raw:
        return "unknown"
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return "unknown"
    value = payload.get("semantics") if isinstance(payload, dict) else payload
    return value if value in (SEMANTICS_LEGACY, SEMANTICS_V2) else "unknown"


def plan_priority_migration(
    session: Session, *, semantics: str = SEMANTICS_LEGACY
) -> MigrationPlan:
    """Plan the flip: legacy scales are converted, v2 data is left untouched.

    The stored marker always wins, so applying twice can never flip data back.
    """
    if semantics not in (SEMANTICS_LEGACY, SEMANTICS_V2):
        raise ValueError(f"unknown priority semantics: {semantics}")
    current = stored_semantics(session)
    if current == SEMANTICS_V2:
        return MigrationPlan(semantics=SEMANTICS_V2, already_v2=True)
    if semantics == SEMANTICS_V2:
        # Data already uses v2 ordering; only the marker needs recording.
        return MigrationPlan(semantics=SEMANTICS_V2, already_v2=False)
    changes: list[TargetChange] = []
    for public in session.scalars(select(PublicModelORM).order_by(PublicModelORM.id)).all():
        if public.routing_mode != "failover":
            continue
        rows = list(
            session.scalars(
                select(ModelTargetORM)
                .where(ModelTargetORM.public_model_id == public.id)
                .order_by(ModelTargetORM.priority)
            ).all()
        )
        if not rows:
            continue
        max_priority = max(row.priority for row in rows)
        for row in rows:
            new_priority = legacy_priority_to_v2(row.priority, max_priority)
            if new_priority != row.priority:
                changes.append(
                    TargetChange(row.id, public.id, row.priority, new_priority)
                )
    return MigrationPlan(semantics=SEMANTICS_LEGACY, already_v2=False, changes=tuple(changes))


def apply_priority_migration(session: Session, plan: MigrationPlan) -> MigrationPlan:
    """Write the planned priorities and record the v2 marker (idempotent)."""
    if plan.already_v2:
        return plan
    for change in plan.changes:
        target = session.get(ModelTargetORM, change.target_id)
        if target is not None:
            target.priority = change.new_priority
    put_setting(
        session,
        SEMANTICS_KEY,
        json.dumps({"semantics": SEMANTICS_V2, "migrated_at_ms": now_ms()}),
        now_ms(),
    )
    session.flush()
    return plan
