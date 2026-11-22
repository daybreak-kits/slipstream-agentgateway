"""Playground 请求参数单表（W5 票05）：Pydantic schema 与 relay body 同源。

票05 把「允许参数 / 默认值 / 转发序列化」收进 PLAYGROUND_PARAMS 一张表；
这里钉住表与请求模型、relay body 的一致性，新增字段只改表一行即可。
"""

from __future__ import annotations

from typing import Any

from l06_api.playground import (
    PLAYGROUND_PARAMS,
    REGISTERED_OUTPUT_CAP_FIELDS,
    RELAY_OWNED_KEYS,
    PlaygroundRequest,
    relay_body,
)


def _payload(**overrides: Any) -> PlaygroundRequest:
    values: dict[str, Any] = {
        "model": "demo-model",
        "messages": [{"role": "user", "content": "hi"}],
    }
    values.update(overrides)
    return PlaygroundRequest(**values)


def test_request_model_is_built_from_the_single_table() -> None:
    assert tuple(PlaygroundRequest.model_fields) == tuple(param.name for param in PLAYGROUND_PARAMS)


def test_relay_body_carries_every_relay_row_and_nothing_else() -> None:
    payload = _payload(
        temperature=0.5,
        top_p=0.9,
        top_k=5,
        frequency_penalty=0.1,
        presence_penalty=-0.1,
        seed=7,
        max_tokens=16,
        max_completion_tokens=32,
        stop=["END", "DONE"],
        n=2,
        response_format={"type": "json_object"},
        logprobs=True,
        top_logprobs=3,
        user="u-1",
        reasoning_effort="xhigh",
        extra_fields={"vendor_x": 1},
    )
    body = relay_body(payload)

    relayed = {param.name for param in PLAYGROUND_PARAMS if param.relay}
    assert relayed <= set(body)
    assert "extra_fields" not in body
    assert body["response_format"] == {"type": "json_object"}
    assert body["reasoning_effort"] == "xhigh"
    assert body["vendor_x"] == 1
    assert body["stream"] is True
    assert body["messages"] == [{"role": "user", "content": "hi"}]


def test_unset_values_and_reasoning_default_never_reach_the_body() -> None:
    body = relay_body(_payload(reasoning_effort="default"))
    assert body == {
        "model": "demo-model",
        "stream": True,
        "messages": [{"role": "user", "content": "hi"}],
    }


def test_extra_fields_merge_first_and_cannot_override_reserved_or_standard_keys() -> None:
    body = relay_body(
        _payload(
            temperature=0.5,
            extra_fields={
                "temperature": 1.5,
                "stream": False,
                "model": "shadow",
                "messages": [],
                "stream_options": {"include_usage": True},
                "vendor_y": 2,
            },
        )
    )
    assert body["temperature"] == 0.5
    assert body["stream"] is True
    assert body["model"] == "demo-model"
    assert body["messages"] == [{"role": "user", "content": "hi"}]
    assert "stream_options" not in body
    assert body["vendor_y"] == 2


def test_registered_output_cap_and_reserved_keys_come_from_the_table() -> None:
    assert REGISTERED_OUTPUT_CAP_FIELDS == ("max_tokens", "max_completion_tokens")
    assert RELAY_OWNED_KEYS == frozenset({"model", "messages", "stream", "stream_options"})
