"""Every v2 verb compiles (task-164/ADR-009) plus determinism invariant (4.5)."""

from __future__ import annotations

import json

from l02_domain.transforms_codec import parse_transforms
from l03_adapters.agentgateway.transforms import compile_transforms, compile_warnings


def _compile(payload: dict) -> dict:
    return compile_transforms(parse_transforms(payload))


def test_header_create_adds_without_overwrite():
    out = _compile({"request_headers": [{"op": "create", "name": "x-trace", "value": "slip"}]})
    assert out["request"]["add"] == {"x-trace": '"slip"'}


def test_header_update_sets():
    out = _compile({"request_headers": [{"op": "update", "name": "x-trace", "value": "slip"}]})
    assert out["request"]["set"] == {"x-trace": '"slip"'}


def test_header_delete_removes():
    out = _compile({"request_headers": [{"op": "delete", "name": "x-trace"}]})
    assert out["request"]["remove"] == ["x-trace"]


def test_header_copy_reads_source_header():
    out = _compile(
        {"request_headers": [{"op": "copy", "name": "x-new", "source_name": "x-old"}]}
    )
    assert out["request"]["add"] == {"x-new": 'request.headers["x-old"]'}


def test_header_prepend_and_append():
    out = _compile(
        {"request_headers": [
            {"op": "prepend", "name": "x-a", "value": "v-"},
            {"op": "append", "name": "x-b", "value": "-w"},
        ]}
    )
    assert out["request"]["set"] == {
        "x-a": '"v-" + request.headers["x-a"]',
        "x-b": 'request.headers["x-b"] + "-w"',
    }


def test_header_regex_and_case_ops():
    out = _compile(
        {"response_headers": [
            {"op": "regex_replace", "name": "x-q", "regex": "a+", "replacement": " "},
            {"op": "to_upper", "name": "x-t"},
            {"op": "to_lower", "name": "x-l"},
        ]}
    )
    assert out["response"]["set"] == {
        "x-q": 'regexReplaceAll(response.headers["x-q"], "a+", " ")',
        "x-t": 'response.headers["x-t"].upperAscii()',
        "x-l": 'response.headers["x-l"].lowerAscii()',
    }
    assert ".replace(" not in json.dumps(out)


def test_body_create_nested_path_guards_existing():
    out = _compile({"request_body": [{"op": "create", "path": "metadata.trace", "value": "t1"}]})
    expr = out["request"]["body"]
    assert expr.startswith("toJson(json(request.body).with(b, ")
    assert 'b.merge({"metadata": b["metadata"].merge({"trace":' in expr
    assert 'b["metadata"]["trace"] == null ? "t1" : b["metadata"]["trace"]' in expr


def test_body_update_number_value():
    out = _compile({"request_body": [{"op": "update", "path": "temperature", "value": "0.2"}]})
    assert out["request"]["body"] == (
        "toJson(json(request.body).with(b, "
        'b.merge({"temperature": b["temperature"] != null ? 0.2 : b["temperature"]})))'
    )


def test_body_delete_top_level_and_nested():
    out = _compile(
        {"request_body": [
            {"op": "delete", "path": "seed"},
            {"op": "delete", "path": "metadata.seed"},
        ]}
    )
    expr = out["request"]["body"]
    assert 'b.filterKeys(k, k != "seed")' in expr
    assert 'b["metadata"].filterKeys(k, k != "seed")' in expr


def test_body_copy():
    # source_path "model" is forbidden (ADR-010 action 3), so copy from a safe field.
    out = _compile(
        {"request_body": [{"op": "copy", "source_path": "prompt", "target_path": "meta.src"}]}
    )
    assert 'b.merge({"meta": b["meta"].merge({"src": b["prompt"]})})' in out["request"]["body"]


def test_body_prepend_and_append():
    out = _compile(
        {"request_body": [
            {"op": "prepend", "path": "prefix_me", "value": "pre-"},
            {"op": "append", "path": "suffix_me", "value": "-post"},
        ]}
    )
    assert '"pre-" + b["prefix_me"]' in out["request"]["body"]
    assert 'b["suffix_me"] + "-post"' in out["request"]["body"]


def test_body_regex_replace_and_case_ops():
    out = _compile(
        {"request_body": [
            {"op": "regex_replace", "path": "q", "regex": "a+", "replacement": " "},
            {"op": "to_upper", "path": "tag"},
            {"op": "to_lower", "path": "lang"},
        ]}
    )
    expr = out["request"]["body"]
    assert 'regexReplaceAll(b["q"], "a+", " ")' in expr
    assert ".replace(" not in expr
    assert 'b["tag"].upperAscii()' in expr
    assert 'b["lang"].lowerAscii()' in expr


def test_conditional_row_predicate():
    payload = {
        "request_body": [
            {"op": "update", "path": "temperature", "value": "0.2",
             "conditions": [{"field": "model", "mode": "full", "value": "glm-5.3"}]}
        ]
    }
    out = _compile(payload)
    assert out["conditional"][0]["predicate"] == 'json(request.body)["model"] == "glm-5.3"'
    assert "request" not in out  # conditional-only rows produce no fallback bucket


def test_body_rules_chain_compose():
    payload = {"request_body": [
        {"op": "update", "path": "temperature", "value": "0.2"},
        {"op": "update", "path": "max_tokens", "value": "2048"},
    ]}
    expr = _compile(payload)["request"]["body"]
    # second row consumes the first row's whole expression
    assert expr.count("toJson(json(") == 2
    assert expr.index("max_tokens") > expr.index("temperature")


def test_compile_is_deterministic_and_regex_has_no_gap_warning():
    payload = {
        "request_headers": [{"op": "update", "name": "x-a", "value": "1"}],
        "request_body": [
            {"op": "regex_replace", "path": "t", "regex": "a", "replacement": "b"}
        ],
    }
    once = json.dumps(_compile(payload))
    assert once == json.dumps(_compile(payload))
    # regex_replace is a real CEL call now: no "pending E9" warning, no literal replace.
    compiled = json.dumps(_compile(payload))
    assert "regexReplaceAll" in compiled
    assert ".replace(" not in compiled
    notes = compile_warnings(parse_transforms(payload))
    assert notes == []
