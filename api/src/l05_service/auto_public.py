"""Auto-expose every upstream model under <upstream>/<model>.

W9 decision: an upstream model is directly callable without a hand-authored
public model. The name is deterministic because upstream names are unique; the
row is marked auto_generated so the console can badge it and deletion can clean
it up without touching user-authored public models.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l04_repo.orm import ModelTargetORM, PublicModelORM, UpstreamModelORM, UpstreamORM

logger = logging.getLogger(__name__)


def auto_public_name(upstream_name: str, model_name: str) -> str:
    return f"{upstream_name}/{model_name}"


def _find_by_name(session: Session, name: str) -> PublicModelORM | None:
    return session.scalars(
        select(PublicModelORM).where(PublicModelORM.name == name)
    ).first()


def _target(
    session: Session, public_model_id: str, upstream_model_id: str
) -> ModelTargetORM | None:
    return session.scalars(
        select(ModelTargetORM).where(
            ModelTargetORM.public_model_id == public_model_id,
            ModelTargetORM.upstream_model_id == upstream_model_id,
        )
    ).first()


def ensure_auto_public_model(
    session: Session, upstream_model: UpstreamModelORM, *, actor: str = ""
) -> PublicModelORM:
    """Create (or reuse) the direct-call public model for one upstream model.

    Idempotent. If a hand-authored public model already has the deterministic
    name and already routes to this model, it is reused untouched; if the name is
    taken by an unrelated hand-authored row we fail loudly instead of silently
    hijacking it (the upstream/model name pair generates a predictable name, so a
    collision is a real namespace conflict).
    """
    upstream = session.get(UpstreamORM, upstream_model.upstream_id)
    if upstream is None:
        raise AppError(
            ErrorCode.NOT_FOUND, f"upstream not found: {upstream_model.upstream_id}"
        )
    name = auto_public_name(upstream.name, upstream_model.name)
    public = _find_by_name(session, name)
    if public is None:
        public = PublicModelORM(
            id=new_id("pmdl"),
            name=name,
            routing_mode="failover",
            enabled=True,
            note="自动注册：上游 / 模型直接调用名",
            auto_generated=True,
            created_at_ms=now_ms(),
        )
        session.add(public)
        session.flush()
    elif _target(session, public.id, upstream_model.id) is None:
        if not public.auto_generated:
            raise AppError(
                ErrorCode.CONFLICT,
                f"公开模型名称已被手建模型占用: {name}",
                details={"name": name, "public_model_id": public.id},
            )
    if _target(session, public.id, upstream_model.id) is None:
        session.add(
            ModelTargetORM(
                id=new_id("mtgt"),
                public_model_id=public.id,
                upstream_model_id=upstream_model.id,
                priority=0,
                weight=0,
                enabled=True,
                created_at_ms=now_ms(),
            )
        )
        session.flush()
    return public


def ensure_for_upstream(
    session: Session, upstream_id: str, *, actor: str = ""
) -> list[PublicModelORM]:
    models = list(
        session.scalars(
            select(UpstreamModelORM).where(UpstreamModelORM.upstream_id == upstream_id)
        ).all()
    )
    return [ensure_auto_public_model(session, model, actor=actor) for model in models]


def ensure_all(session: Session, *, actor: str = "") -> int:
    """Backfill helper: every existing upstream model gets its direct-call row."""
    created = 0
    for model in session.scalars(select(UpstreamModelORM)).all():
        upstream = session.get(UpstreamORM, model.upstream_id)
        if upstream is None:
            # Orphan rows can exist in fixtures/legacy data; the FK is logical,
            # not enforced, so backfill skips them instead of aborting startup.
            continue
        public = _find_by_name(
            session,
            auto_public_name(upstream.name, model.name),
        )
        try:
            ensure_auto_public_model(session, model, actor=actor)
        except AppError as exc:
            # Backfill must not take the control plane down: a hand-authored
            # public model can legitimately occupy the deterministic name.
            # Creation paths still surface the conflict; startup only logs it.
            logger.warning(
                "auto public model skipped for %s/%s: %s",
                upstream.name,
                model.name,
                exc.message,
            )
            continue
        if public is None:
            created += 1
    return created


def rename_for_upstream_model(
    session: Session,
    upstream_model: UpstreamModelORM,
    *,
    old_model_name: str,
) -> PublicModelORM | None:
    """Keep the direct-call name in sync when an upstream model is renamed.

    Only auto-generated rows are touched. A hand-authored row at the old name is
    left alone (it is an alias the operator chose), so the new direct-call name
    will be created lazily on the next ensure call.
    """
    if old_model_name == upstream_model.name:
        return None
    upstream = session.get(UpstreamORM, upstream_model.upstream_id)
    if upstream is None:
        return None
    old_name = auto_public_name(upstream.name, old_model_name)
    public = _find_by_name(session, old_name)
    if public is None or not public.auto_generated:
        return None
    new_name = auto_public_name(upstream.name, upstream_model.name)
    existing = _find_by_name(session, new_name)
    if existing is not None and existing.id != public.id:
        raise AppError(
            ErrorCode.CONFLICT,
            f"公开模型名称已被占用: {new_name}",
            details={"name": new_name, "public_model_id": existing.id},
        )
    public.name = new_name
    session.flush()
    return public


def remove_for_upstream_model(
    session: Session, upstream_model_id: str
) -> list[PublicModelORM]:
    """Drop the auto row/target when its upstream model disappears.

    Only rows with auto_generated=True are removed. A hand-authored public model
    that still points at the model is left alone (and the caller keeps its
    existing referenced-delete guard).
    """
    removed: list[PublicModelORM] = []
    targets = list(
        session.scalars(
            select(ModelTargetORM).where(
                ModelTargetORM.upstream_model_id == upstream_model_id
            )
        ).all()
    )
    for target in targets:
        public = session.get(PublicModelORM, target.public_model_id)
        if public is None or not public.auto_generated:
            continue
        session.delete(target)
        remaining = session.scalars(
            select(ModelTargetORM).where(
                ModelTargetORM.public_model_id == public.id,
                ModelTargetORM.id != target.id,
            )
        ).first()
        if remaining is None:
            session.delete(public)
            removed.append(public)
    session.flush()
    return removed
