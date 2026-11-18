"""Structured rewrite-rule storage codec (transforms-compiler.md v2 §5, ADR-009).

Parses/validates the JSON storage form into IR types. AG nouns stay out: this
module speaks the contract vocabulary (segments, ops, conditions); CEL emission
happens in l03_adapters. Invariants enforced here: protected headers rejected
loudly, unconditional fallback rows must come last per segment, and the verb
vocabulary is the unified ADR-009 set for all four segments.
"""

from __future__ import annotations

import json
from dataclasses import asdict

from l01_core.errors import AppError, ErrorCode
from l02_domain.ir import (
    CONDITION_MODES,
    PROTECTED_HEADERS,
    UNIFIED_OPS,
    BodyRule,
    HeaderRule,
    RewriteCondition,
    TransformsSpec,
)

ENTRY_TYPES = ("topup", "consumption")
KEY_STATUSES = ("active", "disabled")


def _is_protected(name: str) -> bool:
    return name.strip().lower() in PROTECTED_HEADERS


def _parse_conditions(raw: list[dict]) -> tuple[RewriteCondition, ...]:
    conditions = []
    for item in raw:
        mode = str(item.get("mode", ""))
        if mode not in CONDITION_MODES:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"unknown condition mode: {mode}",
                details={"mode": mode, "known": list(CONDITION_MODES)},
            )
        field = str(item.get("field", ""))
        if not field:
            raise AppError(ErrorCode.VALIDATION_ERROR, "condition field is required")
        conditions.append(
            RewriteCondition(field=field, mode=mode, value=str(item.get("value", "")))
        )
    return tuple(conditions)


def _check_fallback_last(rules: tuple, segment: str) -> None:
    """Once an unconditional row appears, later conditional rows are an error (v2 §4.2)."""
    seen_fallback = False
    for rule in rules:
        if rule.conditions:
            if seen_fallback:
                raise AppError(
                    ErrorCode.VALIDATION_ERROR,
                    "conditional row after unconditional fallback in "
                    f"{segment}; fallback must be last",
                    details={"segment": segment},
                )
        else:
            seen_fallback = True


def _validate_op(op: str, segment: str) -> None:
    if op not in UNIFIED_OPS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"op {op!r} not allowed on {segment}",
            details={"op": op, "known": list(UNIFIED_OPS)},
        )


def parse_header_rules(segment: str, raw: list[dict]) -> tuple[HeaderRule, ...]:
    """Header rows use the same verbs as body rows (ADR-009); names are protected-checked."""
    rules: list[HeaderRule] = []
    for item in raw:
        op = str(item.get("op", ""))
        _validate_op(op, segment)
        name = str(item.get("name", ""))
        if not name:
            raise AppError(ErrorCode.VALIDATION_ERROR, f"{segment} rule needs a header name")
        targets = [name, str(item.get("target_name", ""))]
        if _is_protected(name) or any(_is_protected(t) for t in targets if t):
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"protected header {name!r} cannot be rewritten",
                details={"header": name, "protected": list(PROTECTED_HEADERS)},
            )
        if op == "copy" and not str(item.get("source_name", "")):
            raise AppError(ErrorCode.VALIDATION_ERROR, "copy needs source_name")
        rules.append(
            HeaderRule(
                op=op,
                name=name,
                value=str(item.get("value", "")),
                source_name=str(item.get("source_name", "")),
                target_name=str(item.get("target_name", "")),
                regex=str(item.get("regex", "")),
                replacement=str(item.get("replacement", "")),
                conditions=_parse_conditions(item.get("conditions", [])),
            )
        )
    result = tuple(rules)
    _check_fallback_last(result, segment)
    return result


def parse_body_rules(segment: str, raw: list[dict]) -> tuple[BodyRule, ...]:
    rules: list[BodyRule] = []
    for item in raw:
        op = str(item.get("op", ""))
        _validate_op(op, segment)
        rule = BodyRule(
            op=op,
            path=str(item.get("path", "")),
            value=str(item.get("value", "")),
            source_path=str(item.get("source_path", "")),
            target_path=str(item.get("target_path", "")),
            regex=str(item.get("regex", "")),
            replacement=str(item.get("replacement", "")),
            conditions=_parse_conditions(item.get("conditions", [])),
        )
        needs_path = op not in ("to_upper", "to_lower")
        if needs_path and not rule.path and not (op == "copy" and rule.target_path):
            raise AppError(ErrorCode.VALIDATION_ERROR, f"body op {op} needs a path")
        # W2 (user decision): body rules may rewrite ANY path, including
        # model/stream. Rewriting body.model changes routing and toggling stream
        # can break SSE framing, but that risk belongs to the administrator, so
        # the codec no longer rejects it - only the path-shape checks above run.
        rules.append(rule)
    result = tuple(rules)
    _check_fallback_last(result, segment)
    return result


def parse_transforms(payload: dict) -> TransformsSpec:
    """Validate the v2 storage form; raises AppError with readable reasons."""
    spec = TransformsSpec(
        request_headers=parse_header_rules("request_headers", payload.get("request_headers", [])),
        response_headers=parse_header_rules(
            "response_headers", payload.get("response_headers", [])
        ),
        request_body=parse_body_rules("request_body", payload.get("request_body", [])),
        response_body=parse_body_rules("response_body", payload.get("response_body", [])),
    )
    empty = not any(
        (spec.request_headers, spec.request_body, spec.response_headers, spec.response_body)
    )
    return TransformsSpec() if empty else spec


def transforms_from_json(raw: str | None) -> TransformsSpec | None:
    """Storage column -> spec; empty/None means no transforms configured."""
    if not raw or raw.strip() in ("", "{}"):
        return None
    try:
        return parse_transforms(json.loads(raw))
    except json.JSONDecodeError:
        raise AppError(ErrorCode.SCHEMA_MISMATCH, "transforms_json is not valid JSON") from None


def header_rule_to_dict(rule: HeaderRule) -> dict:
    out: dict = {
        "op": rule.op,
        "name": rule.name,
        "conditions": [asdict(c) for c in rule.conditions],
    }
    for field in ("value", "source_name", "target_name", "regex", "replacement"):
        if getattr(rule, field):
            out[field] = getattr(rule, field)
    return out


def body_rule_to_dict(rule: BodyRule) -> dict:
    out: dict = {"op": rule.op, "conditions": [asdict(c) for c in rule.conditions]}
    for field in ("path", "value", "source_path", "target_path", "regex", "replacement"):
        if getattr(rule, field):
            out[field] = getattr(rule, field)
    return out


def transforms_to_json(spec: TransformsSpec | None) -> str:
    """Spec -> §5 storage JSON (stable key order for byte-identical round-trips)."""
    if spec is None:
        return ""
    payload = {
        "request_headers": [header_rule_to_dict(r) for r in spec.request_headers],
        "request_body": [body_rule_to_dict(r) for r in spec.request_body],
        "response_headers": [header_rule_to_dict(r) for r in spec.response_headers],
        "response_body": [body_rule_to_dict(r) for r in spec.response_body],
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
