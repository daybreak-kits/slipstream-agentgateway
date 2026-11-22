"""Ticket 05: transform sample simulation reuses the storage codec (parse_transforms).

Seam: l02_domain.transforms_sample.apply_sample_transforms - the same IR the compiler
consumes, applied to pasted request/response snapshots in memory. No adapter, no network,
no persistence; the result is only a before/after snapshot plus field-level diffs.
"""

from __future__ import annotations

from l02_domain.transforms_codec import parse_transforms
from l02_domain.transforms_sample import apply_sample_transforms


def run(rules: dict, request: dict | None = None, response: dict | None = None) -> dict:
    return apply_sample_transforms(
        parse_transforms(rules),
        request=request,
        response=response,
    )


def test_header_verbs_apply_to_the_request_headers_snapshot():
    rules = {
        "request_headers": [
            {"op": "update", "name": "x-trace", "value": "slip"},
            {"op": "create", "name": "x-new", "value": "n"},
            {"op": "create", "name": "x-trace", "value": "ignored"},
            {"op": "prepend", "name": "x-trace", "value": "pre-"},
            {"op": "append", "name": "x-trace", "value": "-suf"},
            {"op": "to_upper", "name": "x-up", "value": ""},
            {"op": "delete", "name": "x-gone", "value": ""},
        ],
    }
    request = {
        "headers": {"X-Trace": "old", "X-Up": "low", "X-Gone": "bye"},
        "body": {"model": "glm-5.3"},
    }
    result = run(rules, request=request)

    # 行序即应用顺序：先 update 成 slip，再 prepend/append 包住当前值。
    assert result["after"]["request"]["headers"] == {"x-trace": "pre-slip-suf", "x-new": "n", "x-up": "LOW"}
    assert result["after"]["request"]["body"] == {"model": "glm-5.3"}
    paths = {(item["segment"], item["path"], item["op"]) for item in result["diff"]}
    assert ("request_headers", "x-trace", "update") in paths
    assert ("request_headers", "x-new", "create") in paths
    assert ("request_headers", "x-up", "to_upper") in paths
    assert ("request_headers", "x-gone", "delete") in paths


def test_header_copy_uses_source_name_and_never_writes_a_noop_diff():
    rules = {
        "request_headers": [
            {"op": "copy", "name": "x-copy", "source_name": "x-src"},
            {"op": "copy", "name": "x-missing", "source_name": "x-not-there"},
            {"op": "regex_replace", "name": "x-re", "regex": "o+", "replacement": "0"},
        ],
    }
    result = run(rules, request={"headers": {"x-src": "v", "x-re": "foo"}})
    assert result["after"]["request"]["headers"] == {"x-src": "v", "x-copy": "v", "x-re": "f0"}
    assert [item["path"] for item in result["diff"]] == ["x-copy", "x-re"]


def test_body_verbs_apply_to_the_json_body_with_typed_values():
    rules = {
        "request_body": [
            {"op": "update", "path": "temperature", "value": "0.2"},
            {"op": "create", "path": "meta.created", "value": "true"},
            {"op": "delete", "path": "meta.drop", "value": ""},
            {"op": "copy", "source_path": "temperature", "target_path": "top_p"},
            {"op": "append", "path": "user", "value": "-x"},
        ],
    }
    request = {"headers": {}, "body": {"temperature": 0.9, "meta": {"drop": 1}, "user": "u"}}
    result = run(rules, request=request)

    assert result["after"]["request"]["body"] == {
        "temperature": 0.2,
        "meta": {"created": True},
        "top_p": 0.2,
        "user": "u-x",
    }
    diff = {item["path"]: (item["before"], item["after"]) for item in result["diff"]}
    assert diff["temperature"] == (0.9, 0.2)
    assert diff["meta.created"] == (None, True)
    assert diff["meta.drop"] == (1, None)
    assert diff["top_p"] == (None, 0.2)


def test_body_update_guard_keeps_missing_fields_untouched():
    rules = {"request_body": [{"op": "update", "path": "missing", "value": "1"}]}
    result = run(rules, request={"headers": {}, "body": {}})
    assert result["after"]["request"]["body"] == {}
    assert result["diff"] == []


def test_string_ops_on_missing_or_non_string_values_are_skipped_not_crashed():
    rules = {
        "request_body": [
            {"op": "prepend", "path": "absent", "value": "x"},
            {"op": "to_upper", "path": "n", "value": ""},
        ]
    }
    result = run(rules, request={"headers": {}, "body": {"n": 3}})
    assert result["after"]["request"]["body"] == {"n": 3}
    assert result["diff"] == []


def test_conditions_gate_rows_per_segment_and_phase():
    rules = {
        "request_headers": [
            {"op": "update", "name": "x-model", "value": "glm-5.3",
             "conditions": [{"field": "x-route", "mode": "full", "value": "chat"}]},
        ],
        "request_body": [
            {"op": "update", "path": "temperature", "value": "0.1",
             "conditions": [{"field": "model", "mode": "full", "value": "glm-5.3"}]},
            {"op": "update", "path": "top_p", "value": "0.5",
             "conditions": [{"field": "missing.path", "mode": "full", "value": "x"}]},
        ],
        "response_body": [
            {"op": "update", "path": "usage.prompt_tokens", "value": "1",
             "conditions": [{"field": "usage.prompt_tokens", "mode": "gt", "value": "10"}]},
        ],
    }
    result = run(
        rules,
        request={"headers": {"x-route": "chat"}, "body": {"model": "glm-5.3", "temperature": 0.9}},
        response={"headers": {}, "body": {"usage": {"prompt_tokens": 12}}},
    )

    assert result["after"]["request"]["headers"]["x-model"] == "glm-5.3"
    assert result["after"]["request"]["body"] == {"model": "glm-5.3", "temperature": 0.1}
    assert result["after"]["response"]["body"] == {"usage": {"prompt_tokens": 1}}


def test_conditions_with_an_unavailable_absolute_variable_never_match():
    rules = {
        "response_body": [
            {"op": "update", "path": "error.message", "value": "masked",
             "conditions": [{"field": "response.code", "mode": "lt", "value": "400"}]},
        ],
    }
    result = run(rules, response={"headers": {}, "body": {"error": {"message": "raw"}}})
    assert result["after"]["response"]["body"] == {"error": {"message": "raw"}}
    assert result["diff"] == []


def test_before_snapshot_is_untouched_and_no_rules_is_a_noop():
    request = {"headers": {"x-a": "1"}, "body": {"a": 1}}
    result = run({"request_headers": []}, request=request)
    assert result["before"] == {"request": request, "response": {"headers": {}, "body": None}}
    assert result["after"] == result["before"]
    assert request == {"headers": {"x-a": "1"}, "body": {"a": 1}}
    assert result["diff"] == []


def test_diff_entries_carry_segment_kind_path_op_and_values():
    result = run(
        {"response_headers": [{"op": "update", "name": "x-out", "value": "1"}]},
        response={"headers": {"x-out": "0"}},
    )
    assert result["diff"] == [
        {"segment": "response_headers", "kind": "header", "path": "x-out", "op": "update", "before": "0", "after": "1"},
    ]
