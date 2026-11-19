"""Upstream model / public model / model-target routes (ticket 10).

One page, two tabs (old catalog): an upstream model is the technical record
(type, type source, parameters, cost, markup, availability); a public model is
the alias operators hand out (members, strategy, priority/weight, availability).

Availability is evaluated from the availability_rules table (ADR-004):
enabled=False is 关闭 (manual, long-term); an active ban or cooldown is 冷却 or
closed; the API returns the unified availability.state from availability.evaluate.
cooldown_until_ms is a projection of the rules, never interpreted here. Daily/
weekly/monthly periodic cooldowns remain supported at the rule layer (the console
does not expose a schedule editor). Cost/markup keys are omitted entirely for
principals without billing:cost, so the console cannot render the numbers even by
accident (spec :104-105).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l04_repo.orm import (
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
    UpstreamORM,
    VendorORM,
)
from l04_repo.repository import (
    MODEL_TARGET_REPO,
    PUBLIC_MODEL_REPO,
    UPSTREAM_MODEL_REPO,
)
from l05_service import crud, pricing
from l05_service.availability import (
    SCOPE_PUBLIC_MODEL,
    SCOPE_UPSTREAM_MODEL,
    AvailabilitySnapshot,
    enable_model_availability,
    evaluate,
    release_model_cooldown,
    set_model_cooldown,
    validate_cooldown_until,
)
from l05_service.model_params import (
    canonical_parameters,
    decode_parameters,
    validate_type_source,
)
from l06_api.deps import page_params, require, session_of
from l06_api.schemas import (
    ModelBulk,
    ModelTargetCreate,
    ModelTargetUpdate,
    PublicModelCreate,
    PublicModelPatch,
    PublicModelTargets,
    UpstreamModelCreate,
    UpstreamModelPatch,
)

router = APIRouter(tags=["models"])


def _um_body(
    row: UpstreamModelORM,
    *,
    availability: AvailabilitySnapshot,
    upstream_name: str = "",
    vendor_name: str = "",
    target_count: int = 0,
) -> dict:
    state = availability.upstream_model_view(row)
    body = {
        "id": row.id,
        "upstream_id": row.upstream_id,
        "upstream_name": upstream_name,
        "vendor_name": vendor_name,
        "name": row.name,
        "model_type": row.model_type,
        "model_type_source": row.model_type_source or "default",
        "parameters": decode_parameters(row.parameters_json),
        "enabled": row.enabled,
        "cooldown_until_ms": state.cooldown_until_ms,
        "availability": state.as_dict(),
        "target_count": target_count,
        "created_at_ms": row.created_at_ms,
        # Ticket 05 price book; Decimal travels as a string so no float ever
        # touches a price. These keys are removed for callers without
        # billing:cost by the central response filter, never turned into null.
        "cost_input_per_1m": pricing.decimal_text(row.cost_input_per_1m),
        "cost_output_per_1m": pricing.decimal_text(row.cost_output_per_1m),
        "markup": pricing.markup_text(row.markup),
    }
    return body


def _mt_body(row: ModelTargetORM, names: dict[str, tuple[str, str]]) -> dict:
    model_name, upstream_name = names.get(row.upstream_model_id, ("", ""))
    return {
        "id": row.id,
        "public_model_id": row.public_model_id,
        "upstream_model_id": row.upstream_model_id,
        "upstream_model_name": model_name,
        "upstream_name": upstream_name,
        "priority": row.priority,
        "weight": row.weight,
        "when": row.when_expr,
        "enabled": row.enabled,
    }


def _pm_body(
    row: PublicModelORM,
    *,
    targets: list[ModelTargetORM],
    names: dict[str, tuple[str, str]],
    availability: AvailabilitySnapshot,
) -> dict:
    state = availability.public_model_view(row)
    return {
        "id": row.id,
        "name": row.name,
        "routing_mode": row.routing_mode,
        "note": row.note,
        "enabled": row.enabled,
        "cooldown_until_ms": state.cooldown_until_ms,
        "availability": state.as_dict(),
        "target_count": len(targets),
        "targets": [_mt_body(target, names) for target in targets],
        "created_at_ms": row.created_at_ms,
    }


def _model_names(session: Session) -> dict[str, tuple[str, str]]:
    upstreams = {u.id: u.name for u in session.scalars(select(UpstreamORM)).all()}
    names: dict[str, tuple[str, str]] = {}
    for model in session.scalars(select(UpstreamModelORM)).all():
        names[model.id] = (model.name, upstreams.get(model.upstream_id, ""))
    return names


def _um_names(session: Session, row: UpstreamModelORM) -> tuple[str, str]:
    upstream = session.get(UpstreamORM, row.upstream_id)
    if upstream is None:
        return "", ""
    vendor = session.get(VendorORM, upstream.vendor_id)
    return upstream.name, (vendor.name if vendor else "")


def _targets_by_public(
    session: Session, public_model_ids: list[str]
) -> dict[str, list[ModelTargetORM]]:
    grouped: dict[str, list[ModelTargetORM]] = {}
    if not public_model_ids:
        return grouped
    rows = session.scalars(
        select(ModelTargetORM).where(ModelTargetORM.public_model_id.in_(public_model_ids))
    ).all()
    for row in rows:
        grouped.setdefault(row.public_model_id, []).append(row)
    for items in grouped.values():
        items.sort(key=lambda target: (target.priority, target.id))
    return grouped


def _apply_cost_fields(row: UpstreamModelORM, payload) -> None:
    provided = payload.model_fields_set
    for field in ("cost_input_per_1m", "cost_output_per_1m"):
        if field in provided:
            setattr(row, field, pricing.validate_cost(getattr(payload, field), field))
    if "markup" in provided:
        if payload.markup is None:
            raise AppError(ErrorCode.VALIDATION_ERROR, "markup 不能为空")
        row.markup = pricing.validate_markup(payload.markup)


# ---------------------------------------------------------------- upstream models


@router.post(
    "/admin/upstream-models",
    status_code=201,
    dependencies=[Depends(require("billing:cost"))],
)
def create_upstream_model(
    payload: UpstreamModelCreate,
    session: Session = Depends(session_of),
    principal=Depends(require("upstream_models:write")),
) -> dict:
    """Create a model; cost/markup ride the same payload, so the billing:cost gate
    mirrors the PATCH route (P2: symmetric write permission for price fields)."""
    row = crud.create_upstream_model(
        session,
        upstream_id=payload.upstream_id,
        name=payload.name,
        model_type=payload.model_type,
        model_type_source=payload.model_type_source,
        parameters=payload.parameters,
        enabled=payload.enabled,
        actor=principal.admin_id,
    )
    _apply_cost_fields(row, payload)
    session.commit()
    upstream_name, vendor_name = _um_names(session, row)
    return _um_body(
        row,
        upstream_name=upstream_name,
        vendor_name=vendor_name,
        availability=evaluate(session),
    )


@router.get("/admin/upstream-models")
def list_upstream_models(
    session: Session = Depends(session_of),
    page_size: int = 50,
    offset: int = 0,
    principal=Depends(require("upstream_models:read")),
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    models = UPSTREAM_MODEL_REPO.list_all(session, limit=limit, offset=off)
    upstreams = {u.id: u for u in session.scalars(select(UpstreamORM)).all()}
    vendors = {v.id: v for v in session.scalars(select(VendorORM)).all()}
    counts = {
        key: int(value)
        for key, value in session.execute(
            select(ModelTargetORM.upstream_model_id, func.count()).group_by(
                ModelTargetORM.upstream_model_id
            )
        ).all()
    }
    availability = evaluate(session)
    items: list[dict] = []
    for model in models:
        upstream = upstreams.get(model.upstream_id)
        vendor = vendors.get(upstream.vendor_id) if upstream else None
        items.append(
            _um_body(
                model,
                upstream_name=upstream.name if upstream else "",
                vendor_name=vendor.name if vendor else "",
                target_count=counts.get(model.id, 0),
                availability=availability,
            )
        )
    return items


@router.patch("/admin/upstream-models/batch")
def batch_upstream_models(
    payload: ModelBulk,
    session: Session = Depends(session_of),
    principal=Depends(require("upstream_models:write")),
) -> dict:
    return _apply_batch(
        session,
        UPSTREAM_MODEL_REPO,
        ids=payload.ids,
        action=payload.action,
        cooldown_until_ms=payload.cooldown_until_ms,
        actor=principal.admin_id,
    )


@router.patch(
    "/admin/upstream-models/{upstream_model_id}",
    dependencies=[Depends(require("billing:cost"))],
)
def update_upstream_model(
    upstream_model_id: str,
    payload: UpstreamModelPatch,
    session: Session = Depends(session_of),
    principal=Depends(require("upstream_models:write")),
) -> dict:
    """Edit everything the old channel-model dialog edited.

    Declared after the static /batch route so "batch" is never captured as an id.
    Omitted fields stay untouched; an explicit null cost clears it (unpriced).
    """
    row = UPSTREAM_MODEL_REPO.get(session, upstream_model_id)
    if row is None:
        raise AppError(
            ErrorCode.NOT_FOUND, f"upstream model not found: {upstream_model_id}"
        )
    provided = payload.model_fields_set
    if "name" in provided:
        name = (payload.name or "").strip()
        if not name:
            raise AppError(ErrorCode.VALIDATION_ERROR, "模型名称不能为空")
        row.name = name
    if "model_type" in provided:
        if payload.model_type is None:
            raise AppError(ErrorCode.VALIDATION_ERROR, "model_type 不能为空")
        row.model_type = crud.validate_model_type(payload.model_type)
    if "model_type_source" in provided:
        if payload.model_type_source is None:
            raise AppError(ErrorCode.VALIDATION_ERROR, "model_type_source 不能为空")
        row.model_type_source = validate_type_source(payload.model_type_source)
    if "parameters" in provided:
        row.parameters_json = canonical_parameters(payload.parameters)
    window_skip = None
    if "enabled" in provided:
        if payload.enabled is None:
            raise AppError(ErrorCode.VALIDATION_ERROR, "enabled 不能为空")
        row.enabled = payload.enabled
        if payload.enabled:  # 启用=解除关闭+托管冷却；周期窗口内仅跳过当前窗口（GLOSSARY §3）
            window_skip = enable_model_availability(
                session, scope=SCOPE_UPSTREAM_MODEL, scope_id=row.id
            )
    if "cooldown_until_ms" in provided:
        if payload.cooldown_until_ms:
            set_model_cooldown(
                session,
                scope=SCOPE_UPSTREAM_MODEL,
                scope_id=row.id,
                until_ms=payload.cooldown_until_ms,
            )
        else:
            # 解除冷却 (GLOSSARY §3): 托管规则与窗口例外一并清除，周期规则重获效力。
            release_model_cooldown(
                session, scope=SCOPE_UPSTREAM_MODEL, scope_id=row.id
            )
    _apply_cost_fields(row, payload)
    session.commit()
    availability = evaluate(session)
    upstream_name, vendor_name = _um_names(session, row)
    target_count = int(
        session.scalar(
            select(func.count())
            .select_from(ModelTargetORM)
            .where(ModelTargetORM.upstream_model_id == row.id)
        )
        or 0
    )
    body = _um_body(
        row,
        upstream_name=upstream_name,
        vendor_name=vendor_name,
        target_count=target_count,
        availability=availability,
    )
    body["window_skip"] = window_skip
    return body


@router.delete("/admin/upstream-models/{upstream_model_id}", status_code=204)
def delete_upstream_model(
    upstream_model_id: str,
    session: Session = Depends(session_of),
    principal=Depends(require("upstream_models:write")),
):
    crud.delete_upstream_model(session, upstream_model_id, actor=principal.admin_id)
    session.commit()


# ------------------------------------------------------------------ public models


@router.post("/admin/public-models", status_code=201)
def create_public_model(
    payload: PublicModelCreate,
    session: Session = Depends(session_of),
    principal=Depends(require("public_models:write")),
) -> dict:
    row = crud.create_public_model(
        session,
        name=payload.name,
        note=payload.note,
        routing_mode=payload.routing_mode,
        actor=principal.admin_id,
    )
    if not payload.enabled:
        row.enabled = False
    if payload.targets:
        crud.replace_public_model_targets(
            session,
            row.id,
            [draft.model_dump() for draft in payload.targets],
            actor=principal.admin_id,
        )
    session.commit()
    targets = sorted(
        session.scalars(
            select(ModelTargetORM).where(ModelTargetORM.public_model_id == row.id)
        ).all(),
        key=lambda target: (target.priority, target.id),
    )
    return _pm_body(
        row,
        targets=targets,
        names=_model_names(session),
        availability=evaluate(session),
    )


@router.get("/admin/public-models")
def list_public_models(
    session: Session = Depends(session_of),
    page_size: int = 50,
    offset: int = 0,
    with_targets: bool = True,
    principal=Depends(require("public_models:read")),
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    models = PUBLIC_MODEL_REPO.list_all(session, limit=limit, offset=off)
    names = _model_names(session)
    targets = (
        _targets_by_public(session, [model.id for model in models]) if with_targets else {}
    )
    availability = evaluate(session)
    return [
        _pm_body(
            model,
            targets=targets.get(model.id, []),
            names=names,
            availability=availability,
        )
        for model in models
    ]


@router.patch("/admin/public-models/batch")
def batch_public_models(
    payload: ModelBulk,
    session: Session = Depends(session_of),
    principal=Depends(require("public_models:write")),
) -> dict:
    return _apply_batch(
        session,
        PUBLIC_MODEL_REPO,
        ids=payload.ids,
        action=payload.action,
        cooldown_until_ms=payload.cooldown_until_ms,
        actor=principal.admin_id,
    )


@router.put("/admin/public-models/{public_model_id}/targets")
def replace_public_model_targets(
    public_model_id: str,
    payload: PublicModelTargets,
    session: Session = Depends(session_of),
    principal=Depends(require("model_targets:write")),
) -> list[dict]:
    """Replace all members in one transaction; the renderer's rules are enforced."""
    rows = crud.replace_public_model_targets(
        session,
        public_model_id,
        [draft.model_dump() for draft in payload.targets],
        actor=principal.admin_id,
    )
    session.commit()
    names = _model_names(session)
    return [
        _mt_body(row, names) for row in sorted(rows, key=lambda r: (r.priority, r.id))
    ]


@router.patch("/admin/public-models/{public_model_id}")
def update_public_model(
    public_model_id: str,
    payload: PublicModelPatch,
    session: Session = Depends(session_of),
    principal=Depends(require("public_models:write")),
) -> dict:
    row = PUBLIC_MODEL_REPO.get(session, public_model_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"public model not found: {public_model_id}")
    provided = payload.model_fields_set
    if "name" in provided:
        name = (payload.name or "").strip()
        if not name:
            raise AppError(ErrorCode.VALIDATION_ERROR, "公开模型名称不能为空")
        if name != row.name:
            crud.ensure_unique_name(session, PublicModelORM, name)
            row.name = name
    if "routing_mode" in provided:
        if payload.routing_mode is None:
            raise AppError(ErrorCode.VALIDATION_ERROR, "routing_mode 不能为空")
        crud.set_public_model_routing_mode(session, row, payload.routing_mode)
    if "note" in provided:
        row.note = payload.note or ""
    window_skip = None
    if "enabled" in provided:
        if payload.enabled is None:
            raise AppError(ErrorCode.VALIDATION_ERROR, "enabled 不能为空")
        row.enabled = payload.enabled
        if payload.enabled:  # 启用=解除关闭+托管冷却；周期窗口内仅跳过当前窗口（GLOSSARY §3）
            window_skip = enable_model_availability(
                session, scope=SCOPE_PUBLIC_MODEL, scope_id=row.id
            )
    if "cooldown_until_ms" in provided:
        if payload.cooldown_until_ms:
            set_model_cooldown(
                session,
                scope=SCOPE_PUBLIC_MODEL,
                scope_id=row.id,
                until_ms=payload.cooldown_until_ms,
            )
        else:
            # 解除冷却 (GLOSSARY §3): 托管规则与窗口例外一并清除，周期规则重获效力。
            release_model_cooldown(
                session, scope=SCOPE_PUBLIC_MODEL, scope_id=row.id
            )
    session.commit()
    targets = _targets_by_public(session, [row.id]).get(row.id, [])
    body = _pm_body(
        row,
        targets=targets,
        names=_model_names(session),
        availability=evaluate(session),
    )
    body["window_skip"] = window_skip
    return body


@router.delete("/admin/public-models/{public_model_id}", status_code=204)
def delete_public_model(
    public_model_id: str,
    session: Session = Depends(session_of),
    principal=Depends(require("public_models:write")),
):
    crud.delete_public_model(session, public_model_id, actor=principal.admin_id)
    session.commit()


# ------------------------------------------------------------------ model targets


@router.post("/admin/model-targets", status_code=201)
def create_model_target(
    payload: ModelTargetCreate,
    session: Session = Depends(session_of),
    principal=Depends(require("model_targets:write")),
) -> dict:
    row = crud.create_model_target(
        session,
        public_model_id=payload.public_model_id,
        upstream_model_id=payload.upstream_model_id,
        priority=payload.priority,
        weight=payload.weight,
        when_expr=payload.when,
        actor=principal.admin_id,
    )
    session.commit()
    return _mt_body(row, _model_names(session))


@router.get("/admin/model-targets")
def list_model_targets(
    session: Session = Depends(session_of),
    page_size: int = 50,
    offset: int = 0,
    public_model_id: str | None = None,
    principal=Depends(require("model_targets:read")),
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    query = select(ModelTargetORM)
    if public_model_id:
        query = query.where(ModelTargetORM.public_model_id == public_model_id)
    rows = session.scalars(
        query.order_by(ModelTargetORM.priority, ModelTargetORM.id)
        .limit(limit)
        .offset(off)
    ).all()
    names = _model_names(session)
    return [_mt_body(row, names) for row in rows]


@router.patch("/admin/model-targets/batch")
def batch_model_targets(
    payload: ModelBulk,
    session: Session = Depends(session_of),
    principal=Depends(require("model_targets:write")),
) -> dict:
    return _apply_batch(
        session,
        MODEL_TARGET_REPO,
        ids=payload.ids,
        action=payload.action,
        cooldown_until_ms=payload.cooldown_until_ms,
        actor=principal.admin_id,
        allow_cooldown=False,
    )


@router.patch("/admin/model-targets/{target_id}")
def update_model_target(
    target_id: str,
    payload: ModelTargetUpdate,
    session: Session = Depends(session_of),
    principal=Depends(require("model_targets:write")),
) -> dict:
    row = MODEL_TARGET_REPO.get(session, target_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"model target not found: {target_id}")
    public = session.get(PublicModelORM, row.public_model_id)
    provided = payload.model_fields_set
    priority = payload.priority if payload.priority is not None else row.priority
    weight = payload.weight if payload.weight is not None else row.weight
    when_expr = payload.when if payload.when is not None else row.when_expr
    if public is not None:
        crud.validate_target_shape(
            public.routing_mode, priority=priority, weight=weight, when_expr=when_expr
        )
        if public.routing_mode == "conditional" and not when_expr:
            members = sorted(
                session.scalars(
                    select(ModelTargetORM).where(
                        ModelTargetORM.public_model_id == public.id
                    )
                ).all(),
                key=lambda target: (
                    priority if target.id == row.id else target.priority,
                    target.id,
                ),
            )
            if members and members[-1].id != row.id:
                raise AppError(
                    ErrorCode.VALIDATION_ERROR,
                    "conditional 模式下只有最后一名成员可以留空 when",
                )
    row.priority = priority
    row.weight = weight
    row.when_expr = when_expr
    if "enabled" in provided:
        if payload.enabled is None:
            raise AppError(ErrorCode.VALIDATION_ERROR, "enabled 不能为空")
        row.enabled = payload.enabled
    session.commit()
    return _mt_body(row, _model_names(session))


@router.delete("/admin/model-targets/{target_id}", status_code=204)
def delete_model_target(
    target_id: str,
    session: Session = Depends(session_of),
    principal=Depends(require("model_targets:write")),
):
    row = MODEL_TARGET_REPO.get(session, target_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"model target not found: {target_id}")
    MODEL_TARGET_REPO.delete(session, row)
    session.commit()


def _row_scope(row: UpstreamModelORM | PublicModelORM) -> str:
    if isinstance(row, UpstreamModelORM):
        return SCOPE_UPSTREAM_MODEL
    return SCOPE_PUBLIC_MODEL


def _release_row_cooldown(
    session: Session, row: UpstreamModelORM | PublicModelORM
) -> None:
    release_model_cooldown(session, scope=_row_scope(row), scope_id=row.id)


def _apply_batch(
    session: Session,
    repo,
    *,
    ids: list[str],
    action: str,
    cooldown_until_ms: int | None = None,
    actor: str = "",
    allow_cooldown: bool = True,
) -> dict:
    """Shared availability/delete batch for the three model-family entities.

    Partial success is reported per id (old console behaviour): a referenced
    upstream model cannot be deleted, but the rest of the batch still applies.
    `schedule` is not a batch action (periodic rules live on
    /admin/availability-rules), so it never even reaches this function.
    """
    changed: list[str] = []
    missing: list[str] = []
    failed: list[dict] = []
    # 启用落到周期冷却窗口内时逐行记下跳过的窗口（GLOSSARY §3），随结果带回。
    skipped_windows: list[dict] = []
    if action in {"cooldown", "release"} and not allow_cooldown:
        # Members have no cooldown column: the deadline belongs to the model that
        # owns them, so fail loudly instead of setting an attribute that is not there.
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "成员没有冷却语义；请对上游模型或公开模型设置冷却",
        )
    deadline = 0
    if action == "cooldown":
        deadline = validate_cooldown_until(cooldown_until_ms)
        if not deadline:
            raise AppError(
                ErrorCode.VALIDATION_ERROR, "批量冷却必须提供 cooldown_until_ms"
            )
    for entity_id in ids:
        row = repo.get(session, entity_id)
        if row is None:
            missing.append(entity_id)
            continue
        try:
            if action == "delete":
                if isinstance(row, UpstreamModelORM):
                    crud.delete_upstream_model(session, entity_id, actor=actor)
                elif isinstance(row, PublicModelORM):
                    crud.delete_public_model(session, entity_id, actor=actor)
                else:
                    repo.delete(session, row)
            elif action == "enable":
                row.enabled = True
                if allow_cooldown:
                    window_skip = enable_model_availability(
                        session, scope=_row_scope(row), scope_id=entity_id
                    )
                    if window_skip:
                        skipped_windows.append({"id": entity_id, **window_skip})
            elif action == "disable":
                row.enabled = False
                if allow_cooldown:
                    _release_row_cooldown(session, row)
            elif action == "cooldown":
                set_model_cooldown(
                    session,
                    scope=_row_scope(row),
                    scope_id=entity_id,
                    until_ms=deadline,
                )
            else:  # release
                _release_row_cooldown(session, row)
        except AppError as exc:
            failed.append(
                {"id": entity_id, "code": exc.code.value, "message": exc.message}
            )
            continue
        changed.append(entity_id)
    session.commit()
    result = {"action": action, "changed": changed, "missing": missing, "failed": failed}
    if action == "enable":
        result["window_skipped"] = skipped_windows
    return result
