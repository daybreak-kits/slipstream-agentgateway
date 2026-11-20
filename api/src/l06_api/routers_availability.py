"""Availability rule routes (ADR-004: two kinds, one table).

The router is intentionally thin: validation, writes and projection sync live in
``l05_service.availability``. Ticket 10 removed the standalone availability page;
model availability is edited as row state on the model page, while this rule API
stays for scoped bans/cooldowns.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from l03_adapters.spi import DataPlaneAdapter
from l04_repo.orm import AvailabilityRuleORM
from l04_repo.repository import AVAILABILITY_REPO
from l05_service import availability
from l05_service.rollout import Rollout
from l06_api.deps import get_adapter, page_params, require, session_of
from l06_api.schemas import RuleCreate, RulePatch

router = APIRouter(prefix="/admin/availability-rules", tags=["availability"])


def _apply(
    session: Session, adapter: DataPlaneAdapter, principal, *, reason: str
) -> None:
    """Write-then-apply (ticket 02): availability writes push the data plane.

    rules_changed_since only sees rules whose effective state *changed over
    time*, so create/update/delete of a rule would otherwise wait for a manual
    apply (or the job's window boundary) before the router honoured it.
    """
    # keep-booked：行已提交，渲染失败（例如所有目标临时冷却导致无路由可下发）
    # 不应把已生效的业务写入变成 502；下一次可用性写或 job 会再次下发。
    Rollout(session, adapter).apply(
        principal.username, reason=reason, on_failure="keep-booked"
    )
    session.commit()


def _body(row: AvailabilityRuleORM) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "scope": row.scope,
        "scope_id": row.scope_id,
        "recurrence": row.recurrence,
        "expires_at_ms": row.expires_at_ms,
        "schedule_json": row.schedule_json,
        "note": row.note,
        "created_at_ms": row.created_at_ms,
    }


@router.post("", status_code=201)
def create_rule(
    payload: RuleCreate,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal=Depends(require("availability:write")),
) -> dict:
    row = availability.create_rule(
        session,
        kind=payload.kind,
        scope=payload.scope,
        scope_id=payload.scope_id,
        recurrence=payload.recurrence,
        expires_at_ms=payload.expires_at_ms,
        schedule_json=payload.schedule_json,
        note=payload.note,
    )
    session.commit()
    _apply(session, adapter, principal, reason="availability-rule-create")
    return _body(row)


@router.get("")
def list_rules(
    session: Session = Depends(session_of),
    page_size: int = 50,
    offset: int = 0,
    principal=Depends(require("availability:read")),
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    return [_body(r) for r in AVAILABILITY_REPO.list_all(session, limit=limit, offset=off)]


@router.patch("/{rule_id}")
def update_rule(
    rule_id: str,
    payload: RulePatch,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal=Depends(require("availability:write")),
) -> dict:
    row = availability.update_rule(
        session, rule_id, payload.model_dump(exclude_unset=True)
    )
    session.commit()
    _apply(session, adapter, principal, reason="availability-rule-update")
    return _body(row)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(
    rule_id: str,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal=Depends(require("availability:write")),
) -> None:
    availability.delete_rule(session, rule_id)
    session.commit()
    _apply(session, adapter, principal, reason="availability-rule-delete")
