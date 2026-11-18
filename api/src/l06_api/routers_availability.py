"""Availability rule routes (ADR-004: two kinds, one table).

The router is intentionally thin: validation, writes and projection sync live in
``l05_service.availability``. Ticket 10 removed the standalone availability page;
model availability is edited as row state on the model page, while this rule API
stays for scoped bans/cooldowns.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from l04_repo.orm import AvailabilityRuleORM
from l04_repo.repository import AVAILABILITY_REPO
from l05_service import availability
from l06_api.deps import page_params, require, session_of
from l06_api.schemas import RuleCreate, RulePatch

router = APIRouter(prefix="/admin/availability-rules", tags=["availability"])


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
    principal=Depends(require("availability:write")),
) -> dict:
    row = availability.update_rule(
        session, rule_id, payload.model_dump(exclude_unset=True)
    )
    session.commit()
    return _body(row)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(
    rule_id: str,
    session: Session = Depends(session_of),
    principal=Depends(require("availability:write")),
):
    availability.delete_rule(session, rule_id)
    session.commit()
