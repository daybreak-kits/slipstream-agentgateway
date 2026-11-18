"""Storage codec invariants (v2 verbs, ADR-009): protected headers, fallback-last,
unknown op/mode rejection, body model/stream allowed (W2), roundtrip."""

from __future__ import annotations

import pytest

from l01_core.errors import AppError
from l02_domain.transforms_codec import (
    parse_transforms,
    transforms_from_json,
    transforms_to_json,
)


def test_protected_header_update_rejected():
    payload = {"request_headers": [{"op": "update", "name": "Authorization", "value": "x"}]}
    with pytest.raises(AppError) as excinfo:
        parse_transforms(payload)
    assert "authorization" in excinfo.value.message.lower()


def test_protected_header_copy_target_rejected():
    payload = {
        "request_headers": [
            {"op": "copy", "name": "x-trace", "source_name": "x-src", "target_name": "Host"}
        ]
    }
    with pytest.raises(AppError) as excinfo:
        parse_transforms(payload)
    assert "protected" in excinfo.value.message.lower()


def test_rename_expansion_is_copy_then_delete_rows():
    parsed = parse_transforms(
        {
            "request_headers": [
                {"op": "copy", "name": "x-old", "source_name": "x-old", "target_name": "x-new"},
                {"op": "delete", "name": "x-old"},
            ]
        }
    )
    assert [rule.op for rule in parsed.request_headers] == ["copy", "delete"]


def test_header_copy_without_source_rejected():
    payload = {"request_headers": [{"op": "copy", "name": "x-a", "target_name": "x-b"}]}
    with pytest.raises(AppError) as excinfo:
        parse_transforms(payload)
    assert "source_name" in excinfo.value.message


def test_conditional_after_fallback_rejected():
    payload = {
        "request_headers": [
            {"op": "update", "name": "x-a", "value": "1"},
            {
                "op": "update",
                "name": "x-b",
                "value": "2",
                "conditions": [{"field": "model", "mode": "full", "value": "glm-5.3"}],
            },
        ]
    }
    with pytest.raises(AppError) as excinfo:
        parse_transforms(payload)
    assert "fallback" in excinfo.value.message.lower()


def test_unknown_op_rejected():
    with pytest.raises(AppError):
        parse_transforms({"request_body": [{"op": "explode", "path": "a"}]})


def test_removed_verbs_rejected():
    for op in ("set", "add", "remove", "rename"):
        with pytest.raises(AppError):
            parse_transforms({"request_headers": [{"op": op, "name": "x-a", "value": "1"}]})


def test_unknown_condition_mode_rejected():
    payload = {
        "request_body": [
            {
                "op": "update",
                "path": "temperature",
                "value": "0.2",
                "conditions": [{"field": "model", "mode": "approx", "value": "x"}],
            }
        ]
    }
    with pytest.raises(AppError):
        parse_transforms(payload)


def test_body_model_stream_paths_allowed():
    # W2 (user decision): body rules may rewrite ANY path including model/stream;
    # the consequence is the administrator's, so the codec no longer rejects it.
    for path in ("model", "model.id", "stream", "stream.options"):
        parsed = parse_transforms({"request_body": [{"op": "update", "path": path, "value": "x"}]})
        assert parsed.request_body[0].path == path


def test_roundtrip_json_stable():
    payload = {
        "request_headers": [{"op": "update", "name": "x-trace", "value": "slipstream"}],
        "request_body": [
            {
                "op": "update",
                "path": "temperature",
                "value": "0.2",
                "conditions": [{"field": "model", "mode": "full", "value": "glm-5.3"}],
            },
            {"op": "create", "path": "metadata.trace", "value": "t1"},
        ],
        "response_headers": [{"op": "append", "name": "x-served-by", "value": "/slipstream"}],
    }
    raw = transforms_to_json(parse_transforms(payload))
    spec = transforms_from_json(raw)
    assert raw == transforms_to_json(spec)
    assert transforms_from_json("") is None
    assert transforms_from_json("{}") is None
