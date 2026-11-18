"""ADR-023 #6: upstream protocol auto-detection (service layer, no HTTP layer).

``_probe_request`` is module level exactly like ``fetch_models`` so these tests
swap it out and never touch the network.
"""

from __future__ import annotations

import pytest

from l05_service import upstream_ops


def _install(monkeypatch, routes):
    """routes: callable(method, url, headers, json_body) -> (status, payload, latency)."""
    calls: list[tuple[str, str, dict, dict | None]] = []

    def fake(method, url, *, headers, json_body=None, timeout_s=8.0):
        calls.append((method, url, dict(headers), json_body))
        return routes(method, url, dict(headers), json_body)

    monkeypatch.setattr(upstream_ops, "_probe_request", fake)
    return calls


def _hit_openai_models(method, url, headers, body):
    return 200, {"data": [{"id": "gpt-x"}, {"id": "deepseek-v3"}]}, 5


def test_openai_responses_wins_when_responses_probe_is_accepted(monkeypatch):
    def routes(method, url, headers, body):
        if url.endswith("/models"):
            return 200, {"data": [{"id": "gpt-x"}]}, 5
        return 200, {"id": "resp_1"}, 9

    calls = _install(monkeypatch, routes)
    result = upstream_ops.detect_api_style(base_url="https://api.example/v1", api_key="sk-1")
    assert result["protocol"] == "openai_responses"
    assert result["models"] == ["gpt-x"]
    # step 1 is the openai /models hit, step 2 the minimal POST /responses probe
    assert [step["protocol"] for step in result["steps"]] == [
        "openai_chat",
        "openai_responses",
    ]
    assert result["steps"][1]["method"] == "POST"
    assert all(step["ok"] for step in result["steps"])
    # the probe body must be minimal and bounded
    assert calls[1][3] == {
        "model": "gpt-x",
        "input": "ping",
        "max_output_tokens": upstream_ops.RESPONSES_PROBE_MAX_TOKENS,
    }


def test_openai_chat_wins_when_responses_endpoint_is_missing(monkeypatch):
    def routes(method, url, headers, body):
        if url.endswith("/models"):
            return 200, {"data": [{"id": "gpt-x"}]}, 5
        return 404, {"error": "not found"}, 3

    _install(monkeypatch, routes)
    result = upstream_ops.detect_api_style(base_url="https://api.example/v1", api_key="sk-1")
    assert result["protocol"] == "openai_chat"
    assert result["steps"][-1]["protocol"] == "openai_responses"
    assert "openai_chat" in result["steps"][-1]["detail"]


def test_anthropic_hit_after_openai_miss(monkeypatch):
    def routes(method, url, headers, body):
        if "x-api-key" in headers:
            return 200, {"data": [{"id": "claude-x"}]}, 4
        return 401, None, 2

    calls = _install(monkeypatch, routes)
    result = upstream_ops.detect_api_style(base_url="https://api.example/v1", api_key="sk-1")
    assert result["protocol"] == "anthropic_messages"
    assert result["models"] == ["claude-x"]
    # anthropic auth headers carry the version header and the key, never Bearer
    anthropic_call = next(call for call in calls if "x-api-key" in call[2])
    assert anthropic_call[2]["anthropic-version"] == "2023-06-01"
    assert anthropic_call[2]["x-api-key"] == "sk-1"
    assert "Authorization" not in anthropic_call[2]


def test_gemini_hit_last_with_v1beta_path(monkeypatch):
    def routes(method, url, headers, body):
        if "x-goog-api-key" in headers:
            return 200, {"models": [{"name": "models/gemini-2.5"}]}, 6
        return 401, None, 2

    _install(monkeypatch, routes)
    result = upstream_ops.detect_api_style(
        base_url="https://generativelanguage.example", api_key="g-key"
    )
    assert result["protocol"] == "gemini"
    # a base without a version segment tries the canonical /v1beta/models first
    gemini_steps = [step for step in result["steps"] if step["protocol"] == "gemini"]
    assert gemini_steps[0]["url"] == "https://generativelanguage.example/v1beta/models"
    assert gemini_steps[0]["ok"] is True
    assert result["models"] == ["gemini-2.5"]


def test_all_protocols_miss_produces_per_protocol_failure_lines(monkeypatch):
    _install(monkeypatch, lambda m, u, h, b: (401, None, 2))
    result = upstream_ops.detect_api_style(base_url="https://api.example/v1", api_key="sk-1")
    assert result["protocol"] is None
    assert result["models"] == []
    message = result["message"]
    for protocol in ("openai_chat", "openai_responses", "anthropic_messages", "gemini"):
        assert f"{protocol}:" in message
    assert "HTTP 401" in message
    # responses is only attempted after an openai /models hit, so it was skipped
    assert "openai_responses: 未尝试" in message
    assert len(result["steps"]) == 3  # one /models attempt per auth family


def test_2xx_without_expected_shape_is_not_a_hit(monkeypatch):
    """A 2xx body without the expected array must not be mistaken for a match."""
    _install(monkeypatch, lambda m, u, h, b: (200, {"note": "hello"}, 1))
    result = upstream_ops.detect_api_style(base_url="https://api.example/v1", api_key="sk-1")
    assert result["protocol"] is None
    assert all("缺少" in step["detail"] for step in result["steps"])


def test_network_errors_are_recorded_not_raised(monkeypatch):
    import httpx

    def boom(method, url, headers, body):
        raise httpx.ConnectTimeout("timed out")

    _install(monkeypatch, boom)
    result = upstream_ops.detect_api_style(base_url="https://api.example/v1", api_key="sk-1")
    assert result["protocol"] is None
    assert all("连接失败" in step["detail"] for step in result["steps"])


def test_base_url_without_version_segment_tries_v1_first_then_plain(monkeypatch):
    seen_urls: list[str] = []

    def routes(method, url, headers, body):
        seen_urls.append(url)
        return 404, None, 1

    _install(monkeypatch, routes)
    upstream_ops.detect_api_style(base_url="https://api.example", api_key="sk-1")
    assert seen_urls[0] == "https://api.example/v1/models"
    assert "https://api.example/models" in seen_urls

    seen_urls.clear()
    upstream_ops.detect_api_style(base_url="https://api.example/v1", api_key="sk-1")
    assert seen_urls[0] == "https://api.example/v1/models"  # no duplicate /v1/v1/models


def test_pinned_base_url_skips_the_responses_disambiguation(monkeypatch):
    calls = _install(monkeypatch, lambda m, u, h, b: (200, {"data": [{"id": "gpt-x"}]}, 1))
    result = upstream_ops.detect_api_style(
        base_url="https://api.example/v1/models#", api_key="sk-1"
    )
    assert result["protocol"] == "openai_chat"
    # only the models GET goes out; the /responses probe cannot be derived from
    # a pinned endpoint, so it is recorded as skipped, not attempted
    assert len(calls) == 1
    assert result["steps"][-1]["protocol"] == "openai_responses"
    assert "锁定" in result["steps"][-1]["detail"]


@pytest.mark.parametrize(
    ("base_url", "expected"),
    [
        ("https://api.example/v1", ["https://api.example/v1/models"]),
        ("https://api.example/v1beta", ["https://api.example/v1beta/models"]),
        (
            "https://api.example",
            ["https://api.example/v1/models", "https://api.example/models"],
        ),
        ("https://api.example/v1/models#", ["https://api.example/v1/models"]),
    ],
)
def test_models_url_candidates(base_url, expected):
    assert upstream_ops._models_urls(base_url) == expected


def test_detection_steps_carry_order_status_latency(monkeypatch):
    _install(monkeypatch, lambda m, u, h, b: (401, None, 7))
    result = upstream_ops.detect_api_style(base_url="https://api.example/v1", api_key="sk-1")
    for order, step in enumerate(result["steps"], start=1):
        assert step["order"] == order
        assert step["http_status"] == 401
        assert step["latency_ms"] == 7
        assert step["ok"] is False
