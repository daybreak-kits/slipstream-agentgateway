"""Build the IR from repository state and drive one full configuration rollout.

Single-render source of truth (ADR-002): every rollout renders the complete
desired state from the DB. ADR-026 多密钥平权: every ``upstream_keys`` row of an
upstream expands into its own IR upstream (provider id ``{upstream_id}#{seq}``,
credential ref ``{upstream_id}#{seq}``) and its own copy of every upstream
model (``{model_id}#k{seq}``); public-model targets expand the same way, so one
logical target becomes one same-priority routing layer entry per key (E18:
P2C 下的平权分流). E20 修正：该展开只对 failover/weighted 成立——AG 对
conditional targets 按 first-match 求值（首条独占、无请求内切换），同 when 多条
``#kN`` 只会让 N-1 把密钥静默 0 流量，故 conditional 模式每个 target 只渲染
第一把密钥的一条（并打 warning）；无 when 兜底也随之只渲染单条，与 AG
硬校验「至多 1 条无 when 且必须末条」对齐。The IR references credential refs,
never inline keys; where those files live on disk and how they are written is
adapter-owned (the rollout hands the plaintext over only at the
``materialize_credentials`` boundary, W6 ticket 03).
Per-upstream transforms load from upstreams.transforms_json (task-164). ADR-010
hardening: active ban/cooldown rules exclude targets at render time (E3: health
is AG-process-local), the IR self-validates before any write (E8: AG accepts
priority=0), and failed rollouts are archived as status="failed" revisions.
"""

from __future__ import annotations

import json
import logging
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
    PublicModelSpec,
    TargetSpec,
    UpstreamModelSpec,
    UpstreamSpec,
    UserBalanceSpec,
    sort_targets,
)
from l02_domain.transforms_codec import transforms_from_json
from l02_domain.validation import validate_gateway_ir
from l03_adapters.spi import CredentialFile, DataPlaneAdapter
from l04_repo.orm import (
    ApiKeyORM,
    ConfigRevisionORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamKeyORM,
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

logger = logging.getLogger(__name__)


def build_render_plan(
    session: Session, *, revision: str, adapter: DataPlaneAdapter | None = None
) -> tuple[GatewayIR, tuple[CredentialFile, ...]]:
    """Compose the full IR plus the adapter-bound credential intents.

    The driver is injected (S2: l05 never imports a concrete adapter); when given,
    its capability declaration fills the IR guardrails block. The credentials are
    neutral ``CredentialFile`` intents (ref + plaintext, no destination): the
    adapter chooses where its key files live and writes them through its own
    ``materialize_credentials`` port.
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

    # ADR-026 密钥展开: one provider per key row. The seq is the 1-based ordinal
    # in (created_at_ms, id) order - the same stable order the console lists.
    upstream_specs: list[UpstreamSpec] = []
    credentials: list[CredentialFile] = []
    key_seqs_by_upstream: dict[str, list[int]] = {}
    for upstream in upstreams:
        key_rows = _upstream_key_rows(session, upstream.id)
        if not key_rows:
            raise AppError(
                ErrorCode.APPLY_FAILED,
                f"上游 {upstream.name}（{upstream.id}）没有可用密钥行，拒绝下发："
                "每把密钥展开为独立 provider，必须携带自己的密钥文件（E17 安全红线）；"
                "旧库请先运行 scripts/migrate_multikey_v2.py",
            )
        seqs: list[int] = []
        for seq, row in enumerate(key_rows, start=1):
            ref = provider_id(upstream.id, seq)
            credentials.append(
                CredentialFile(ref=ref, plaintext=secret_box.decrypt(row.key_enc))
            )
            seqs.append(seq)
            upstream_specs.append(
                UpstreamSpec(
                    id=ref,
                    base_url=upstream.base_url,
                    api_style=upstream.api_style,
                    key_file=ref,
                    transforms=transforms_from_json(upstream.transforms_json),
                    max_buffer_bytes=upstream.max_buffer_bytes,
                )
            )
        key_seqs_by_upstream[upstream.id] = seqs

    upstream_ids = {u.id for u in upstreams}
    routable_models = [m for m in models if m.upstream_id in upstream_ids]
    model_db_ids = {m.id for m in routable_models}
    upstream_id_by_model = {m.id: m.upstream_id for m in routable_models}
    model_specs = [
        UpstreamModelSpec(
            id=model_alias(model.id, seq),
            upstream_id=provider_id(model.upstream_id, seq),
            upstream_model_name=model.name,
            model_type=model.model_type,
        )
        for model in routable_models
        for seq in key_seqs_by_upstream[model.upstream_id]
    ]

    public_specs: list[PublicModelSpec] = []
    for public in public_models:
        rows = targets_by_public.get(public.id, [])
        # W4: weighted targets keep builder order (weight is a relative ratio,
        # not a sort key); failover/conditional keep priority order.
        if public.routing_mode != "weighted":
            rows = sorted(rows, key=lambda t: t.priority)
        spec_targets: list[TargetSpec] = []
        for t in rows:
            if t.upstream_model_id not in model_db_ids:
                continue
            seqs = key_seqs_by_upstream[upstream_id_by_model[t.upstream_model_id]]
            # E20（P0-RESULTS §E20）：AG 对 conditional targets 按 first-match
            # 求值——同 when 的多条 #kN 条目 validate 合法但运行时首条独占
            # （40:0，无告警），N-1 把密钥静默 0 流量，且 when 条目间无请求内
            # 切换。密钥维度的展开只在 failover/weighted 成立（E18 P2C 平权），
            # conditional 每个 target 只渲染第一把密钥的一条；无 when 兜底也
            # 因此天然单条，满足 AG 硬校验「至多 1 条无 when 且必须末条」。
            if public.routing_mode == "conditional":
                key_count = len(seqs)
                seqs = seqs[:1]
                if key_count > 1:
                    logger.warning(
                        "对外模型 %s: conditional 模式密钥平权不生效（E20）：上游 %s 配了"
                        "%d 把密钥，AG conditional targets 按 first-match 首条独占"
                        "（同谓词其余密钥 0 流量、无请求内切换），每目标仅使用第一把密钥；"
                        "密钥级平权/容错只有 failover/weighted 模式支持",
                        public.name,
                        upstream_id_by_model[t.upstream_model_id],
                        key_count,
                    )
            spec_targets.extend(
                TargetSpec(
                    id=f"{t.id}#k{seq}",
                    upstream_model_id=model_alias(t.upstream_model_id, seq),
                    priority=t.priority,
                    weight=t.weight,
                    when=t.when_expr,
                )
                for seq in seqs
            )
        targets_tuple = tuple(spec_targets)
        if not targets_tuple:
            continue  # no-target public models never render (contract invariant 1)
        ordered = (
            sort_targets(targets_tuple) if public.routing_mode == "failover" else targets_tuple
        )
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
    access_log = _access_log_spec(session)
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
    return ir, tuple(credentials)


def _upstream_key_rows(session: Session, upstream_id: str) -> list[UpstreamKeyORM]:
    """The upstream's credential rows in the console's stable listing order."""
    stmt = (
        select(UpstreamKeyORM)
        .where(UpstreamKeyORM.upstream_id == upstream_id)
        .order_by(UpstreamKeyORM.created_at_ms, UpstreamKeyORM.id)
    )
    return list(session.scalars(stmt).all())


def provider_id(upstream_id: str, seq: int) -> str:
    """ADR-026/E18 provider name: one independent AG upstream per key."""
    return f"{upstream_id}#{seq}"


def model_alias(model_id: str, seq: int) -> str:
    """E18 裁决的唯一别名形态 ``{model}#k{seq}``，禁用同名多条（validate 抓不住，
    首条独占其余静默丢弃）。"""
    return f"{model_id}#k{seq}"


def _access_log_spec(session: Session) -> AccessLogSpec:
    """ADR-021: resolve the payload-logging switch; always render a log DB source.

    The data-plane log DB is a bootstrap dependency: usage ingestion, the
    request-log pages and retention all read it, so an unset switch must not
    leave a fresh install without a data source. The switch is a neutral system
    fact (metadata = no bodies, full = bodies stored); WHERE the log DB lives
    is adapter-owned (ADR-029 ticket 04), so database_url stays empty and the
    adapter renders its own deployment default.
    """
    raw = get_setting(session, ACCESS_LOG_LLM_KEY)
    mode = "metadata"
    if raw is not None:
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            value = raw
        if isinstance(value, str) and value.strip() in ACCESS_LOG_LLM_MODES:
            mode = value.strip()
    return AccessLogSpec(database_url="", llm=mode)


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
