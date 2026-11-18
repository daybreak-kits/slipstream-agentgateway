"""Compile structured rewrite rules into agentgateway transformations (v2, ADR-009).

docs/contracts/transforms-compiler.md v2: header and body share one verb set
(create/update/delete/copy/prepend/append/regex_replace/to_upper/to_lower).
Header compilation: create->add, update->set, delete->remove; string verbs
operate on request.headers["K"] and write back with set. Body compilation
chains toJson(json(...).with(b, ...)) left-to-right. Conditional rows keep row
order in transformations.conditional[]; unconditional fallback stays last.

E9 confirmed the CEL string surface (regexReplaceAll/upperAscii/lowerAscii all
exist), so regex_replace now emits a real regex call instead of literal
replace(). Per-provider mount point of transformations is still pending
verification.
"""

from __future__ import annotations

import json

from l02_domain.ir import BodyRule, HeaderRule, RewriteCondition, TransformsSpec

MOUNT_NOTE = (
    "transformations mount per upstream (providers[].policies.transformations); "
    "AG-side confirmation pending E9"
)
STREAM_NOTE = "response_body rows apply to non-streaming requests only (contract 4.4)"


def _cel_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _cel_value(raw: str) -> str:
    """Storage values are strings; emit numbers/bools bare, everything else quoted."""
    lowered = raw.lower()
    if lowered in ("true", "false"):
        return lowered
    if lowered == "null":
        return "null"
    try:
        float(raw)
        return raw
    except ValueError:
        return _cel_string(raw)


def _ref_parts(path: str) -> list[str]:
    return [part for part in path.split(".") if part]


def _body_ref(path: str, root: str = "b") -> str:
    return root + "".join("[" + _cel_string(part) + "]" for part in _ref_parts(path))


def _merge_expr(path: str, value_cel: str) -> str:
    """Nested merge for a.b.0.c -> b.merge({"a": b["a"].merge({"b": b["a"]["b"].merge({"0": v})})}).

    CEL's map.merge takes a MAP argument (cel-functions.md), not a key/value
    pair, so the argument must be a map literal.
    """
    parts = _ref_parts(path)
    if not parts:
        return value_cel
    expr = value_cel
    for index in range(len(parts) - 1, 0, -1):
        holder = _body_ref(".".join(parts[:index]))
        expr = holder + ".merge({" + _cel_string(parts[index]) + ": " + expr + "})"
    return "b.merge({" + _cel_string(parts[0]) + ": " + expr + "})"


def _filter_expr(path: str) -> str:
    """Nested key filter for a.b -> b.merge({"a": b["a"].filterKeys(k, k != "b")})."""
    parts = _ref_parts(path)
    if not parts:
        return "b"
    if len(parts) == 1:
        return "b.filterKeys(k, k != " + _cel_string(parts[0]) + ")"
    expr = (
        _body_ref(".".join(parts[:-1]))
        + ".filterKeys(k, k != "
        + _cel_string(parts[-1])
        + ")"
    )
    for index in range(len(parts) - 2, 0, -1):
        holder = _body_ref(".".join(parts[:index]))
        expr = holder + ".merge({" + _cel_string(parts[index]) + ": " + expr + "})"
    return "b.merge({" + _cel_string(parts[0]) + ": " + expr + "})"


def _apply_body_rule(expr: str, rule: BodyRule) -> str:
    """One body row consumes the previous expression and returns the new one."""
    head = "toJson(json(" + expr + ").with(b, "
    if rule.op == "create":
        # write only when the field is missing: cel(...) ternary on the existing value
        ref = _body_ref(rule.path)
        guard = ref + " == null ? " + _cel_value(rule.value) + " : " + ref
        return head + _merge_expr(rule.path, guard) + "))"
    if rule.op == "update":
        ref = _body_ref(rule.path)
        guard = ref + " != null ? " + _cel_value(rule.value) + " : " + ref
        return head + _merge_expr(rule.path, guard) + "))"
    if rule.op == "delete":
        return head + _filter_expr(rule.path) + "))"
    if rule.op == "copy":
        return (
            head
            + _merge_expr(rule.target_path, _body_ref(rule.source_path))
            + "))"
        )
    if rule.op == "prepend":
        inner = _cel_string(rule.value) + " + " + _body_ref(rule.path)
        return head + _merge_expr(rule.path, inner) + "))"
    if rule.op == "append":
        inner = _body_ref(rule.path) + " + " + _cel_string(rule.value)
        return head + _merge_expr(rule.path, inner) + "))"
    if rule.op == "regex_replace":
        # CEL string extension: regexReplaceAll(string, regex, replacement).
        inner = (
            "regexReplaceAll("
            + _body_ref(rule.path)
            + ", "
            + _cel_string(rule.regex)
            + ", "
            + _cel_string(rule.replacement)
            + ")"
        )
        return head + _merge_expr(rule.path, inner) + "))"
    if rule.op == "to_upper":
        return head + _merge_expr(rule.path, _body_ref(rule.path) + ".upperAscii()") + "))"
    if rule.op == "to_lower":
        return head + _merge_expr(rule.path, _body_ref(rule.path) + ".lowerAscii()") + "))"
    raise ValueError("unhandled body op: " + rule.op)


def _body_expression(rules: tuple[BodyRule, ...], phase: str) -> str:
    """Compose body rows left-to-right; each row consumes the previous expression."""
    root = "request" if phase == "request" else "response"
    expr = root + ".body"
    for rule in rules:
        expr = _apply_body_rule(expr, rule)
    return expr


def _header_rule_ops(rule: HeaderRule, root: str) -> dict:
    """One header row -> AG add/set/remove maps (v2 §3) or a set-back string op."""
    set_map: dict = {}
    add_map: dict = {}
    remove_list: list[str] = []
    ref = root + ".headers[" + _cel_string(rule.name) + "]"
    if rule.op == "create":
        add_map[rule.name] = _cel_string(rule.value)
    elif rule.op == "update":
        set_map[rule.name] = _cel_string(rule.value)
    elif rule.op == "delete":
        remove_list.append(rule.name)
    elif rule.op == "copy":
        target = rule.target_name or rule.name
        add_map[target] = root + ".headers[" + _cel_string(rule.source_name) + "]"
    elif rule.op == "prepend":
        set_map[rule.name] = _cel_string(rule.value) + " + " + ref
    elif rule.op == "append":
        set_map[rule.name] = ref + " + " + _cel_string(rule.value)
    elif rule.op == "regex_replace":
        # Real regex replacement in CEL; a literal .replace() would only match
        # the exact pattern text, not the pattern as a regex.
        set_map[rule.name] = (
            "regexReplaceAll("
            + ref
            + ", "
            + _cel_string(rule.regex)
            + ", "
            + _cel_string(rule.replacement)
            + ")"
        )
    elif rule.op == "to_upper":
        set_map[rule.name] = ref + ".upperAscii()"
    elif rule.op == "to_lower":
        set_map[rule.name] = ref + ".lowerAscii()"
    else:
        raise ValueError("unhandled header op: " + rule.op)
    return {"set": set_map, "add": add_map, "remove": remove_list}


def _merge_header_ops(ops_list: list[dict]) -> dict:
    """Fold per-row op dicts into one add/set/remove triple preserving row order."""
    merged: dict = {}
    set_map: dict = {}
    add_map: dict = {}
    remove_list: list[str] = []
    for ops in ops_list:
        for key, value in ops["set"].items():
            set_map[key] = value
        for key, value in ops["add"].items():
            add_map[key] = value
        remove_list.extend(ops["remove"])
    if set_map:
        merged["set"] = set_map
    if add_map:
        merged["add"] = add_map
    if remove_list:
        merged["remove"] = remove_list
    return merged


def _condition_predicate(condition: RewriteCondition, segment: str) -> str:
    if segment.endswith("headers"):
        root = "request.headers" if segment.startswith("request") else "response.headers"
        left = root + "[" + _cel_string(condition.field) + "]"
    else:
        root = "request" if segment.startswith("request") else "response"
        if condition.field.startswith(root + "."):
            # Absolute CEL variable (e.g. response.code for the E9 error-body
            # guard), not a path into the JSON body.
            left = condition.field
        else:
            left = "json(" + root + ".body)"
            for part in _ref_parts(condition.field):
                left += "[" + _cel_string(part) + "]"
    if condition.mode == "full":
        return left + " == " + _cel_string(condition.value)
    if condition.mode == "regex":
        return left + ".matches(" + _cel_string(condition.value) + ")"
    operator = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[condition.mode]
    return "int(" + left + ") " + operator + " int(" + _cel_value(condition.value) + ")"


def _segment_rules(spec: TransformsSpec, segment: str) -> tuple:
    return {
        "request_headers": spec.request_headers,
        "response_headers": spec.response_headers,
        "request_body": spec.request_body,
        "response_body": spec.response_body,
    }[segment]


def compile_transforms(spec: TransformsSpec) -> dict:
    """Structured rules -> transformations dict; deterministic row-order emission."""
    out: dict = {}
    for phase in ("request", "response"):
        bucket: dict = {}
        header_rules = _segment_rules(spec, phase + "_headers")
        body_rules = _segment_rules(spec, phase + "_body")
        unconditional_headers = tuple(r for r in header_rules if not r.conditions)
        unconditional_body = tuple(r for r in body_rules if not r.conditions)
        if unconditional_headers:
            bucket.update(
                _merge_header_ops(
                    [_header_rule_ops(rule, phase) for rule in unconditional_headers]
                )
            )
        if unconditional_body:
            bucket["body"] = _body_expression(unconditional_body, phase)
        if bucket:
            out[phase] = bucket
    conditional: list[dict] = []
    for segment in ("request_headers", "request_body", "response_headers", "response_body"):
        for rule in _segment_rules(spec, segment):
            if not rule.conditions:
                continue
            predicate = " && ".join(_condition_predicate(c, segment) for c in rule.conditions)
            phase = "request" if segment.startswith("request") else "response"
            if segment.endswith("headers"):
                entry_ops: dict = _merge_header_ops([_header_rule_ops(rule, phase)])
            else:
                entry_ops = {"body": _body_expression((rule,), phase)}
            conditional.append({"predicate": predicate, phase: entry_ops})
    if conditional:
        out["conditional"] = conditional
    return out


def compile_warnings(spec: TransformsSpec) -> list[str]:
    """Human-readable notes for preview surfaces (E9-pending semantics)."""
    warnings: list[str] = []
    for segment in ("request_body", "response_body"):
        for rule in _segment_rules(spec, segment):
            if segment == "response_body":
                warnings.append(STREAM_NOTE + " [" + segment + " " + rule.path + "]")
    return warnings
