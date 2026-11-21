"""W6 ticket 04: connection, health and playground consume the client contract.

Seam: HTTP admin API. The system endpoints must return byte-stable, user-visible
shapes while every data-plane fact (port, endpoint paths, relay URL) comes from
the adapter's client contract (ADR-029; docs/SYSTEM-BOUNDARY.md section 9 item
4). The fake driver proves the endpoints are contract-driven: under it the same
routes surface ITS contract values, not hardcoded agentgateway numbers.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient
from tests.conftest import make_admin, new_session_token

from l01_core.settings import reset_settings_cache
from l03_adapters.fake import FakeAdapter
from l03_adapters.spi import ClientContract, ClientEndpoint
from l06_api.adapter_factory import get_adapter
from l06_api.deps import SESSION_COOKIE
from server import create_app

FAKE_ADAPTER_ENV = "SLIPSTREAM_DATA_PLANE_ADAPTER"

#: The documented /admin/health wire shape (byte-stable, quick-start renders the
#: port); the value comes from the adapter contract since ticket 04.
HEALTH_KEYS = ["status", "ir_version", "adapter", "data_plane_port", "now_ms"]


@pytest.fixture()
def fake_dataplane(engine_and_sessionmaker, monkeypatch):
    """An authenticated app whose configured data plane is the fake driver."""
    engine, factory = engine_and_sessionmaker
    monkeypatch.setenv(FAKE_ADAPTER_ENV, "fake")
    monkeypatch.setenv("SLIPSTREAM_JOBS_ENABLED", "0")
    reset_settings_cache()
    app = create_app(session_factory=factory, init_tables=False, jobs=False)
    admin_id = make_admin(factory, username="contract-flow-owner")
    token = new_session_token(factory, admin_id)
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, token)
    try:
        yield app, client
    finally:
        app.dependency_overrides.clear()
        reset_settings_cache()


class _StubSSEHandler(BaseHTTPRequestHandler):
    """One-shot OpenAI-ish SSE responder; records what the relay sent."""

    received: list[dict] = []
    sse_payload = b"data: stub-chunk-1\n\ndata: [DONE]\n\n"

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        type(self).received.append(
            {
                "path": self.path,
                "authorization": self.headers.get("Authorization", ""),
                "body": json.loads(body.decode("utf-8")) if body else {},
            }
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(self.sse_payload)))
        self.end_headers()
        self.wfile.write(self.sse_payload)

    def log_message(self, *args: object) -> None:
        pass


@pytest.fixture()
def stub_upstream():
    """A loopback SSE data plane on an OS-assigned port (3700/3600 stay free)."""
    server = HTTPServer(("127.0.0.1", 0), _StubSSEHandler)
    _StubSSEHandler.received = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()


def _fake_contract(stub_server: HTTPServer | None) -> ClientContract:
    """The fake contract, pointed at the stub when one is running."""
    if stub_server is None:
        return ClientContract(
            default_port=0,
            endpoints=(
                ClientEndpoint("/v1/models", ("GET",), "models.list"),
                ClientEndpoint("/v1/embeddings", ("POST",), "embeddings.create"),
            ),
        )
    host, port = stub_server.server_address
    return ClientContract(
        default_port=port,
        scheme="http",
        base_url_hint=f"http://{host}:{port}",
        endpoints=(ClientEndpoint("/v1/chat/completions", ("POST",), "chat.completions"),),
    )


def test_health_shape_is_byte_stable_and_port_comes_from_the_contract(client):
    """The real adapter keeps the documented response; no hardcode involved."""
    response = client.get("/admin/health")
    assert response.status_code == 200
    body = response.json()
    assert list(body.keys()) == HEALTH_KEYS
    assert body["status"] == "ok"
    assert body["adapter"] == "agentgateway"
    # Byte-stable user-visible value; sourced from the AG client contract.
    assert body["data_plane_port"] == 3600


def test_connection_shape_is_byte_stable_and_endpoints_come_from_the_contract(client):
    """docs/api-contract.md section 2.7 shape, now sourced from the contract."""
    response = client.get("/admin/connection")
    assert response.status_code == 200
    body = response.json()
    assert list(body.keys()) == [
        "base_url",
        "configured",
        "default_port",
        "endpoints",
        "updated_at",
        "editable",
    ]
    assert body["base_url"] == ""
    assert body["configured"] is False
    assert body["default_port"] == 3600
    # Exactly the contract's declaration order; no system-side endpoint list.
    assert body["endpoints"] == [
        "/v1/chat/completions",
        "/v1/models",
        "/v1/embeddings",
    ]
    assert body["editable"] is True


def test_fake_adapter_health_and_connection_surface_its_contract(fake_dataplane):
    """Under the fake driver the same routes show ITS contract values."""
    _app, client = fake_dataplane
    contract = FakeAdapter().client_contract()

    health = client.get("/admin/health").json()
    assert health["status"] == "ok"
    assert health["adapter"] == "fake"
    # Contract-driven, not the hardcoded 3600: the fake has no listening port.
    assert health["data_plane_port"] == contract.default_port

    connection = client.get("/admin/connection").json()
    assert connection["default_port"] == contract.default_port
    assert connection["endpoints"] == list(contract.endpoint_paths())


def test_playground_relays_over_the_contract_endpoint_and_stub_upstream(
    fake_dataplane, stub_upstream
):
    """HTTP seam: the relay dials contract.base_url() + the purpose-keyed path."""
    app, client = fake_dataplane
    app.dependency_overrides[get_adapter] = lambda: FakeAdapter(
        contract=_fake_contract(stub_upstream)
    )
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "flagship",
            "messages": [{"role": "user", "content": "hello"}],
        },
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    assert b"stub-chunk-1" in response.content
    assert b"[DONE]" in response.content

    assert len(_StubSSEHandler.received) == 1
    relayed = _StubSSEHandler.received[0]
    assert relayed["path"] == "/v1/chat/completions"
    assert relayed["authorization"].startswith("Bearer sk-")
    assert relayed["body"]["model"] == "flagship"
    assert relayed["body"]["stream"] is True


def test_playground_without_a_contract_chat_endpoint_is_a_stable_conflict(
    fake_dataplane,
):
    """No chat endpoint in the contract -> 409 with the stable error shape."""
    app, client = fake_dataplane
    app.dependency_overrides[get_adapter] = lambda: FakeAdapter(
        contract=_fake_contract(None)
    )
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "flagship",
            "messages": [{"role": "user", "content": "hello"}],
        },
    )
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "CONFLICT"
    assert "对话端点" in body["message"]
