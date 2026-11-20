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

import json

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l03_adapters.spi import DataPlaneAdapter
from l04_repo.orm import (
    AuditLogORM,
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
from l05_service import crud, models_dev, pricing, rbac
from l05_service.availability import (
    PUBLIC_MODEL_COOLDOWN_MESSAGE,
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
from l05_service.rollout import apply_rollout
from l06_api.deps import get_adapter, page_params, require, session_of
from l06_api.schemas import (
    AdoptModelsDevBatchResult,
    AdoptModelsDevResult,
    ModelBulk,
    ModelsDevSnapshotStatus,
    ModelTargetCreate,
    ModelTargetUpdate,
    PublicModelCreate,
    PublicModelPatch,
    UpstreamModelCreate,
    UpstreamModelPatch,
)

router = APIRouter(tags=["models"])


def _audit_adopt(session: Session, *, actor: str, entity_id: str, detail: str) -> None:
    session.add(
        AuditLogORM(
            id=new_id("aud"),
            actor=actor,
            action="adopt_modelsdev",
            entity_type="upstream_model",
            entity_id=entity_id,
            detail_json=detail,
            created_at_ms=now_ms(),
        )
    )


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
        # W4-H: where the parameter block last came from ("manual" / "models.dev").
        "params_source": row.params_source or "manual",
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


@router.get(
    "/admin/upstream-models/modelsdev-status",
    response_model=ModelsDevSnapshotStatus,
)
def modelsdev_status(
    session: Session = Depends(session_of),
    _principal=Depends(require("upstream_models:read")),
) -> dict:
    """Stored models.dev snapshot summary for the console toolbar.

    Returns counts + the newest fetched_at_ms (0 = 从未同步); no network call.
    """
    return models_dev.snapshot_status(session)


@router.patch("/admin/upstream-models/batch")
def batch_upstream_models(
    payload: ModelBulk,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal=Depends(require("upstream_models:write")),
) -> dict:
    result = _apply_batch(
        session,
        UPSTREAM_MODEL_REPO,
        ids=payload.ids,
        action=payload.action,
        cooldown_until_ms=payload.cooldown_until_ms,
        actor=principal.admin_id,
    )
    if result["changed"] and payload.action in {"enable", "disable", "cooldown", "release"}:
        # 可用性批量写后立即下发（ticket 02）。
        apply_rollout(
            session,
            adapter,
            principal.username,
            reason=f"models-batch-{payload.action}",
            on_failure="keep-booked",
        )
    return result


@router.patch(
    "/admin/upstream-models/{upstream_model_id}",
    dependencies=[Depends(require("billing:cost"))],
)
def update_upstream_model(
    upstream_model_id: str,
    payload: UpstreamModelPatch,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
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
        canonical = canonical_parameters(payload.parameters)
        if canonical != row.parameters_json:
            # W4-H: a manual edit that actually changes the block reclaims the
            # source badge; a no-op save keeps it.
            row.parameters_json = canonical
            row.params_source = "manual"
    window_skip = None
    apply_reason = ""
    if "enabled" in provided:
        if payload.enabled is None:
            raise AppError(ErrorCode.VALIDATION_ERROR, "enabled 不能为空")
        row.enabled = payload.enabled
        if payload.enabled:  # 启用=解除关闭+托管冷却；周期窗口内仅跳过当前窗口（GLOSSARY §3）
            window_skip = enable_model_availability(
                session, scope=SCOPE_UPSTREAM_MODEL, scope_id=row.id
            )
        apply_reason = "model-enable" if payload.enabled else "model-disable"
    if "cooldown_until_ms" in provided:
        if payload.cooldown_until_ms:
            set_model_cooldown(
                session,
                scope=SCOPE_UPSTREAM_MODEL,
                scope_id=row.id,
                until_ms=payload.cooldown_until_ms,
            )
            apply_reason = "model-cooldown"
        else:
            # 解除 (ticket 02): 删单次托管规则；命中周期窗口只跳过本窗口并保留规则。
            window_skip = release_model_cooldown(
                session, scope=SCOPE_UPSTREAM_MODEL, scope_id=row.id
            )
            apply_reason = "model-release"
    _apply_cost_fields(row, payload)
    session.commit()
    if apply_reason:
        # 写后立即下发（ticket 02），不等 job/人工 apply。
        apply_rollout(
            session, adapter, principal.username, reason=apply_reason, on_failure="keep-booked"
        )
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
) -> None:
    crud.delete_upstream_model(session, upstream_model_id, actor=principal.admin_id)
    session.commit()


# ----------------------------------------------------- W4-H models.dev adoption


@router.post(
    "/admin/upstream-models/adopt-modelsdev",
    response_model=AdoptModelsDevBatchResult,
)
def adopt_modelsdev_batch(
    session: Session = Depends(session_of),
    principal=Depends(require("upstream_models:write")),
) -> dict:
    """Sync models.dev for EVERY upstream model: refresh the snapshot (best
    effort), then fill blank parameter/cost keys row by row (只填空，手改不覆盖).

    Declared before the parametrized routes so "adopt-modelsdev" is never
    captured as an id.
    """
    result = models_dev.adopt_all(session, actor=principal.admin_id)
    _audit_adopt(
        session,
        actor=principal.username or principal.admin_id,
        entity_id="batch",
        detail=json.dumps(
            {
                "refreshed": result["refreshed"],
                "filled_models": result["filled_models"],
                "filled_keys": result["filled_keys"],
                "no_match": result["no_match"],
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
    )
    session.commit()
    return result


@router.post(
    "/admin/upstream-models/{upstream_model_id}/adopt-modelsdev",
    response_model=AdoptModelsDevResult,
)
def adopt_modelsdev_one(
    upstream_model_id: str,
    session: Session = Depends(session_of),
    principal=Depends(require("upstream_models:write")),
) -> dict:
    """Fill ONE upstream model's blank keys from models.dev (编辑弹窗按钮)."""
    row = UPSTREAM_MODEL_REPO.get(session, upstream_model_id)
    if row is None:
        raise AppError(
            ErrorCode.NOT_FOUND, f"upstream model not found: {upstream_model_id}"
        )
    result = models_dev.adopt_model(session, row)
    _audit_adopt(
        session,
        actor=principal.username or principal.admin_id,
        entity_id=row.id,
        detail=json.dumps(
            {"matched": result["matched"], "filled": result["filled"]},
            ensure_ascii=False,
            sort_keys=True,
        ),
    )
    session.commit()
    return result


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
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal=Depends(require("public_models:write")),
) -> dict:
    result = _apply_batch(
        session,
        PUBLIC_MODEL_REPO,
        ids=payload.ids,
        action=payload.action,
        cooldown_until_ms=payload.cooldown_until_ms,
        actor=principal.admin_id,
        allow_cooldown=False,
        cooldown_error=PUBLIC_MODEL_COOLDOWN_MESSAGE,
    )
    if result["changed"] and payload.action in {"enable", "disable"}:
        apply_rollout(
            session,
            adapter,
            principal.username,
            reason=f"models-batch-{payload.action}",
            on_failure="keep-booked",
        )
    return result


@router.patch("/admin/public-models/{public_model_id}")
def update_public_model(
    public_model_id: str,
    payload: PublicModelPatch,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal=Depends(require("public_models:write")),
) -> dict:
    """One atomic save: basic fields, routing_mode, enabled and (optional) members.

    Ticket 12: targets rides this PATCH, so the console can never half-save (basic
    fields landed, members did not). The member-write grant is required only when
    targets is part of the request; the final member state is validated and the
    whole save is committed once, so a rejected request rolls everything back. The
    old PUT .../targets endpoint is gone with no alias.
    """
    row = PUBLIC_MODEL_REPO.get(session, public_model_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"public model not found: {public_model_id}")
    provided = payload.model_fields_set
    if "targets" in provided:
        # Replacing the routing plan needs its own grant, independent of the
        # alias-edit public_models:write gate above (spec §5).
        rbac.require_permission(principal.permissions, "model_targets:write")
    if "cooldown_until_ms" in provided:
        # 冷却只属于上游模型（ADR-025 / ticket 02）：明确拒绝而不是静默忽略。
        raise AppError(ErrorCode.VALIDATION_ERROR, PUBLIC_MODEL_COOLDOWN_MESSAGE)
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
        # With members in the same save the incoming list is the final state to
        # validate; without it the existing rows must still fit the new mode.
        crud.set_public_model_routing_mode(
            session,
            row,
            payload.routing_mode,
            validate_members="targets" not in provided,
        )
    if "note" in provided:
        row.note = payload.note or ""
    window_skip = None
    apply_reason = ""
    if "enabled" in provided:
        if payload.enabled is None:
            raise AppError(ErrorCode.VALIDATION_ERROR, "enabled 不能为空")
        row.enabled = payload.enabled
        if payload.enabled:  # 启用=解除关闭，遗留窗口只跳过当前窗口（GLOSSARY §3）
            window_skip = enable_model_availability(
                session, scope=SCOPE_PUBLIC_MODEL, scope_id=row.id
            )
        apply_reason = "model-enable" if payload.enabled else "model-disable"
    if "targets" in provided:
        drafts = (
            []
            if payload.targets is None
            else [draft.model_dump() for draft in payload.targets]
        )
        # require_members: the final state must keep at least one member.
        crud.replace_public_model_targets(
            session,
            row.id,
            drafts,
            actor=principal.admin_id,
            require_members=True,
        )
    session.commit()
    if apply_reason:
        # 写后立即下发（ticket 02）。
        apply_rollout(
            session, adapter, principal.username, reason=apply_reason, on_failure="keep-booked"
        )
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
) -> None:
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
    )  # model targets have no availability write; no rollout to trigger


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
) -> None:
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
    cooldown_error: str = "成员没有冷却语义；请对上游模型设置冷却",
) -> dict:
    """Shared availability/delete batch for the three model-family entities.

    Partial success is reported per id (old console behaviour): a referenced
    upstream model cannot be deleted, but the rest of the batch still applies.
    A mutual-exclusion conflict (ticket 02) is also a per-id failure, never an
    overall failure. `schedule` is not a batch action (periodic rules live on
    /admin/availability-rules), so it never even reaches this function.
    """
    changed: list[str] = []
    missing: list[str] = []
    failed: list[dict] = []
    # 启用落到周期冷却窗口内时逐行记下跳过的窗口（GLOSSARY §3），随结果带回。
    skipped_windows: list[dict] = []
    if action in {"cooldown", "release"} and not allow_cooldown:
        # The entity family has no cooldown semantics: fail loudly with the
        # family-specific explanation instead of writing nothing.
        raise AppError(ErrorCode.VALIDATION_ERROR, cooldown_error)
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
            # 409 conflict details ride along so the console can name the blocker.
            failed.append(
                {
                    "id": entity_id,
                    "code": exc.code.value,
                    "message": exc.message,
                    "details": exc.details,
                }
            )
            continue
        changed.append(entity_id)
    session.commit()
    result = {"action": action, "changed": changed, "missing": missing, "failed": failed}
    if action == "enable":
        result["window_skipped"] = skipped_windows
    return result
