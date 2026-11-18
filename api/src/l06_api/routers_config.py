"""Configuration rollout routes: apply, rollback, revision history."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from l04_repo.orm import ConfigRevisionORM
from l05_service.auth import Principal
from l05_service.rollout import Rollout
from l06_api.deps import get_adapter, page_params, require, session_of
from l06_api.schemas import ApplyIn, ConfigRevisionOut, ConfigStatusOut

router = APIRouter(prefix="/admin/config", tags=["config"])


def _body(row: ConfigRevisionORM) -> ConfigRevisionOut:
    return ConfigRevisionOut.model_validate(row)


@router.post("/apply", response_model=ConfigRevisionOut)
def apply_config(
    payload: ApplyIn,
    session: Session = Depends(session_of),
    adapter=Depends(get_adapter),
    principal: Principal = Depends(require("config:write")),
) -> ConfigRevisionOut:
    row = Rollout(session, adapter).apply(principal.username, reason=payload.reason)
    assert row is not None  # the default "raise" policy never returns None
    session.commit()
    return _body(row)


@router.post("/rollback/{revision_id}", response_model=ConfigRevisionOut)
def rollback(
    revision_id: str,
    session: Session = Depends(session_of),
    adapter=Depends(get_adapter),
    principal: Principal = Depends(require("config:write")),
) -> ConfigRevisionOut:
    row = Rollout(session, adapter).rollback(revision_id, principal.username)
    session.commit()
    return _body(row)


@router.get("/status", response_model=ConfigStatusOut)
def config_status(
    session: Session = Depends(session_of),
    adapter=Depends(get_adapter),
    _principal: Principal = Depends(require("config:read")),
) -> ConfigStatusOut:
    """What the data plane serves now: real file hash / drift detail (S5).

    The driver compares the file on disk with the last apply marker; the JSON
    mirrors DataPlaneStatus and attaches the active archived revision so the
    dashboard can explain the source of truth without a second request.
    """
    snapshot = Rollout(session, adapter).status()
    return ConfigStatusOut(
        config_hash=snapshot.data_plane.config_hash,
        process_version=snapshot.data_plane.process_version,
        listening=snapshot.data_plane.listening,
        detail=snapshot.data_plane.detail,
        active_revision=_body(snapshot.active_revision) if snapshot.active_revision else None,
    )


@router.get("/revisions", response_model=list[ConfigRevisionOut])
def list_revisions(
    session: Session = Depends(session_of),
    _principal: Principal = Depends(require("config:read")),
    page_size: int = 50,
    offset: int = 0,
) -> list[ConfigRevisionOut]:
    limit, off = page_params(page_size, offset)
    rows = session.scalars(
        select(ConfigRevisionORM)
        .order_by(ConfigRevisionORM.created_at_ms.desc())
        .limit(limit)
        .offset(off)
    ).all()
    return [_body(r) for r in rows]
