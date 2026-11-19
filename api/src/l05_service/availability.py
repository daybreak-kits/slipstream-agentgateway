"""Availability: one evaluator and one writer for bans and cooldowns (ADR-004).

The domain has exactly two measures: a permanent ban and a temporary cooldown.
A cooldown has two shapes, once and recurring (daily/weekly/monthly); both are
first-class and stay supported.

``availability_rules`` is the only write authority. A model row's
``cooldown_until_ms`` is a projection/cache maintained by
``sync_cooldown_projection``; rendering, the API and the console read the
evaluator below instead of interpreting that column independently. The column
survives because old databases and the row-level "cooldown" action still have a
single scalar to inspect; ``migrate_legacy_cooldowns`` turns a pre-existing
future deadline into the managed rule on startup.

State vocabulary shared by the API and rendering:

- ``normal`` (active): no active measure;
- ``cooling`` (cooldown): an active cooldown, with its deadline when it has one;
- ``closed`` (disabled): the row is disabled, or an active ban applies.

``closed`` wins over ``cooling``, preserving the old console precedence.

Recurring windows carry a one-shot exception (GLOSSARY §3, 2026-11-19 ruling):
manually enabling a row while one of its own schedule rules is inside the
current window skips THAT window only — ``rule_is_active`` reads the rule's
``skip_until_ms`` (anchored to the window deadline), the rule itself stays and
the next window cools again. The exception dies with the rule row, is cleared
when the schedule is re-applied (update_rule) or by 解除冷却
(``release_model_cooldown``), and expires lazily once the window has passed.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, tzinfo
from enum import StrEnum
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.timeutil import now_ms as utc_now_ms
from l04_repo.orm import (
    AvailabilityRuleORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
    UpstreamORM,
)
from l04_repo.repository import AVAILABILITY_REPO
from l05_service.aggregates import report_timezone

SCOPE_MODEL_TARGET = "model_target"
SCOPE_UPSTREAM = "upstream"
SCOPE_UPSTREAM_MODEL = "upstream_model"
SCOPE_PUBLIC_MODEL = "public_model"
#: Scopes the evaluator can attribute to model targets.
EVALUATOR_SCOPES = (
    SCOPE_UPSTREAM,
    SCOPE_UPSTREAM_MODEL,
    SCOPE_PUBLIC_MODEL,
    SCOPE_MODEL_TARGET,
)
#: Scopes accepted by the create payload (schemas.RuleCreate).
CREATABLE_SCOPES = EVALUATOR_SCOPES
#: Scopes that own a ``cooldown_until_ms`` projection column.
MODEL_SCOPES = (SCOPE_UPSTREAM_MODEL, SCOPE_PUBLIC_MODEL)
#: Note used by the idempotent migration that adopts a legacy row deadline.
LEGACY_NOTE = "legacy row cooldown migrated to availability_rules"


class AvailabilityState(StrEnum):
    """The one vocabulary the API, console and rendering share."""

    NORMAL = "normal"
    COOLING = "cooling"
    CLOSED = "closed"


@dataclass(frozen=True, slots=True)
class AvailabilityView:
    """One row's availability as the API/console see it."""

    state: AvailabilityState
    cooldown_until_ms: int = 0
    # > 0 while a schedule rule's current window was skipped by an explicit
    # 启用 (GLOSSARY §3): the row is usable now, the rule stays, the next
    # window cools again. 0 = no active window exception.
    window_skip_until_ms: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "state": self.state.value,
            "cooldown_until_ms": self.cooldown_until_ms,
            "window_skip_until_ms": self.window_skip_until_ms,
        }


@dataclass(frozen=True, slots=True)
class AvailabilitySnapshot:
    """The evaluator's answer at one instant; one snapshot feeds render + API."""

    now_ms: int
    blocked_target_ids: frozenset[str]
    excluded_upstream_model_ids: frozenset[str]
    excluded_public_model_ids: frozenset[str]
    rules_by_scope: Mapping[tuple[str, str], tuple[AvailabilityRuleORM, ...]]
    upstream_id_by_model: Mapping[str, str]
    # Operations timezone the recurring windows were read in (GLOSSARY §3).
    tz: tzinfo = UTC

    def upstream_model_view(self, row: UpstreamModelORM) -> AvailabilityView:
        upstream_id = self.upstream_id_by_model.get(row.id, "")
        return _row_view(
            scope=SCOPE_UPSTREAM_MODEL,
            scope_id=row.id,
            enabled=row.enabled,
            cooldown_until_ms=row.cooldown_until_ms,
            now_ms=self.now_ms,
            rules_by_scope=self.rules_by_scope,
            ancestor_scope=(SCOPE_UPSTREAM, upstream_id) if upstream_id else None,
            tz=self.tz,
        )

    def public_model_view(self, row: PublicModelORM) -> AvailabilityView:
        return _row_view(
            scope=SCOPE_PUBLIC_MODEL,
            scope_id=row.id,
            enabled=row.enabled,
            cooldown_until_ms=row.cooldown_until_ms,
            now_ms=self.now_ms,
            rules_by_scope=self.rules_by_scope,
        )


def rule_is_active(
    rule: AvailabilityRuleORM, now_ms: int, tz: tzinfo | None = None
) -> bool:
    """Evaluate one rule against a wall-clock instant.

    A one-shot window exception (``skip_until_ms`` in the future, GLOSSARY §3)
    suppresses only that schedule rule's current window; bans are human
    decisions and can never be skipped by an enable. Recurring windows are read
    in ``tz`` (the operations timezone, GLOSSARY §3); None means UTC.
    """
    if rule.kind == "ban":
        return True
    if rule.kind != "cooldown":
        raise AppError(ErrorCode.VALIDATION_ERROR, f"未知可用性措施: {rule.kind}")
    if int(rule.skip_until_ms or 0) > now_ms:
        return False
    recurrence = rule.recurrence or "once"
    if recurrence == "once":
        if rule.expires_at_ms is None:
            return True  # a cooldown without deadline never recovers: treat as active ban-like
        return now_ms < rule.expires_at_ms
    schedule = _load_schedule(rule.schedule_json)
    windows = schedule.get("windows", [])
    return _in_any_window(windows, recurrence, now_ms, tz)


def rule_deadline_ms(
    rule: AvailabilityRuleORM, now_ms: int, tz: tzinfo | None = None
) -> int:
    """When an active cooldown recovers (0 for bans, inactive windows and no deadline)."""
    if rule.kind != "cooldown":
        return 0
    recurrence = rule.recurrence or "once"
    if recurrence == "once":
        deadline = int(rule.expires_at_ms or 0)
        return deadline if deadline > now_ms else 0
    if not rule_is_active(rule, now_ms, tz):
        return 0
    return _window_end_ms(
        _load_schedule(rule.schedule_json).get("windows", []), recurrence, now_ms, tz
    )


def evaluate(session: Session, now_ms: int | None = None) -> AvailabilitySnapshot:
    """Evaluate every rule once; render and the API derive everything from this.

    Recurring windows are interpreted in the operations timezone (app_settings
    `timezone`, GLOSSARY §3), not UTC; the zone rides on the snapshot so every
    view built from it reads the same wall clock.
    """
    moment = int(now_ms if now_ms is not None else utc_now_ms())
    tz = report_timezone(session)
    rules = list(session.scalars(select(AvailabilityRuleORM)).all())
    active = [rule for rule in rules if rule_is_active(rule, moment, tz)]
    rules_by_scope: dict[tuple[str, str], list[AvailabilityRuleORM]] = {}
    for rule in rules:
        rules_by_scope.setdefault((rule.scope, rule.scope_id), []).append(rule)

    targets = list(session.scalars(select(ModelTargetORM)).all())
    models = list(session.scalars(select(UpstreamModelORM)).all())
    public_models = list(session.scalars(select(PublicModelORM)).all())

    targets_by_model: dict[str, set[str]] = {}
    targets_by_public: dict[str, set[str]] = {}
    for target in targets:
        targets_by_model.setdefault(target.upstream_model_id, set()).add(target.id)
        targets_by_public.setdefault(target.public_model_id, set()).add(target.id)
    models_by_upstream: dict[str, set[str]] = {}
    upstream_id_by_model: dict[str, str] = {}
    for model in models:
        models_by_upstream.setdefault(model.upstream_id, set()).add(model.id)
        upstream_id_by_model[model.id] = model.upstream_id

    blocked: set[str] = set()
    excluded_models: set[str] = set()
    excluded_public: set[str] = set()
    for rule in active:
        if rule.scope == SCOPE_UPSTREAM:
            for model_id in models_by_upstream.get(rule.scope_id, ()):
                excluded_models.add(model_id)
                blocked.update(targets_by_model.get(model_id, ()))
        elif rule.scope == SCOPE_UPSTREAM_MODEL:
            excluded_models.add(rule.scope_id)
            blocked.update(targets_by_model.get(rule.scope_id, ()))
        elif rule.scope == SCOPE_PUBLIC_MODEL:
            excluded_public.add(rule.scope_id)
            blocked.update(targets_by_public.get(rule.scope_id, ()))
        elif rule.scope == SCOPE_MODEL_TARGET:
            blocked.add(rule.scope_id)
        else:
            raise AppError(ErrorCode.VALIDATION_ERROR, f"未知可用性 scope: {rule.scope}")

    # Old databases may have a future deadline without a rule. It is read as a
    # synthetic once-cooldown until migrate_legacy_cooldowns adopts it; the
    # presence of a managed rule suppresses this fallback, so a stale projection
    # can never extend a cooldown.
    rule_ids = {rule.id for rule in rules}
    for model in models:
        if row_cooldown_rule_id(SCOPE_UPSTREAM_MODEL, model.id) in rule_ids:
            continue
        if int(model.cooldown_until_ms or 0) > moment:
            excluded_models.add(model.id)
            blocked.update(targets_by_model.get(model.id, ()))
    for public in public_models:
        if row_cooldown_rule_id(SCOPE_PUBLIC_MODEL, public.id) in rule_ids:
            continue
        if int(public.cooldown_until_ms or 0) > moment:
            excluded_public.add(public.id)
            blocked.update(targets_by_public.get(public.id, ()))

    return AvailabilitySnapshot(
        now_ms=moment,
        tz=tz,
        blocked_target_ids=frozenset(blocked),
        excluded_upstream_model_ids=frozenset(excluded_models),
        excluded_public_model_ids=frozenset(excluded_public),
        rules_by_scope={key: tuple(value) for key, value in rules_by_scope.items()},
        upstream_id_by_model=upstream_id_by_model,
    )


def blocked_target_ids(session: Session, now_ms: int) -> set[str]:
    """Compatibility wrapper; new code should keep the snapshot and use all of it."""
    return set(evaluate(session, now_ms).blocked_target_ids)


def create_rule(
    session: Session,
    *,
    kind: str,
    scope: str,
    scope_id: str,
    recurrence: str | None = None,
    expires_at_ms: int | None = None,
    schedule_json: str | None = None,
    note: str = "",
) -> AvailabilityRuleORM:
    """Validate and persist one rule, then refresh its projection."""
    validate_rule_payload(
        session,
        kind=kind,
        scope=scope,
        scope_id=scope_id,
        recurrence=recurrence,
        expires_at_ms=expires_at_ms,
        schedule_json=schedule_json,
    )
    rule = AvailabilityRuleORM(
        id=new_id("rule"),
        kind=kind,
        scope=scope,
        scope_id=scope_id,
        recurrence=recurrence,
        expires_at_ms=expires_at_ms,
        schedule_json=schedule_json,
        note=note or "",
        created_at_ms=utc_now_ms(),
    )
    AVAILABILITY_REPO.add(session, rule)
    session.flush()
    sync_cooldown_projection(session, scope=scope, scope_id=scope_id)
    return rule


def update_rule(
    session: Session, rule_id: str, changes: Mapping[str, Any]
) -> AvailabilityRuleORM:
    """Partially update a rule; the merged row is re-validated as a whole."""
    rule = AVAILABILITY_REPO.get(session, rule_id)
    if rule is None:
        raise AppError(ErrorCode.NOT_FOUND, f"availability rule not found: {rule_id}")
    old_scope, old_scope_id = rule.scope, rule.scope_id
    merged: dict[str, Any] = {
        "kind": rule.kind,
        "scope": rule.scope,
        "scope_id": rule.scope_id,
        "recurrence": rule.recurrence,
        "expires_at_ms": rule.expires_at_ms,
        "schedule_json": rule.schedule_json,
    }
    for field in ("kind", "scope", "scope_id", "recurrence", "expires_at_ms", "schedule_json"):
        if field in changes:
            merged[field] = changes[field]
    validate_rule_payload(session, **merged)
    for field, value in merged.items():
        setattr(rule, field, value)
    if "note" in changes:
        rule.note = changes["note"] or ""
    if any(
        field in changes
        for field in ("kind", "recurrence", "expires_at_ms", "schedule_json")
    ):
        # Re-applying the rule invalidates the anchored window exception
        # (GLOSSARY §3: 重新应用规则清除例外); note-only edits keep it.
        rule.skip_until_ms = 0
        rule.skip_set_at_ms = 0
    session.flush()
    sync_cooldown_projection(session, scope=old_scope, scope_id=old_scope_id)
    sync_cooldown_projection(session, scope=rule.scope, scope_id=rule.scope_id)
    return rule


def delete_rule(session: Session, rule_id: str) -> None:
    """Delete a rule and refresh the projection of its scope."""
    rule = AVAILABILITY_REPO.get(session, rule_id)
    if rule is None:
        raise AppError(ErrorCode.NOT_FOUND, f"availability rule not found: {rule_id}")
    if rule.id == row_cooldown_rule_id(rule.scope, rule.scope_id):
        _write_projection_column(session, rule.scope, rule.scope_id, 0)
    AVAILABILITY_REPO.delete(session, rule)
    session.flush()
    sync_cooldown_projection(session, scope=rule.scope, scope_id=rule.scope_id)


def validate_cooldown_until(until_ms: int | None) -> int:
    """Normalize a row-cooldown deadline; a non-zero value must be in the future."""
    deadline = int(until_ms or 0)
    if deadline and deadline <= utc_now_ms():
        raise AppError(ErrorCode.VALIDATION_ERROR, "冷却截止时间必须晚于当前时间")
    return deadline


def set_model_cooldown(
    session: Session, *, scope: str, scope_id: str, until_ms: int | None
) -> int:
    """Set/release the row-level cooldown through its single managed rule.

    This is the write path behind the model page's 冷却/解除 actions. The API
    keeps accepting ``cooldown_until_ms`` so existing clients (and the compiled
    frontend) keep working, but the value lands in the rule table, never as a
    second source of truth.
    """
    if scope not in MODEL_SCOPES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"scope 必须是 {'/'.join(MODEL_SCOPES)}，得到 {scope!r}",
        )
    deadline = validate_cooldown_until(until_ms)
    _require_scope_id(session, scope, scope_id)
    managed_id = row_cooldown_rule_id(scope, scope_id)
    rule = session.get(AvailabilityRuleORM, managed_id)
    if deadline:
        if rule is None:
            rule = AvailabilityRuleORM(
                id=managed_id,
                kind="cooldown",
                scope=scope,
                scope_id=scope_id,
                recurrence="once",
                expires_at_ms=deadline,
                schedule_json=None,
                note="",
                created_at_ms=utc_now_ms(),
            )
            AVAILABILITY_REPO.add(session, rule)
        else:
            rule.kind = "cooldown"
            rule.recurrence = "once"
            rule.expires_at_ms = deadline
            rule.schedule_json = None
    else:
        if rule is not None:
            AVAILABILITY_REPO.delete(session, rule)
        _write_projection_column(session, scope, scope_id, 0)
    session.flush()
    sync_cooldown_projection(session, scope=scope, scope_id=scope_id)
    return deadline


def release_model_cooldown(session: Session, *, scope: str, scope_id: str) -> None:
    """解除冷却: remove the managed once-cooldown and any window exception.

    Periodic rules stay authoritative (ADR-004: 解除只删托管规则，不误删周期规则),
    so a row inside an active window cools again — this is also the documented
    way to undo a 启用 window-skip (GLOSSARY §3: 例外可通过解除冷却清除).
    """
    _clear_window_skips(session, scope=scope, scope_id=scope_id)
    set_model_cooldown(session, scope=scope, scope_id=scope_id, until_ms=0)


def enable_model_availability(
    session: Session, *, scope: str, scope_id: str, now_ms: int | None = None
) -> dict[str, Any] | None:
    """Write path behind 启用: release the row cooldown + skip the current window.

    The router clears the row's ``enabled`` flag itself. Here the managed
    once-cooldown is removed (old reset semantics) and, when one of the scope's
    own schedule rules is inside its window right now, a one-shot exception
    (``skip_until_ms`` = that window's deadline) suppresses exactly that window:
    the rule stays and later windows cool again (GLOSSARY §3, 2026-11-19
    ruling). Returns the API hint payload, or None when nothing was skipped.
    """
    if scope not in MODEL_SCOPES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"scope 必须是 {'/'.join(MODEL_SCOPES)}，得到 {scope!r}",
        )
    moment = int(now_ms if now_ms is not None else utc_now_ms())
    tz = report_timezone(session)
    rules = list(
        session.scalars(
            select(AvailabilityRuleORM).where(
                AvailabilityRuleORM.scope == scope,
                AvailabilityRuleORM.scope_id == scope_id,
            )
        ).all()
    )
    skipped: list[str] = []
    skip_until = 0
    for rule in rules:
        if rule.kind != "cooldown" or (rule.recurrence or "once") == "once":
            continue
        if not rule_is_active(rule, moment, tz):
            continue  # only a rule inside its window right now gets skipped
        deadline = rule_deadline_ms(rule, moment, tz)
        if deadline <= moment:
            continue
        rule.skip_until_ms = deadline
        rule.skip_set_at_ms = moment
        skipped.append(rule.id)
        skip_until = max(skip_until, deadline)
    if skipped:
        session.flush()
    # The projection refresh inside set_model_cooldown sees the freshly set
    # skips, so a skipped window contributes no cooldown_until_ms.
    set_model_cooldown(session, scope=scope, scope_id=scope_id, until_ms=0)
    if not skipped:
        return None
    return {
        "rule_ids": skipped,
        "skip_until_ms": skip_until,
        "message": "本次启用仅跳过当前窗口，后续窗口照常",
    }


def _clear_window_skips(session: Session, *, scope: str, scope_id: str) -> None:
    """Drop one-shot window exceptions of a scope; the rules themselves stay."""
    for rule in session.scalars(
        select(AvailabilityRuleORM).where(
            AvailabilityRuleORM.scope == scope,
            AvailabilityRuleORM.scope_id == scope_id,
        )
    ).all():
        if int(rule.skip_until_ms or 0) or int(rule.skip_set_at_ms or 0):
            rule.skip_until_ms = 0
            rule.skip_set_at_ms = 0


def row_cooldown_rule_id(scope: str, scope_id: str) -> str:
    """Deterministic id for the rule that mirrors a model row's own cooldown."""
    digest = hashlib.sha256(f"{scope}:{scope_id}".encode()).hexdigest()[:32]
    return f"rule_row_{digest}"


def sync_cooldown_projection(
    session: Session, *, scope: str, scope_id: str, now_ms: int | None = None
) -> int:
    """Refresh one model row's legacy ``cooldown_until_ms`` from the rules."""
    if scope not in MODEL_SCOPES:
        return 0
    moment = int(now_ms if now_ms is not None else utc_now_ms())
    tz = report_timezone(session)
    orm = UpstreamModelORM if scope == SCOPE_UPSTREAM_MODEL else PublicModelORM
    row = session.get(orm, scope_id)
    if row is None:
        return 0
    rules = list(
        session.scalars(
            select(AvailabilityRuleORM).where(
                AvailabilityRuleORM.scope == scope,
                AvailabilityRuleORM.scope_id == scope_id,
            )
        ).all()
    )
    deadline = _projected_deadline(rules, now_ms=moment, tz=tz)
    if int(row.cooldown_until_ms or 0) != deadline:
        row.cooldown_until_ms = deadline
    return deadline


def sync_all_cooldown_projections(session: Session, now_ms: int | None = None) -> int:
    """Refresh every model row projection; used at startup and on window boundaries."""
    moment = int(now_ms if now_ms is not None else utc_now_ms())
    tz = report_timezone(session)
    rules = list(session.scalars(select(AvailabilityRuleORM)).all())
    by_scope: dict[tuple[str, str], list[AvailabilityRuleORM]] = {}
    for rule in rules:
        by_scope.setdefault((rule.scope, rule.scope_id), []).append(rule)
    changed = 0
    for scope, orm in (
        (SCOPE_UPSTREAM_MODEL, UpstreamModelORM),
        (SCOPE_PUBLIC_MODEL, PublicModelORM),
    ):
        for row in session.scalars(select(orm)).all():
            deadline = _projected_deadline(
                by_scope.get((scope, row.id), []), now_ms=moment, tz=tz
            )
            if int(row.cooldown_until_ms or 0) != deadline:
                row.cooldown_until_ms = deadline
                changed += 1
    session.flush()
    return changed


def migrate_legacy_cooldowns(session: Session, now_ms: int | None = None) -> int:
    """Adopt pre-existing row deadlines into managed rules; idempotent, additive.

    Startup calls this so an old database becomes rule-authoritative without a
    schema migration. A future deadline becomes the managed once-cooldown; an
    expired one is cleared. No rule or column is dropped.
    """
    moment = int(now_ms if now_ms is not None else utc_now_ms())
    adopted = 0
    for scope, orm in (
        (SCOPE_UPSTREAM_MODEL, UpstreamModelORM),
        (SCOPE_PUBLIC_MODEL, PublicModelORM),
    ):
        for row in session.scalars(select(orm)).all():
            managed_id = row_cooldown_rule_id(scope, row.id)
            if session.get(AvailabilityRuleORM, managed_id) is not None:
                continue
            deadline = int(row.cooldown_until_ms or 0)
            if deadline <= 0:
                continue
            if deadline <= moment:
                row.cooldown_until_ms = 0
                continue
            AVAILABILITY_REPO.add(
                session,
                AvailabilityRuleORM(
                    id=managed_id,
                    kind="cooldown",
                    scope=scope,
                    scope_id=row.id,
                    recurrence="once",
                    expires_at_ms=deadline,
                    schedule_json=None,
                    note=LEGACY_NOTE,
                    created_at_ms=moment,
                ),
            )
            adopted += 1
    session.flush()
    sync_all_cooldown_projections(session, now_ms=moment)
    return adopted


def rules_changed_since(
    session: Session, since_ms: int, now_ms: int | None = None
) -> list[AvailabilityRuleORM]:
    """Cooldown rules whose effective state changed in (since_ms, now].

    Covers once-expiry and recurring-window boundaries, plus a window exception
    created by 启用 (skip_set_at_ms): the skip is stored state, so comparing
    stored-state activity alone would retroactively hide the transition. The
    render job uses this to know when the data plane must be refreshed.
    """
    moment = int(now_ms if now_ms is not None else utc_now_ms())
    tz = report_timezone(session)
    rules = list(
        session.scalars(
            select(AvailabilityRuleORM).where(AvailabilityRuleORM.kind == "cooldown")
        ).all()
    )
    return [
        rule
        for rule in rules
        if rule_is_active(rule, since_ms, tz) != rule_is_active(rule, moment, tz)
        or since_ms < int(rule.skip_set_at_ms or 0) <= moment
    ]


def validate_rule_payload(
    session: Session,
    *,
    kind: str,
    scope: str,
    scope_id: str,
    recurrence: str | None,
    expires_at_ms: int | None,
    schedule_json: str | None,
) -> None:
    """Structural checks at creation time; 判据 per GLOSSARY §3.

    The scope is validated here, not at render time: an unroutable rule must fail
    the create call (422 with a real message) instead of exploding when the next
    configuration is rendered.
    """
    if kind not in {"ban", "cooldown"}:
        raise AppError(ErrorCode.VALIDATION_ERROR, f"kind 必须是 ban/cooldown，得到 {kind!r}")
    if scope not in CREATABLE_SCOPES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"scope 必须是 {'/'.join(CREATABLE_SCOPES)}，得到 {scope!r}",
        )
    if not scope_id:
        raise AppError(ErrorCode.VALIDATION_ERROR, "scope_id 不能为空")
    _require_scope_id(session, scope, scope_id)
    if kind == "ban":
        return
    rec = recurrence or "once"
    if rec not in {"once", "daily", "weekly", "monthly"}:
        raise AppError(ErrorCode.VALIDATION_ERROR, "recurrence 必须是 once/daily/weekly/monthly")
    if rec == "once" and expires_at_ms is None:
        raise AppError(ErrorCode.VALIDATION_ERROR, "一次性冷却必须提供 expires_at_ms")
    if rec in {"daily", "weekly", "monthly"}:
        schedule = _load_schedule(schedule_json)
        if not schedule.get("windows"):
            raise AppError(ErrorCode.VALIDATION_ERROR, "周期冷却必须提供 schedule_json.windows")


def _row_view(
    *,
    scope: str,
    scope_id: str,
    enabled: bool,
    cooldown_until_ms: int | None,
    now_ms: int,
    rules_by_scope: Mapping[tuple[str, str], tuple[AvailabilityRuleORM, ...]],
    ancestor_scope: tuple[str, str] | None = None,
    tz: tzinfo | None = None,
) -> AvailabilityView:
    if not enabled:
        return AvailabilityView(AvailabilityState.CLOSED)
    rules = list(rules_by_scope.get((scope, scope_id), ()))
    if ancestor_scope is not None:
        rules.extend(rules_by_scope.get(ancestor_scope, ()))
    active = [rule for rule in rules if rule_is_active(rule, now_ms, tz)]
    if any(rule.kind == "ban" for rule in active):
        return AvailabilityView(AvailabilityState.CLOSED)
    deadlines = [
        rule_deadline_ms(rule, now_ms, tz) for rule in active if rule.kind == "cooldown"
    ]
    managed_id = row_cooldown_rule_id(scope, scope_id)
    if not any(rule.id == managed_id for rule in rules_by_scope.get((scope, scope_id), ())):
        legacy = int(cooldown_until_ms or 0)
        if legacy > now_ms:
            deadlines.append(legacy)
    skips = [
        int(rule.skip_until_ms or 0) for rule in rules if int(rule.skip_until_ms or 0) > now_ms
    ]
    window_skip = max(skips, default=0)
    if deadlines:
        return AvailabilityView(
            AvailabilityState.COOLING, max(deadlines), window_skip
        )
    return AvailabilityView(AvailabilityState.NORMAL, 0, window_skip)


def _projected_deadline(
    rules: list[AvailabilityRuleORM], *, now_ms: int, tz: tzinfo | None = None
) -> int:
    """The cache value is derived only from rules; a stale column never feeds itself."""
    return max(
        (
            rule_deadline_ms(rule, now_ms, tz)
            for rule in rules
            if rule.kind == "cooldown" and rule_is_active(rule, now_ms, tz)
        ),
        default=0,
    )


def _write_projection_column(session: Session, scope: str, scope_id: str, value: int) -> None:
    if scope not in MODEL_SCOPES:
        return
    orm = UpstreamModelORM if scope == SCOPE_UPSTREAM_MODEL else PublicModelORM
    row = session.get(orm, scope_id)
    if row is not None:
        row.cooldown_until_ms = value


def _require_scope_id(session: Session, scope: str, scope_id: str) -> None:
    """The referenced entity must exist, so a typo fails at create instead of silently no-oping."""
    models = {
        SCOPE_UPSTREAM: UpstreamORM,
        SCOPE_UPSTREAM_MODEL: UpstreamModelORM,
        SCOPE_PUBLIC_MODEL: PublicModelORM,
        SCOPE_MODEL_TARGET: ModelTargetORM,
    }
    model = models[scope]
    if session.get(model, scope_id) is None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, f"scope_id 指向不存在的 {scope}: {scope_id}"
        )


def _load_schedule(schedule_json: str | None) -> dict[str, Any]:
    if not schedule_json:
        return {}
    try:
        parsed = json.loads(schedule_json)
    except json.JSONDecodeError as exc:
        raise AppError(ErrorCode.VALIDATION_ERROR, "schedule_json 不是合法 JSON") from exc
    if not isinstance(parsed, dict):
        raise AppError(ErrorCode.VALIDATION_ERROR, "schedule_json 必须是对象")
    return parsed


def _in_any_window(
    windows: list[Any], recurrence: str, now_ms: int, tz: tzinfo | None = None
) -> bool:
    return _matching_window(windows, recurrence, now_ms, tz) is not None


def _matching_window(
    windows: list[Any], recurrence: str, now_ms: int, tz: tzinfo | None = None
) -> dict[str, Any] | None:
    moment = datetime.fromtimestamp(now_ms / 1000, tz=tz or UTC)
    minutes_now = moment.hour * 60 + moment.minute
    for window in windows:
        if not isinstance(window, dict):
            continue
        start = _parse_hhmm(window.get("start", "00:00"))
        end = _parse_hhmm(window.get("end", "23:59"))
        if not _time_in_window(minutes_now, start, end):
            continue
        # A cross-midnight window still belongs to the day it STARTED, so its
        # weekly/monthly filter is tested against yesterday after midnight.
        started = (
            moment - timedelta(days=1)
            if start >= end and minutes_now < end
            else moment
        )
        days = window.get("days")
        if recurrence == "weekly" and days and started.isoweekday() not in days:
            continue
        month_days = window.get("days_of_month")
        if recurrence == "monthly" and month_days and started.day not in month_days:
            continue
        return window
    return None


def _window_end_ms(
    windows: list[Any], recurrence: str, now_ms: int, tz: tzinfo | None = None
) -> int:
    """End of the window containing ``now_ms``, or 0 when no window matches.

    The end instant is built in ``tz`` (the operations timezone), so a 02:00-04:00
    window means 02:00-04:00 local time, not UTC (GLOSSARY §3).
    """
    zone = tz or UTC
    window = _matching_window(windows, recurrence, now_ms, tz)
    if window is None:
        return 0
    start = _parse_hhmm(window.get("start", "00:00"))
    end = _parse_hhmm(window.get("end", "23:59"))
    moment = datetime.fromtimestamp(now_ms / 1000, tz=zone)
    minutes_now = moment.hour * 60 + moment.minute
    # Half-open [start, end); end <= start crosses midnight (start == end is a full
    # day). A cross-midnight window that began yesterday ends TODAY, not tomorrow.
    end_minutes = end
    if start >= end:
        day_offset = 1 if minutes_now >= start else 0
    else:
        day_offset = 0
    if end_minutes >= 24 * 60:
        end_minutes = 0
        day_offset += 1
    target = (moment + timedelta(days=day_offset)).date()
    end_at = datetime(
        target.year, target.month, target.day, end_minutes // 60, end_minutes % 60, tzinfo=zone
    )
    return int(end_at.timestamp() * 1000)


def _time_in_window(minutes_now: int, start: int, end: int) -> bool:
    """Half-open [start, end) window; windows may cross midnight (end <= start)."""
    if start == end:
        return True
    if start < end:
        return start <= minutes_now < end
    return minutes_now >= start or minutes_now < end


def _parse_hhmm(text: str) -> int:
    parts = str(text).split(":")
    if len(parts) != 2:
        raise AppError(ErrorCode.VALIDATION_ERROR, f"时间必须是 HH:MM，得到 {text!r}")
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except ValueError as exc:
        raise AppError(ErrorCode.VALIDATION_ERROR, f"时间必须是 HH:MM，得到 {text!r}") from exc
