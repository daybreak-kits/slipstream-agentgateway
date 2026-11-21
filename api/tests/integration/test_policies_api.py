"""Ticket 11: editable policies/guardrails/MCP with explicit capability refusals.

Every write is validated through the same IR -> adapter pipeline as apply, so
these tests pin both the happy path (stored + rendered) and the refusal path
(422/409, nothing silently dropped).
"""

from __future__ import annotations

from sqlalchemy import select
from tests.conftest import seed_channel

from l04_repo.orm import ConfigRevisionORM


def _policy_body(**overrides) -> dict:
    return {"config": overrides}


def test_policies_get_exposes_editable_config_and_capabilities(client):
    response = client.get("/admin/policies")
    assert response.status_code == 200
    body = response.json()
    assert body["config"]["cors"]["enabled"] is False
    assert body["config"]["api_key"] == {"enabled": True, "mode": "strict"}
    assert body["config"]["retry"] is None
    assert body["config"]["health"] is None
    assert body["defaults"]["transformations"]["default_response_header_deletes"] == [
        "server",
        "x-powered-by",
    ]
    # M3 (ADR-024): retry renders as top-level route policy -> management surface
    # reopens; health marks + eviction are per-model configurable.
    assert body["capabilities"]["retry"]["supported"] is True
    assert body["capabilities"]["health"]["supported"] is True
    # ADR-028: attempt-chain observation is an adapter capability, not a policy.
    assert body["capabilities"]["request_attempts"]["supported"] is True
    assert body["capabilities"]["request_attempts"]["verified"] is True
    assert "tracing" not in body["effective"]
    # Default-off semantic: absent blocks mean the current behavior.
    assert body["effective"]["retry"] is None
    assert body["effective"]["health"] is None
    assert body["capabilities"]["guardrails_webhook"]["supported"] is True
    assert body["effective"]["key_auth"]["enabled"] is True
    assert body["counts"]["upstreams"] == 0
    assert body["updated_at_ms"] == 0


def test_put_policies_persists_and_previews_effective_data_plane(client):
    payload = _policy_body(
        cors={
            "enabled": True,
            "allow_origins": ["https://app.example"],
            "allow_credentials": False,
            "expose_headers": ["x-request-id"],
            "allow_methods": [],
            "allow_headers": [],
            "max_age": 600,
        },
        api_key={"enabled": False, "mode": "strict"},
        local_rate_limit={"requests_per_minute": 120, "tokens_per_minute": 5000},
        timeout={"request_timeout": "60s"},
    )
    response = client.put("/admin/policies", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["config"]["timeout"]["request_timeout"] == "60s"
    assert body["config"]["api_key"]["enabled"] is False
    assert body["effective"]["key_auth"]["enabled"] is False
    assert body["effective"]["timeout"]["request_timeout"] == "60s"
    assert body["effective"]["local_rate_limit"]["requests_per_minute"] == 120
    assert body["effective"]["cors"]["enabled"] is True
    assert body["updated_at_ms"] > 0

    again = client.get("/admin/policies").json()
    assert again["config"] == body["config"]


def test_put_policies_accepts_retry_with_health_pair(client):
    response = client.put(
        "/admin/policies",
        json=_policy_body(
            retry={"attempts": 2, "codes": [429, 500, 502, 503], "backoff": "100ms"},
            health={
                "unhealthy_expression": "response.code >= 400",
                "consecutive_failures": 1,
                "duration": "60s",
                "restore_health": 0,
            },
        ),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["config"]["retry"]["attempts"] == 2
    assert body["config"]["retry"]["codes"] == [429, 500, 502, 503]
    assert body["config"]["health"]["consecutive_failures"] == 1
    assert body["effective"]["retry"] == {
        "attempts": 2,
        "codes": [429, 500, 502, 503],
        "backoff": "100ms",
    }
    assert body["effective"]["health"]["unhealthy_expression"] == "response.code >= 400"
    assert client.get("/admin/policies").json()["config"] == body["config"]


def test_put_policies_rejects_4xx_retry_without_health(client):
    """ADR-024 pairing rule: 4xx codes alone never switch layers (E16/E17)."""
    response = client.put(
        "/admin/policies", json=_policy_body(retry={"attempts": 2, "codes": [401, 500]})
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    errors = body["details"]["errors"]
    assert any("4xx" in error and "health" in error for error in errors), errors


def test_put_policies_rejects_out_of_range_retry_codes(client):
    response = client.put(
        "/admin/policies", json=_policy_body(retry={"attempts": 2, "codes": [302, 500]})
    )
    assert response.status_code == 422
    assert "retry" in response.text


def test_put_policies_rejects_invalid_timeout(client):
    response = client.put(
        "/admin/policies", json=_policy_body(timeout={"request_timeout": "60"})
    )
    assert response.status_code == 422
    assert any("requestTimeout" in error for error in response.json()["details"]["errors"])


def test_put_policies_rejects_unknown_top_level_field(client):
    response = client.put("/admin/policies", json=_policy_body(retry_policy={}))
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_delete_policies_restores_defaults(client):
    client.put("/admin/policies", json=_policy_body(timeout={"request_timeout": "30s"}))
    response = client.delete("/admin/policies")
    assert response.status_code == 200
    body = response.json()
    assert body["config"]["timeout"]["request_timeout"] == ""
    assert body["updated_at_ms"] == 0


def test_customer_cannot_write_policies(client, login_cookies):
    response = client.put(
        "/admin/policies",
        json=_policy_body(timeout={"request_timeout": "30s"}),
        cookies=login_cookies("customer"),
    )
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"


def test_guardrails_put_regex_and_webhook_then_reset(client):
    payload = {
        "config": {
            "streaming": "Enabled",
            "request": [
                {
                    "kind": "regex",
                    "action": "mask",
                    "rules": [{"builtin": "ssn"}, {"pattern": "secret-[0-9]+"}],
                    "scope": ["messages"],
                    "rejection_status": 403,
                }
            ],
            "response": [
                {
                    "kind": "webhook",
                    "action": "reject",
                    "webhook_target": "https://audit.example",
                    "failure_mode": "failOpen",
                }
            ],
        }
    }
    response = client.put("/admin/guardrails", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["config"]["streaming"] == "Enabled"
    assert body["config"]["request"][0]["rules"][0]["builtin"] == "ssn"
    assert body["capabilities"]["webhook"]["supported"] is True

    reset = client.delete("/admin/guardrails")
    assert reset.status_code == 200
    assert reset.json()["config"] == {"streaming": "Disabled", "request": [], "response": []}


def test_guardrails_reject_webhook_target_path(client):
    response = client.put(
        "/admin/guardrails",
        json={
            "config": {
                "request": [
                    {
                        "kind": "webhook",
                        "action": "reject",
                        "webhook_target": "https://audit.example/check",
                    }
                ]
            }
        },
    )
    assert response.status_code == 422
    assert any("路径" in error for error in response.json()["details"]["errors"])


def test_guardrails_reject_unsupported_backend(client):
    response = client.put(
        "/admin/guardrails",
        json={"config": {"request": [{"kind": "openai_moderation", "action": "reject"}]}},
    )
    assert response.status_code == 422
    assert any("kind" in str(item) for item in response.json()["details"]["errors"])


def test_guardrails_reject_webhook_scope(client):
    response = client.put(
        "/admin/guardrails",
        json={
            "config": {
                "request": [
                    {
                        "kind": "webhook",
                        "action": "reject",
                        "webhook_target": "https://audit.example/check",
                        "scope": ["messages"],
                    }
                ]
            }
        },
    )
    assert response.status_code == 422
    assert any("scope" in error for error in response.json()["details"]["errors"])


def test_guardrails_reject_empty_regex_rules(client):
    response = client.put(
        "/admin/guardrails",
        json={"config": {"request": [{"kind": "regex", "action": "mask"}]}},
    )
    assert response.status_code == 422
    assert any("rules" in error for error in response.json()["details"]["errors"])


def test_mcp_server_crud_and_transport_capabilities(client):
    sse = client.post(
        "/admin/mcp-servers",
        json={"name": "search", "transport": "sse", "host": "https://mcp.example/sse"},
    )
    assert sse.status_code == 200, sse.text
    assert sse.json()["supported"] is True
    assert sse.json()["transports"]["http"]["supported"] is False

    stdio = client.post(
        "/admin/mcp-servers",
        json={
            "name": "fs",
            "transport": "stdio",
            "cmd": "npx",
            "args": ["-y", "server-filesystem"],
            "env": {"FOO": "bar"},
        },
    )
    assert stdio.status_code == 200, stdio.text
    assert [server["name"] for server in stdio.json()["servers"]] == ["search", "fs"]

    updated = client.put(
        "/admin/mcp-servers/search",
        json={"name": "search", "transport": "sse", "host": "https://mcp2.example/sse"},
    )
    assert updated.status_code == 200
    assert updated.json()["servers"][0]["host"] == "https://mcp2.example/sse"

    deleted = client.delete("/admin/mcp-servers/fs")
    assert deleted.status_code == 204
    remaining = client.get("/admin/mcp-servers").json()
    assert [server["name"] for server in remaining["servers"]] == ["search"]


def test_mcp_rejects_http_transport_explicitly(client):
    response = client.post(
        "/admin/mcp-servers",
        json={"name": "web", "transport": "http", "host": "https://mcp.example"},
    )
    assert response.status_code == 422
    assert any("http" in error for error in response.json()["details"]["errors"])


def test_mcp_rejects_duplicate_name(client):
    client.post(
        "/admin/mcp-servers",
        json={"name": "search", "transport": "sse", "host": "https://mcp.example/sse"},
    )
    response = client.post(
        "/admin/mcp-servers",
        json={"name": "search", "transport": "sse", "host": "https://other.example/sse"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "CONFLICT"


def test_mcp_stdio_requires_cmd(client):
    response = client.post(
        "/admin/mcp-servers", json={"name": "fs", "transport": "stdio"}
    )
    assert response.status_code == 422
    assert any("cmd" in error for error in response.json()["details"]["errors"])


def test_saved_config_flows_into_the_next_apply_revision(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    client.put(
        "/admin/policies",
        json=_policy_body(
            timeout={"request_timeout": "60s"},
            local_rate_limit={"requests_per_minute": 120},
            retry={"attempts": 2, "codes": [429, 500, 502, 503], "backoff": "100ms"},
            health={
                "unhealthy_expression": "response.code >= 400",
                "consecutive_failures": 1,
            },
        ),
    )
    client.put(
        "/admin/guardrails",
        json={
            "config": {
                "request": [
                    {
                        "kind": "regex",
                        "action": "mask",
                        "rules": [{"builtin": "ssn"}],
                    }
                ]
            }
        },
    )
    client.post(
        "/admin/mcp-servers",
        json={"name": "fs", "transport": "stdio", "cmd": "npx", "args": ["-y", "fs"]},
    )

    applied = client.post("/admin/config/apply", json={"reason": "ticket-11"})
    assert applied.status_code == 200, applied.text
    revision_id = applied.json()["id"]
    assert applied.json()["status"] == "active"

    with factory() as session:
        row = session.scalars(
            select(ConfigRevisionORM)
            .where(ConfigRevisionORM.status == "active")
            .order_by(ConfigRevisionORM.created_at_ms.desc())
        ).first()
        assert row is not None and row.id == revision_id
        artifact = row.artifact

    assert "requestTimeout: 60s" in artifact
    assert "localRateLimit:" in artifact
    # M3 render confirmation (ADR-024, E16/E17): retry is a TOP-LEVEL policies[]
    # entry targeting the implicit LLM route, and health is per rendered model.
    assert "internal/llm:request" in artifact
    assert "consecutiveFailures: 1" in artifact
    assert "unhealthyExpression:" in artifact
    assert "guardrails:" in artifact
    assert "builtin: ssn" in artifact
    assert "mcp:" in artifact
    assert "cmd: npx" in artifact

    status = client.get("/admin/config/status").json()
    assert status["active_revision"]["id"] == revision_id
