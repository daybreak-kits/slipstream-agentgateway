"""W8 ticket 05: transform sample replay through the adapter SPI port.

Seam: AgentgatewayAdapter.replay_transform_sample (SPI, ADR-029). The replay
semantics live in the adapter layer; the system layer keeps no implementation.
The result is the neutral before/after snapshot plus field-level diffs, replayed
from the same IR the compiler consumes. No network, no persistence.
"""

from __future__ import annotations

import pytest

from l02_domain.transforms_codec import parse_transforms
from l03_adapters.agentgateway.adapter import AgentgatewayAdapter


@pytest.fixture()
def adapter(tmp_path) -> AgentgatewayAdapter:
    """Real driver, hermetic config dir, validator gate disabled (unit scope)."""
    return AgentgatewayAdapter(config_dir=str(tmp_path), ag_binary="")


def run(
    adapter: AgentgatewayAdapter,
    rules: dict,
    request: dict | None = None,
    response: dict | None = None,
) -> dict:
    result = adapter.replay_transform_sample(
        parse_transforms(rules),
        request=request,
        response=response,
    )
    return {"before": result.before, "after": result.after, "diff": list(result.diff)}


def test_header_verbs_apply_to_the_request_headers_snapshot(adapter):
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
    result = run(adapter, rules, request=request)

    # 行序即应用顺序：先 update 成 slip，再 prepend/append 包住当前值。
    assert result["after"]["request"]["headers"] == {
        "x-trace": "pre-slip-suf",
        "x-new": "n",
        "x-up": "LOW",
    }
    assert result["after"]["request"]["body"] == {"model": "glm-5.3"}
    paths = {(item["segment"], item["path"], item["op"]) for item in result["diff"]}
    assert ("request_headers", "x-trace", "update") in paths
    assert ("request_headers", "x-new", "create") in paths
    assert ("request_headers", "x-up", "to_upper") in paths
    assert ("request_headers", "x-gone", "delete") in paths


def test_header_update_only_overwrites_an_existing_header(adapter):
    """Contract v2: update = 存在才覆盖，不存在保持不变（样例不臆造新头）。"""
    rules = {"request_headers": [{"op": "update", "name": "x-missing", "value": "v"}]}
    result = run(adapter, rules, request={"headers": {"x-other": "1"}})
    assert result["after"]["request"]["headers"] == {"x-other": "1"}
    assert result["diff"] == []


def test_header_copy_uses_source_name_and_never_writes_a_noop_diff(adapter):
    rules = {
        "request_headers": [
            {"op": "copy", "name": "x-copy", "source_name": "x-src"},
            {"op": "copy", "name": "x-missing", "source_name": "x-not-there"},
            {"op": "regex_replace", "name": "x-re", "regex": "o+", "replacement": "0"},
        ],
    }
    result = run(adapter, rules, request={"headers": {"x-src": "v", "x-re": "foo"}})
    assert result["after"]["request"]["headers"] == {"x-src": "v", "x-copy": "v", "x-re": "f0"}
    assert [item["path"] for item in result["diff"]] == ["x-copy", "x-re"]


def test_body_verbs_apply_to_the_json_body_with_typed_values(adapter):
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
    result = run(adapter, rules, request=request)

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


def test_body_update_guard_keeps_missing_fields_untouched(adapter):
    rules = {"request_body": [{"op": "update", "path": "missing", "value": "1"}]}
    result = run(adapter, rules, request={"headers": {}, "body": {}})
    assert result["after"]["request"]["body"] == {}
    assert result["diff"] == []


def test_body_update_skips_a_json_null_field(adapter):
    """The compiler guard treats an explicit null as empty, so update is a no-op."""
    rules = {"request_body": [{"op": "update", "path": "temperature", "value": "0.2"}]}
    result = run(adapter, rules, request={"headers": {}, "body": {"temperature": None}})
    assert result["after"]["request"]["body"] == {"temperature": None}
    assert result["diff"] == []


def test_body_copy_with_a_missing_source_writes_nothing(adapter):
    """B4: a missing copy source must not fabricate a null target."""
    rules = {"request_body": [{"op": "copy", "source_path": "absent", "target_path": "target"}]}
    result = run(adapter, rules, request={"headers": {}, "body": {"keep": 1}})
    assert result["after"]["request"]["body"] == {"keep": 1}
    assert result["diff"] == []


def test_string_ops_on_missing_or_non_string_values_are_skipped_not_crashed(adapter):
    rules = {
        "request_body": [
            {"op": "prepend", "path": "absent", "value": "x"},
            {"op": "to_upper", "path": "n", "value": ""},
        ]
    }
    result = run(adapter, rules, request={"headers": {}, "body": {"n": 3}})
    assert result["after"]["request"]["body"] == {"n": 3}
    assert result["diff"] == []


def test_conditions_gate_rows_per_segment_and_phase(adapter):
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
        adapter,
        rules,
        request={
            "headers": {"x-route": "chat", "x-model": "old"},
            "body": {"model": "glm-5.3", "temperature": 0.9},
        },
        response={"headers": {}, "body": {"usage": {"prompt_tokens": 12}}},
    )

    # 头 update 遵循编译语义「存在才覆盖」，所以样例里先放一个旧值。
    assert result["after"]["request"]["headers"]["x-model"] == "glm-5.3"
    assert result["after"]["request"]["headers"]["x-route"] == "chat"
    assert result["after"]["request"]["body"] == {"model": "glm-5.3", "temperature": 0.1}
    assert result["after"]["response"]["body"] == {"usage": {"prompt_tokens": 1}}


def test_conditions_with_an_unavailable_absolute_variable_never_match(adapter):
    rules = {
        "response_body": [
            {"op": "update", "path": "error.message", "value": "masked",
             "conditions": [{"field": "response.code", "mode": "lt", "value": "400"}]},
        ],
    }
    result = run(adapter, rules, response={"headers": {}, "body": {"error": {"message": "raw"}}})
    assert result["after"]["response"]["body"] == {"error": {"message": "raw"}}
    assert result["diff"] == []


def test_before_snapshot_is_untouched_and_no_rules_is_a_noop(adapter):
    request = {"headers": {"x-a": "1"}, "body": {"a": 1}}
    result = run(adapter, {"request_headers": []}, request=request)
    assert result["before"] == {"request": request, "response": {"headers": {}, "body": None}}
    assert result["after"] == result["before"]
    assert request == {"headers": {"x-a": "1"}, "body": {"a": 1}}
    assert result["diff"] == []


def test_diff_entries_carry_segment_kind_path_op_and_values(adapter):
    result = run(
        adapter,
        {"response_headers": [{"op": "update", "name": "x-out", "value": "1"}]},
        response={"headers": {"x-out": "0"}},
    )
    assert result["diff"] == [
        {
            "segment": "response_headers",
            "kind": "header",
            "path": "x-out",
            "op": "update",
            "before": "0",
            "after": "1",
        },
    ]
