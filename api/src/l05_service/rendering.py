"""Build the IR from repository state and drive one full configuration rollout.

Single-render source of truth (ADR-002): every rollout renders the complete
desired state from the DB. Upstream keys decrypt from upstreams.api_key_enc into
per-upstream key files; the IR references files, never inline keys. Per-upstream
transforms load from upstreams.transforms_json (task-164). ADR-010 hardening:
active ban/cooldown rules exclude targets at render time (E3: health is AG-
process-local), the IR self-validates before any write (E8: AG accepts
priority=0), and failed rollouts are archived as status="failed" revisions.
"""

from __future__ import annotations

import json
import os
from dataclasses import replace

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.crypto import SecretBox
from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l01_core.timeutil import now_ms
from l02_domain.ir import (
    AccessLogSpec,
    ClientKeySpec,
    GatewayIR,
    PoliciesSpec,
    PublicModelSpec,
    TargetSpec,
    UpstreamModelSpec,
    UpstreamSpec,
    UserBalanceSpec,
    sort_targets,
)
from l02_domain.transforms_codec import transforms_from_json
from l02_domain.validation import validate_gateway_ir
from l03_adapters.spi import DataPlaneAdapter
from l04_repo.orm import (
    ApiKeyORM,
    ConfigRevisionORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
    UpstreamORM,
    UserORM,
)
from l04_repo.repository import get_setting
from l05_service.availability import evaluate
from l05_service.policy_store import stored_policy_blocks

#: ADR-021 app-settings key: metadata | full; anything else means "unset".
ACCESS_LOG_LLM_KEY = "ag_access_log_llm"
ACCESS_LOG_LLM_MODES = ("metadata", "full")


def build_render_plan(
    session: Session, *, revision: str, adapter: DataPlaneAdapter | None = None
) -> tuple[GatewayIR, dict[str, str]]:
    """Compose the full IR plus plaintext key files; raises when nothing is renderable.

    The driver is injected (S2: l05 never imports a concrete adapter); when given,
    its capability declaration fills the IR guardrails block.
    """
    settings = get_settings()
    secret_box = SecretBox(settings.secret_key)
    stamp = now_ms()
    # One evaluator owns ban/cooldown truth (rule table + its legacy column
    # projection); rendering never interprets cooldown_until_ms itself.
    availability = evaluate(session, stamp)
    upstreams = list(session.scalars(select(UpstreamORM).where(UpstreamORM.enabled)))
    # A model in cooldown stays visible in the console but must not route (old
    # system: still listed by /v1/models, skipped by the router).
    models = [
        row
        for row in session.scalars(select(UpstreamModelORM).where(UpstreamModelORM.enabled))
        if row.id not in availability.excluded_upstream_model_ids
    ]
    public_models = [
        row
        for row in session.scalars(select(PublicModelORM).where(PublicModelORM.enabled))
        if row.id not in availability.excluded_public_model_ids
    ]
    targets = [
        target
        for target in session.scalars(select(ModelTargetORM).where(ModelTargetORM.enabled))
        if target.id not in availability.blocked_target_ids
    ]

    targets_by_public: dict[str, list[ModelTargetORM]] = {}
    for target in targets:
        targets_by_public.setdefault(target.public_model_id, []).append(target)

    upstream_specs: list[UpstreamSpec] = []
    key_files: dict[str, str] = {}
    for upstream in upstreams:
        key_file = _key_file_name(settings.ag_config_dir, upstream.id)
        key_files[key_file] = secret_box.decrypt(upstream.api_key_enc)
        upstream_specs.append(
            UpstreamSpec(
                id=upstream.id,
                base_url=upstream.base_url,
                api_style=upstream.api_style,
                key_file=key_file,
                transforms=transforms_from_json(upstream.transforms_json),
                max_buffer_bytes=upstream.max_buffer_bytes,
            )
        )

    upstream_ids = {u.id for u in upstream_specs}
    model_specs = [
        UpstreamModelSpec(
            id=model.id,
            upstream_id=model.upstream_id,
            upstream_model_name=model.name,
            model_type=model.model_type,
        )
        for model in models
        if model.upstream_id in upstream_ids
    ]
    model_ids = {m.id for m in model_specs}

    public_specs: list[PublicModelSpec] = []
    for public in public_models:
        rows = targets_by_public.get(public.id, [])
        # W4: weighted targets keep builder order (weight is a relative ratio,
        # not a sort key); failover/conditional keep priority order.
        if public.routing_mode != "weighted":
            rows = sorted(rows, key=lambda t: t.priority)
        spec_targets = tuple(
            TargetSpec(
                id=t.id,
                upstream_model_id=t.upstream_model_id,
                priority=t.priority,
                weight=t.weight,
                when=t.when_expr,
            )
            for t in rows
            if t.upstream_model_id in model_ids
        )
        if not spec_targets:
            continue  # no-target public models never render (contract invariant 1)
        ordered = sort_targets(spec_targets) if public.routing_mode == "failover" else spec_targets
        public_specs.append(
            PublicModelSpec(
                name=public.name, targets=ordered, routing_mode=public.routing_mode
            )
        )

    key_specs = tuple(
        ClientKeySpec(
            id=row.id,
            key_hash=row.key_hash,
            user_id=row.user_id,
            enabled=row.status == "active",
            key_suffix=row.key_suffix,
        )
        for row in session.scalars(select(ApiKeyORM)).all()
        if row.status == "active"
    )
    user_specs = tuple(
        UserBalanceSpec(
            id=user.id,
            balance_tokens=max(
                0, user.balance_micro // max(1, settings.bucket_micro_per_token)
            ),
        )
        for user in session.scalars(select(UserORM)).all()
    )

    policies_block, guardrails_block, mcp_block, limits_block = stored_policy_blocks(
        session, adapter
    )
    access_log = _access_log_spec(session, settings)
    if access_log is not None:
        policies_block = replace(policies_block, access_log=access_log)
    ir = GatewayIR(
        revision=revision,
        upstreams=tuple(upstream_specs),
        models=tuple(model_specs),
        public_models=tuple(public_specs),
        api_keys=key_specs,
        users=user_specs,
        limits=limits_block,
        policies=policies_block,
        guardrails=guardrails_block,
        mcp=mcp_block,
    )
    # E8: --validate-only misses business invariants (accepts priority=0), so the
    # control plane re-checks every IR invariant before any file is touched.
    result = validate_gateway_ir(ir)
    if not result.ok:
        raise AppError(
            ErrorCode.APPLY_FAILED,
            "IR 自校验失败，拒绝下发",
            details={"errors": list(result.errors)},
        )
    if not public_specs:
        raise AppError(ErrorCode.APPLY_FAILED, "nothing to render: no public models")
    return ir, key_files


def _key_file_name(config_dir: str, upstream_id: str) -> str:
    return os.path.join(config_dir, "keys", f"{upstream_id}.key")


def _access_log_spec(session: Session, settings) -> AccessLogSpec | None:
    """ADR-021: resolve the payload-logging switch; None renders no logging block.

    The database URL is the same ag_db_path source usage ingestion reads; with
    no path configured there is nowhere to log, so the block stays absent.
    """
    raw = get_setting(session, ACCESS_LOG_LLM_KEY)
    mode = ""
    if raw is not None:
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            value = raw
        if isinstance(value, str):
            mode = value.strip()
    if mode not in ACCESS_LOG_LLM_MODES or not settings.ag_db_path:
        return None
    return AccessLogSpec(database_url=settings.ag_db_path, llm=mode)


def write_key_files(key_files: dict[str, str]) -> list[str]:
    """Atomically write each key file (temp + replace); returns the written paths."""
    written: list[str] = []
    for path, plaintext in key_files.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp_path = path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(plaintext)
        os.replace(tmp_path, path)
        written.append(path)
    return written


def apply_configuration(
    session: Session, *, adapter: DataPlaneAdapter, operator: str = "", reason: str = ""
) -> ConfigRevisionORM:
    """Deprecated entry point; new code uses Rollout.apply directly."""
    from l05_service.rollout import Rollout

    row = Rollout(session, adapter).apply(operator, reason=reason)
    if row is None:  # pragma: no cover - the default "raise" policy never returns None
        raise AppError(ErrorCode.APPLY_FAILED, "配置下发失败")
    return row


def rollback_to_revision(
    session: Session, *, adapter: DataPlaneAdapter, revision_id: str, operator: str = ""
) -> ConfigRevisionORM:
    """Deprecated entry point; new code uses Rollout.rollback directly."""
    from l05_service.rollout import Rollout

    return Rollout(session, adapter).rollback(revision_id, operator)
