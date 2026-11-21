"""CRUD use-cases: the only place that assigns ids, enforces uniqueness and names.

ADR-026 多密钥平权: a credential's only home is its `upstream_keys` row - each
row is expanded by the renderer into its own AG provider, so there is no primary
key and no mirror into `upstreams.api_key_enc` (see l05_service/upstream_ops.py).
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.crypto import SecretBox
from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l02_domain.models import ApiStyle, ModelType
from l02_domain.transforms_codec import parse_transforms, transforms_to_json
from l04_repo.orm import (
    AuditLogORM,
    AvailabilityRuleORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
    UpstreamORM,
    UserORM,
)
from l04_repo.repository import (
    AUDIT_REPO,
    MODEL_TARGET_REPO,
    PUBLIC_MODEL_REPO,
    UPSTREAM_MODEL_REPO,
    UPSTREAM_REPO,
    USER_REPO,
)
from l05_service import availability
from l05_service.model_params import canonical_parameters, validate_type_source
from l05_service.upstream_ops import (
    create_initial_key,
    probe_key_plaintext,
    resolve_auto_style,
)


def ensure_unique_name(session: Session, orm_class: type, name: str) -> None:
    """Reject duplicate names early with a domain-level validation error."""
    row = session.scalars(select(orm_class).where(orm_class.name == name)).first()
    if row is not None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, f"name already exists: {name}", details={"name": name}
        )


#: Kept for existing internal call sites.
_ensure_unique_name = ensure_unique_name


def _audit(
    session: Session,
    *,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str,
    detail_json: str = "{}",
) -> None:
    AUDIT_REPO.add(
        session,
        AuditLogORM(
            id=new_id("aud"),
            actor=actor,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail_json=detail_json,
            created_at_ms=now_ms(),
        ),
    )


def _name_from_base_url(base_url: str) -> str:
    """ADR-023 #6: derive the default upstream name from the connection address.

    `www.abc.com:8080` -> `www-abc-com-8080`; the default port of a scheme
    (http 80 / https 443) is dropped, and any character outside [a-z0-9]
    collapses to `-` (trimmed at both ends). Falls back to a neutral stem when
    the URL carries nothing usable.
    """
    candidate = base_url.strip()
    if "://" not in candidate:
        candidate = "http://" + candidate
    parsed = urlparse(candidate)
    try:
        port = parsed.port
    except ValueError:
        port = None
    label = parsed.hostname or ""
    if port is not None and port != {"http": 80, "https": 443}.get(parsed.scheme):
        label = f"{label}:{port}"
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    return slug or "upstream"


def _generate_upstream_name(session: Session, base_url: str) -> str:
    """host:port stem, deduplicated with a -2 / -3 numeric suffix."""
    stem = _name_from_base_url(base_url)
    candidate = stem
    suffix = 2
    while session.scalars(
        select(UpstreamORM).where(UpstreamORM.name == candidate)
    ).first() is not None:
        candidate = f"{stem}-{suffix}"
        suffix += 1
    return candidate


def create_upstream(
    session: Session,
    *,
    base_url: str,
    api_style: str,
    api_key: str,
    secret_box: SecretBox,
    name: str | None = None,
    alias: str = "",
    transforms: dict | None = None,
    max_buffer_bytes: int = 2097152,
    actor: str = "",
) -> UpstreamORM:
    """Create an upstream with its single key encrypted inline.

    Naming (ADR-023 #6 + ADR-030): an explicitly requested name wins
    (duplicates are a 422 like every other entity); without one, the name
    derives from the connection address (`www-abc-com-8080`, deduplicated with
    -2/-3). alias is a display-only name that never routes or reaches the data
    plane.
    transforms (optional) is the structured rewrite-rule payload; it validates
    here (protected headers, fallback-last) and stores as canonical JSON.
    """
    try:
        ApiStyle(api_style)
    except ValueError:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, f"unknown api_style: {api_style}"
        ) from None
    upstream_id = new_id("ups")
    if api_style == ApiStyle.AUTO:
        # ADR-023 #6: "auto" is input-only - probe now, store the concrete style,
        # or fail 422 with one failure line per protocol.
        api_style = resolve_auto_style(
            session, upstream_id=upstream_id, base_url=base_url, api_key=api_key
        )
    transforms_json = transforms_to_json(parse_transforms(transforms)) if transforms else ""
    if name:
        name = name.strip()
        ensure_unique_name(session, UpstreamORM, name)
    else:
        name = _generate_upstream_name(session, base_url)
    upstream = UpstreamORM(
        id=upstream_id,
        name=name,
        alias=alias.strip(),
        base_url=base_url,
        api_style=api_style,
        # ADR-026: no inline credential anymore - the key row created below is
        # the single source the renderer expands into per-key providers.
        api_key_enc="",
        transforms_json=transforms_json,
        max_buffer_bytes=max_buffer_bytes,
        created_at_ms=now_ms(),
    )
    UPSTREAM_REPO.add(session, upstream)
    create_initial_key(session, upstream, api_key=api_key, secret_box=secret_box)
    _audit(session, actor=actor, action="create", entity_type="upstream", entity_id=upstream.id)
    return upstream


def update_upstream(
    session: Session,
    upstream_id: str,
    *,
    fields: dict,
    secret_box: SecretBox,
    actor: str = "",
) -> UpstreamORM:
    """Patch base_url/api_style/enabled/transforms/max_buffer_bytes with validation.

    api_style="auto" (ADR-023 #6) never lands in the database: it probes with the
    primary key against the possibly-updated base_url and stores the concrete
    style, or fails 422 with one failure line per protocol.
    """
    upstream = session.get(UpstreamORM, upstream_id)
    if upstream is None:
        raise AppError(ErrorCode.NOT_FOUND, f"upstream not found: {upstream_id}")
    if "transforms" in fields:
        payload = fields.pop("transforms")
        upstream.transforms_json = (
            transforms_to_json(parse_transforms(payload)) if payload else ""
        )
    if "api_style" in fields:
        try:
            ApiStyle(fields["api_style"])
        except ValueError:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"unknown api_style: {fields['api_style']}",
            ) from None
    if fields.get("api_style") == ApiStyle.AUTO:
        api_key = probe_key_plaintext(session, upstream, secret_box=secret_box)
        fields["api_style"] = resolve_auto_style(
            session,
            upstream_id=upstream.id,
            base_url=fields.get("base_url") or upstream.base_url,
            api_key=api_key,
        )
    for key, value in fields.items():
        setattr(upstream, key, value)
    session.flush()
    _audit(session, actor=actor, action="update", entity_type="upstream", entity_id=upstream.id)
    return upstream


def set_upstream_transforms(
    session: Session, upstream_id: str, *, transforms: dict | None, actor: str = ""
) -> str:
    """Store (or clear) the structured rewrite rules; returns the canonical JSON."""
    upstream = session.get(UpstreamORM, upstream_id)
    if upstream is None:
        raise AppError(ErrorCode.NOT_FOUND, f"upstream not found: {upstream_id}")
    canonical = transforms_to_json(parse_transforms(transforms)) if transforms else ""
    upstream.transforms_json = canonical
    session.flush()
    _audit(
        session,
        actor=actor,
        action="set_transforms",
        entity_type="upstream",
        entity_id=upstream.id,
    )
    return canonical


def validate_model_type(model_type: str) -> str:
    """One place that knows the seven old-console model types."""
    try:
        ModelType(model_type)
    except ValueError:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, f"unknown model_type: {model_type}"
        ) from None
    return model_type


def create_upstream_model(
    session: Session,
    *,
    upstream_id: str,
    name: str,
    model_type: str,
    model_type_source: str = "default",
    parameters: dict | None = None,
    enabled: bool = True,
    actor: str = "",
) -> UpstreamModelORM:
    """Model-level price book (ticket 05) + old-console metadata (ticket 10).

    parameters is the capability block the old channel-model editor declared; it
    stays control-plane metadata because the AG IR has no per-model params slot.
    """
    if session.get(UpstreamORM, upstream_id) is None:
        raise AppError(ErrorCode.NOT_FOUND, f"upstream not found: {upstream_id}")
    model = UpstreamModelORM(
        id=new_id("umdl"),
        upstream_id=upstream_id,
        name=name,
        model_type=validate_model_type(model_type),
        model_type_source=validate_type_source(model_type_source),
        parameters_json=canonical_parameters(parameters),
        enabled=enabled,
        created_at_ms=now_ms(),
    )
    UPSTREAM_MODEL_REPO.add(session, model)
    _audit(session, actor=actor, action="create", entity_type="upstream_model", entity_id=model.id)
    return model


def create_public_model(
    session: Session,
    *,
    name: str,
    note: str = "",
    routing_mode: str = "failover",
    actor: str = "",
) -> PublicModelORM:
    """Alias-layer entry; routing_mode selects failover/weighted/conditional (ADR-014)."""
    from l02_domain.ir import ROUTING_MODES

    _ensure_unique_name(session, PublicModelORM, name)
    if routing_mode not in ROUTING_MODES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown routing_mode: {routing_mode}",
            details={"routing_mode": routing_mode, "known": list(ROUTING_MODES)},
        )
    model = PublicModelORM(
        id=new_id("pmdl"),
        name=name,
        note=note,
        routing_mode=routing_mode,
        created_at_ms=now_ms(),
    )
    PUBLIC_MODEL_REPO.add(session, model)
    _audit(session, actor=actor, action="create", entity_type="public_model", entity_id=model.id)
    return model


def validate_target_shape(
    routing_mode: str, *, priority: int, weight: int, when_expr: str
) -> None:
    """Mirror the renderer's rules (l02_domain/ir.py) at the API boundary.

    failover: priority >= 0, numeric SMALL first (AG 1.7 semantics); weighted:
    weight >= 1; conditional: the caller checks `when`, because only the last
    member of a conditional chain may leave it empty.
    """
    if routing_mode == "failover":
        if priority < 0:
            raise AppError(
                ErrorCode.VALIDATION_ERROR, "priority 必须 >= 0（failover 数值小优先）"
            )
    elif routing_mode == "weighted":
        if weight <= 0:
            raise AppError(
                ErrorCode.VALIDATION_ERROR, "weighted 模式的成员 weight 必须 >= 1"
            )
    elif routing_mode != "conditional":
        raise AppError(
            ErrorCode.VALIDATION_ERROR, f"unknown routing_mode: {routing_mode}"
        )


def create_model_target(
    session: Session,
    *,
    public_model_id: str,
    upstream_model_id: str,
    priority: int,
    weight: int = 0,
    when_expr: str = "",
    actor: str = "",
) -> ModelTargetORM:
    """One binding row; semantics depend on the public model's routing_mode (ADR-014)."""
    public = session.get(PublicModelORM, public_model_id)
    if public is None:
        raise AppError(ErrorCode.NOT_FOUND, f"public model not found: {public_model_id}")
    if session.get(UpstreamModelORM, upstream_model_id) is None:
        raise AppError(ErrorCode.NOT_FOUND, f"upstream model not found: {upstream_model_id}")
    validate_target_shape(
        public.routing_mode, priority=priority, weight=weight, when_expr=when_expr
    )
    if public.routing_mode == "conditional" and not when_expr:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "conditional targets need a 'when' CEL predicate "
            "(the last target may be added empty later)",
        )
    target = ModelTargetORM(
        id=new_id("mtgt"),
        public_model_id=public_model_id,
        upstream_model_id=upstream_model_id,
        priority=priority,
        weight=weight,
        when_expr=when_expr,
        created_at_ms=now_ms(),
    )
    MODEL_TARGET_REPO.add(session, target)
    _audit(session, actor=actor, action="create", entity_type="model_target", entity_id=target.id)
    return target


def replace_public_model_targets(
    session: Session,
    public_model_id: str,
    targets: list[dict],
    *,
    actor: str = "",
    require_members: bool = False,
) -> list[ModelTargetORM]:
    """Atomically re-declare one public model's member list (ticket 10/12).

    targets is a list of {upstream_model_id, priority, weight, when}. Existing rows
    are updated in place so their ids stay stable; members that dropped out are
    removed. Validation is identical to the renderer's, so the console can never
    store a routing plan the IR would reject. Members are ordered by priority
    (AG: numeric SMALL first) before the conditional last-member rule is applied.

    require_members=True is the PATCH save path (ticket 12): the final state must
    still have at least one member, so an empty re-declaration is rejected and a
    failed save rolls back as a whole.
    """
    public = session.get(PublicModelORM, public_model_id)
    if public is None:
        raise AppError(ErrorCode.NOT_FOUND, f"public model not found: {public_model_id}")
    if require_members and not targets:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, "公开模型至少需要一个成员（members）"
        )
    existing = {
        row.upstream_model_id: row
        for row in session.scalars(
            select(ModelTargetORM).where(ModelTargetORM.public_model_id == public_model_id)
        ).all()
    }
    ordered = sorted(
        enumerate(targets),
        key=lambda pair: (int(pair[1].get("priority", 1)), pair[0]),
    )
    seen: set[str] = set()
    rows: list[ModelTargetORM] = []
    for position, (_, draft) in enumerate(ordered):
        upstream_model_id = str(draft.get("upstream_model_id", "") or "")
        if not upstream_model_id:
            raise AppError(ErrorCode.VALIDATION_ERROR, "成员缺少 upstream_model_id")
        if upstream_model_id in seen:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"同一上游模型不能在同一公开模型里重复: {upstream_model_id}",
            )
        seen.add(upstream_model_id)
        if session.get(UpstreamModelORM, upstream_model_id) is None:
            raise AppError(
                ErrorCode.NOT_FOUND, f"upstream model not found: {upstream_model_id}"
            )
        priority = int(draft.get("priority", 1))
        weight = int(draft.get("weight", 0))
        when_expr = str(draft.get("when", "") or "")
        validate_target_shape(
            public.routing_mode, priority=priority, weight=weight, when_expr=when_expr
        )
        if public.routing_mode == "conditional" and not when_expr:
            if position != len(ordered) - 1:
                raise AppError(
                    ErrorCode.VALIDATION_ERROR,
                    "conditional 模式下只有最后一名成员可以留空 when",
                )
        row = existing.get(upstream_model_id)
        if row is None:
            row = ModelTargetORM(
                id=new_id("mtgt"),
                public_model_id=public_model_id,
                upstream_model_id=upstream_model_id,
                created_at_ms=now_ms(),
            )
            MODEL_TARGET_REPO.add(session, row)
        row.priority = priority
        row.weight = weight
        row.when_expr = when_expr
        row.enabled = True
        rows.append(row)
    for upstream_model_id, row in existing.items():
        if upstream_model_id not in seen:
            MODEL_TARGET_REPO.delete(session, row)
    session.flush()
    _audit(
        session,
        actor=actor,
        action="replace_targets",
        entity_type="public_model",
        entity_id=public_model_id,
    )
    return rows


def set_public_model_routing_mode(
    session: Session,
    public: PublicModelORM,
    routing_mode: str,
    *,
    validate_members: bool = True,
) -> None:
    """Switch strategy only when every existing member still fits the new mode.

    validate_members=False is the combined PATCH path (ticket 12): the same request
    re-declares the whole member list, so the old rows are not the final state and
    must not be validated against the incoming mode (the new list is).
    """
    from l02_domain.ir import ROUTING_MODES

    if routing_mode not in ROUTING_MODES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown routing_mode: {routing_mode}",
            details={"routing_mode": routing_mode, "known": list(ROUTING_MODES)},
        )
    if validate_members:
        members = sorted(
            session.scalars(
                select(ModelTargetORM).where(
                    ModelTargetORM.public_model_id == public.id
                )
            ).all(),
            key=lambda row: (row.priority, row.id),
        )
        for position, row in enumerate(members):
            validate_target_shape(
                routing_mode,
                priority=row.priority,
                weight=row.weight,
                when_expr=row.when_expr,
            )
            if (
                routing_mode == "conditional"
                and not row.when_expr
                and position != len(members) - 1
            ):
                raise AppError(
                    ErrorCode.VALIDATION_ERROR,
                    "切换为 conditional 前，请先给除最后一名以外的成员补上 when",
                )
    public.routing_mode = routing_mode
    session.flush()


def delete_upstream_model(
    session: Session, upstream_model_id: str, *, actor: str = ""
) -> None:
    """Referenced models are protected (old console refused the same deletion)."""
    row = session.get(UpstreamModelORM, upstream_model_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"upstream model not found: {upstream_model_id}")
    reference = session.scalars(
        select(ModelTargetORM).where(ModelTargetORM.upstream_model_id == upstream_model_id)
    ).first()
    if reference is not None:
        raise AppError(
            ErrorCode.CONFLICT,
            "该上游模型仍被公开模型引用，先移除成员再删除",
            details={
                "target_id": reference.id,
                "public_model_id": reference.public_model_id,
            },
        )
    UPSTREAM_MODEL_REPO.delete(session, row)
    _audit(
        session,
        actor=actor,
        action="delete",
        entity_type="upstream_model",
        entity_id=upstream_model_id,
    )


def delete_public_model(session: Session, public_model_id: str, *, actor: str = "") -> None:
    """Members are owned by the public model, so deletion cascades to its targets."""
    row = session.get(PublicModelORM, public_model_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"public model not found: {public_model_id}")
    for target in session.scalars(
        select(ModelTargetORM).where(ModelTargetORM.public_model_id == public_model_id)
    ).all():
        MODEL_TARGET_REPO.delete(session, target)
    PUBLIC_MODEL_REPO.delete(session, row)
    _audit(
        session,
        actor=actor,
        action="delete",
        entity_type="public_model",
        entity_id=public_model_id,
    )


def create_user(
    session: Session,
    *,
    name: str,
    username: str,
    password_hash: str,
    balance_micro: int = 0,
    parent_user_id: str | None = None,
    role: str = "customer",
    status: str = "active",
    actor: str = "",
) -> UserORM:
    """One unified user row (ADR-019 + W7): role, tree position and login.

    username is the immutable login name; password_hash arrives pre-hashed from
    the auth service (the plaintext never reaches the CRUD layer). Every user is
    a login account, so both are mandatory: a row without them would be a
    "无登录帐户" half-product that can never sign in.
    """
    if not username or not username.strip():
        raise AppError(ErrorCode.VALIDATION_ERROR, "username 不能为空（每个用户都是登录账号）")
    if not password_hash:
        raise AppError(ErrorCode.VALIDATION_ERROR, "password_hash 不能为空（每个用户都是登录账号）")
    stamp = now_ms()
    user = UserORM(
        id=new_id("user"),
        name=name,
        username=username,
        password_hash=password_hash,
        balance_micro=balance_micro,
        parent_user_id=parent_user_id,
        role=role,
        status=status,
        created_at_ms=stamp,
        updated_at_ms=stamp,
    )
    USER_REPO.add(session, user)
    _audit(session, actor=actor, action="create", entity_type="user", entity_id=user.id)
    return user


def create_availability_rule(
    session: Session,
    *,
    kind: str,
    scope: str,
    scope_id: str,
    recurrence: str | None = None,
    expires_at_ms: int | None = None,
    schedule_json: str | None = None,
    note: str = "",
    actor: str = "",
) -> AvailabilityRuleORM:
    rule = availability.create_rule(
        session,
        kind=kind,
        scope=scope,
        scope_id=scope_id,
        recurrence=recurrence,
        expires_at_ms=expires_at_ms,
        schedule_json=schedule_json,
        note=note,
    )
    _audit(
        session, actor=actor, action="create", entity_type="availability_rule", entity_id=rule.id
    )
    return rule


def delete_entity(
    session: Session, orm_class: type, repo, entity_id: str, *, actor: str = ""
) -> None:
    """Delete by id for any repository-backed entity, guarding FK orphans upstream."""
    obj = repo.get(session, entity_id)
    if obj is None:
        raise AppError(ErrorCode.NOT_FOUND, f"{orm_class.__tablename__} not found: {entity_id}")
    if orm_class is UpstreamORM:
        orphans = session.scalars(
            select(UpstreamModelORM).where(UpstreamModelORM.upstream_id == entity_id)
        ).first()
        if orphans is not None:
            raise AppError(ErrorCode.CONFLICT, "upstream still has models")
    if orm_class is PublicModelORM:
        orphans = session.scalars(
            select(ModelTargetORM).where(ModelTargetORM.public_model_id == entity_id)
        ).first()
        if orphans is not None:
            raise AppError(ErrorCode.CONFLICT, "public model still has targets")
    if orm_class is UpstreamModelORM:
        orphans = session.scalars(
            select(ModelTargetORM).where(ModelTargetORM.upstream_model_id == entity_id)
        ).first()
        if orphans is not None:
            raise AppError(ErrorCode.CONFLICT, "upstream model still referenced by targets")
    repo.delete(session, obj)
    _audit(
        session,
        actor=actor,
        action="delete",
        entity_type=orm_class.__tablename__,
        entity_id=entity_id,
    )
