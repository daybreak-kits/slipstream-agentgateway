"""In-memory sample simulation for rewrite rules (ticket 05 preview surface).

Sample testing lets an administrator paste request/response headers and bodies and see
which fields a rule set would change. It is deliberately read-only: the same IR that the
adapter compiles (`parse_transforms` output) is replayed against an in-memory snapshot;
nothing is persisted, no adapter is asked to compile, and no upstream is contacted.

Semantics mirror the compiled behavior where it is observable
(docs/contracts/transforms-compiler.md v2):
- header create only writes when the header is missing; header update is emitted as an
  unconditional `set`, so the simulation also writes it (overwrite/create);
- body create/update keep the compiler guards (missing field stays untouched);
- string verbs only rewrite an existing string value; a missing/non-string field is
  left alone instead of crashing the preview;
- rows are applied in document order per segment, conditions AND together and are
  evaluated against the current snapshot of the same phase.

Absolute condition variables such as `response.code` are not part of the pasted sample,
so those conditions never match and the row is reported as a no-op.
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any

from l02_domain.ir import BodyRule, HeaderRule, RewriteCondition, TransformsSpec

SAMPLE_SEGMENTS = (
    "request_headers",
    "request_body",
    "response_headers",
    "response_body",
)

_MISSING = object()


def _normalize_phase(raw: dict | None) -> dict:
    """Pasted phase -> {headers: dict[str, str], body: JSON value}."""
    if not isinstance(raw, dict):
        return {"headers": {}, "body": None}
    headers = raw.get("headers")
    if not isinstance(headers, dict):
        headers = {}
    return {
        "headers": {str(key): str(value) for key, value in headers.items()},
        "body": raw.get("body"),
    }


def _header_key(headers: dict, name: str) -> str | object:
    lowered = name.strip().lower()
    for key in headers:
        if key.lower() == lowered:
            return key
    return _MISSING


def _header_get(headers: dict, name: str) -> Any:
    key = _header_key(headers, name)
    return _MISSING if key is _MISSING else headers[key]


def _header_set(headers: dict, name: str, value: str) -> None:
    key = _header_key(headers, name)
    if key is not _MISSING and key != name:
        del headers[key]
    headers[name] = value


def _header_delete(headers: dict, name: str) -> None:
    key = _header_key(headers, name)
    if key is not _MISSING:
        del headers[key]


def _path_parts(path: str) -> list[str]:
    return [part for part in str(path).split(".") if part]


def _body_get(body: Any, path: str) -> Any:
    current = body
    for part in _path_parts(path):
        if isinstance(current, dict):
            if part not in current:
                return _MISSING
            current = current[part]
        elif isinstance(current, list):
            try:
                index = int(part)
            except ValueError:
                return _MISSING
            if index < 0 or index >= len(current):
                return _MISSING
            current = current[index]
        else:
            return _MISSING
    return current


def _body_set(body: Any, path: str, value: Any) -> Any:
    """Write value at the dotted path, creating missing object levels."""
    parts = _path_parts(path)
    if not parts:
        return value
    if not isinstance(body, (dict, list)):
        body = {}
    current = body
    for part in parts[:-1]:
        if isinstance(current, list):
            try:
                index = int(part)
            except ValueError:
                return body
            while len(current) <= index:
                current.append(None)
            if not isinstance(current[index], (dict, list)):
                current[index] = {}
            current = current[index]
        else:
            if not isinstance(current.get(part), (dict, list)):
                current[part] = {}
            current = current[part]
    last = parts[-1]
    if isinstance(current, list):
        try:
            index = int(last)
        except ValueError:
            return body
        while len(current) <= index:
            current.append(None)
        current[index] = value
    elif isinstance(current, dict):
        current[last] = value
    return body


def _body_delete(body: Any, path: str) -> Any:
    parts = _path_parts(path)
    if not parts:
        return body
    parent = body
    for part in parts[:-1]:
        parent = _body_get(parent, part)
        if parent is _MISSING or not isinstance(parent, (dict, list)):
            return body
    last = parts[-1]
    if isinstance(parent, dict):
        parent.pop(last, None)
    elif isinstance(parent, list):
        try:
            index = int(last)
        except ValueError:
            return body
        if 0 <= index < len(parent):
            del parent[index]
    return body


def _typed_value(raw: str) -> Any:
    """Mirror the compiler value typing: booleans/null/numbers stay bare JSON scalars."""
    lowered = raw.lower()
    if lowered in ("true", "false"):
        return lowered == "true"
    if lowered == "null":
        return None
    try:
        number = float(raw)
    except ValueError:
        return raw
    if "." not in raw and "e" not in lowered:
        return int(number)
    return number


def _as_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _condition_left(condition: RewriteCondition, segment: str, phase: dict) -> Any:
    if segment.endswith("_headers"):
        value = _header_get(phase["headers"], condition.field)
        return None if value is _MISSING else value
    field = condition.field
    root = "request" if segment.startswith("request") else "response"
    if field.startswith((root + ".", "request.", "response.")):
        # Absolute data-plane variable (e.g. response.code) - not in the pasted sample.
        return None
    value = _body_get(phase["body"], field)
    return None if value is _MISSING else value


def _condition_matches(condition: RewriteCondition, segment: str, phase: dict) -> bool:
    left = _condition_left(condition, segment, phase)
    if left is None:
        return False
    if condition.mode == "full":
        return _as_text(left) == condition.value
    if condition.mode == "regex":
        try:
            return re.search(condition.value, _as_text(left)) is not None
        except re.error:
            return False
    try:
        left_number = float(left)
        right_number = float(condition.value)
    except (TypeError, ValueError):
        return False
    if condition.mode == "gt":
        return left_number > right_number
    if condition.mode == "gte":
        return left_number >= right_number
    if condition.mode == "lt":
        return left_number < right_number
    if condition.mode == "lte":
        return left_number <= right_number
    return False


def _diff(path: str, before: Any, after: Any) -> dict | None:
    if before is _MISSING and after is _MISSING:
        return None
    if before is not _MISSING and after is not _MISSING and before == after:
        return None
    return {
        "path": path,
        "before": None if before is _MISSING else before,
        "after": None if after is _MISSING else after,
    }


def _apply_header_rule(rule: HeaderRule, phase: dict) -> dict | None:
    headers = phase["headers"]
    target = (rule.target_name or rule.name) if rule.op == "copy" else rule.name
    before = _header_get(headers, target)
    if rule.op == "update":
        _header_set(headers, target, rule.value)
    elif rule.op == "create":
        if before is _MISSING:
            _header_set(headers, target, rule.value)
    elif rule.op == "delete":
        _header_delete(headers, target)
    elif rule.op == "copy":
        source = _header_get(headers, rule.source_name)
        if source is not _MISSING:
            _header_set(headers, target, source)
    elif rule.op in ("prepend", "append", "regex_replace", "to_upper", "to_lower"):
        if not isinstance(before, str):
            return None
        if rule.op == "prepend":
            _header_set(headers, target, rule.value + before)
        elif rule.op == "append":
            _header_set(headers, target, before + rule.value)
        elif rule.op == "to_upper":
            _header_set(headers, target, before.upper())
        elif rule.op == "to_lower":
            _header_set(headers, target, before.lower())
        else:
            try:
                replaced = re.sub(rule.regex, rule.replacement, before)
            except re.error:
                return None
            _header_set(headers, target, replaced)
    after = _header_get(headers, target)
    return _diff(target, before, after)


def _apply_body_rule(rule: BodyRule, phase: dict) -> dict | None:
    body = phase["body"]
    target = rule.target_path if rule.op == "copy" else rule.path
    if not _path_parts(target):
        return None
    before = _body_get(body, target)
    if rule.op == "update":
        if before is not _MISSING:
            body = _body_set(body, target, _typed_value(rule.value))
    elif rule.op == "create":
        if before is _MISSING:
            body = _body_set(body, target, _typed_value(rule.value))
    elif rule.op == "delete":
        body = _body_delete(body, target)
    elif rule.op == "copy":
        source = _body_get(body, rule.source_path)
        body = _body_set(body, target, None if source is _MISSING else source)
    elif rule.op in ("prepend", "append", "regex_replace", "to_upper", "to_lower"):
        if not isinstance(before, str):
            return None
        if rule.op == "prepend":
            body = _body_set(body, target, rule.value + before)
        elif rule.op == "append":
            body = _body_set(body, target, before + rule.value)
        elif rule.op == "to_upper":
            body = _body_set(body, target, before.upper())
        elif rule.op == "to_lower":
            body = _body_set(body, target, before.lower())
        else:
            try:
                replaced = re.sub(rule.regex, rule.replacement, before)
            except re.error:
                return None
            body = _body_set(body, target, replaced)
    phase["body"] = body
    after = _body_get(body, target)
    return _diff(target, before, after)


def apply_sample_transforms(
    spec: TransformsSpec,
    *,
    request: dict | None = None,
    response: dict | None = None,
) -> dict:
    """Replay the rule set against pasted snapshots; returns before/after plus diffs.

    Read-only by construction: the input dicts are not mutated (deep copies are used),
    and the function never talks to an adapter, a database or the network.
    """
    sample = {
        "request": _normalize_phase(request),
        "response": _normalize_phase(response),
    }
    before = copy.deepcopy(sample)
    after = copy.deepcopy(sample)
    diff: list[dict] = []
    for segment in SAMPLE_SEGMENTS:
        phase_name = "request" if segment.startswith("request") else "response"
        kind = "header" if segment.endswith("_headers") else "body"
        phase = after[phase_name]
        for rule in getattr(spec, segment):
            if not all(
                _condition_matches(condition, segment, phase) for condition in rule.conditions
            ):
                continue
            entry = (
                _apply_header_rule(rule, phase)
                if kind == "header"
                else _apply_body_rule(rule, phase)
            )
            if entry is None:
                continue
            diff.append({**entry, "segment": segment, "kind": kind, "op": rule.op})
    return {"before": before, "after": after, "diff": diff}
