"""W6 ticket 04: connection, health and playground consume the client contract.

Seam: HTTP admin API. The system endpoints must return byte-stable, user-visible
shapes while every data-plane fact (port, endpoint paths, relay URL) comes from
the adapter's client contract (ADR-029; docs/SYSTEM-BOUNDARY.md section 9 item
4). The fake driver proves the endpoints are contract-driven: under it the same
routes surface ITS contract values, not hardcoded agentgateway numbers.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest
from fastapi.testclient import TestClient
from tests.conftest import make_admin, new_session_token, seed_channel

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


class _SlowFirstByteSSEHandler(BaseHTTPRequestHandler):
    """SSE responder that withholds response headers until released."""

    started = threading.Event()
    release = threading.Event()
    sse_payload = b"data: slow-chunk-1\n\ndata: [DONE]\n\n"

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        type(self).started.set()
        type(self).release.wait(2)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(self.sse_payload)))
        self.end_headers()
        try:
            self.wfile.write(self.sse_payload)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *args: object) -> None:
        pass


@pytest.fixture()
def slow_first_byte_upstream():
    """A data plane that accepts the request but delays the response headers."""
    _SlowFirstByteSSEHandler.started.clear()
    _SlowFirstByteSSEHandler.release.clear()
    server = HTTPServer(("127.0.0.1", 0), _SlowFirstByteSSEHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        _SlowFirstByteSSEHandler.release.set()
        server.shutdown()
        server.server_close()


@pytest.mark.asyncio
async def test_playground_slow_first_byte_does_not_block_the_event_loop(
    fake_dataplane, slow_first_byte_upstream
):
    """The SSE relay must not execute blocking network I/O on the event loop.

    A data plane that withholds response headers used to freeze the whole async
    control plane for as long as the first token took (observed: ~295s on a real
    upstream). A heartbeat task on the same loop records the starvation gap; it
    must stay small while the relay is waiting for the upstream headers.
    """
    app, client = fake_dataplane
    app.dependency_overrides[get_adapter] = lambda: FakeAdapter(
        contract=_fake_contract(slow_first_byte_upstream)
    )
    token = client.cookies.get(SESSION_COOKIE)
    transport = httpx.ASGITransport(app=app)
    tick_times: list[float] = []

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(0.01)
            tick_times.append(time.perf_counter())

    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        ac.cookies.set(SESSION_COOKIE, token)
        beat = asyncio.create_task(heartbeat())
        await asyncio.sleep(0.05)  # let the heartbeat record baseline ticks
        started_at = time.perf_counter()
        stream_task = asyncio.create_task(
            ac.post(
                "/admin/playground/stream",
                json={"model": "flagship", "messages": [{"role": "user", "content": "hello"}]},
                timeout=10,
            )
        )
        try:
            response = await stream_task
        finally:
            elapsed = time.perf_counter() - started_at
            beat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await beat
    assert response.status_code == 200, response.text
    assert b"slow-chunk-1" in response.content
    gaps = [later - earlier for earlier, later in zip(tick_times, tick_times[1:], strict=False)]
    max_gap = max(gaps, default=elapsed)
    assert max_gap < 0.5, (
        "event loop was starved for "
        f"{max_gap:.2f}s while the relay waited for upstream headers "
        f"(request took {elapsed:.2f}s, {len(tick_times)} heartbeat ticks)"
    )


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


# --------------------------------------------- reasoning_effort full levels (t18)


@pytest.mark.parametrize("level", ["none", "low", "medium", "high", "xhigh", "max"])
def test_playground_reasoning_effort_level_is_forwarded_verbatim(
    fake_dataplane, stub_upstream, level
):
    """Ticket 18: every declared level except default reaches the data plane."""
    app, client = fake_dataplane
    app.dependency_overrides[get_adapter] = lambda: FakeAdapter(
        contract=_fake_contract(stub_upstream)
    )
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "flagship",
            "messages": [{"role": "user", "content": "hello"}],
            "reasoning_effort": level,
        },
    )
    assert response.status_code == 200, response.text
    assert len(_StubSSEHandler.received) == 1
    assert _StubSSEHandler.received[0]["body"]["reasoning_effort"] == level


def test_playground_reasoning_effort_default_never_lands_in_the_body(
    fake_dataplane, stub_upstream
):
    """Ticket 18: "default" means 不传 — the relayed body has no such key."""
    app, client = fake_dataplane
    app.dependency_overrides[get_adapter] = lambda: FakeAdapter(
        contract=_fake_contract(stub_upstream)
    )
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "flagship",
            "messages": [{"role": "user", "content": "hello"}],
            "reasoning_effort": "default",
        },
    )
    assert response.status_code == 200, response.text
    assert len(_StubSSEHandler.received) == 1
    assert "reasoning_effort" not in _StubSSEHandler.received[0]["body"]


def test_playground_reasoning_effort_unknown_level_is_a_validation_error(
    fake_dataplane,
):
    """Anything outside the declared level set is a 422, not a silent drop."""
    _app, client = fake_dataplane
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "flagship",
            "messages": [{"role": "user", "content": "hello"}],
            "reasoning_effort": "extremely-high",
        },
    )
    assert response.status_code == 422


# --------------------------------------------- playground output params (t19)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("top_k", 40),
        ("seed", 42),
        ("frequency_penalty", -1.5),
        ("presence_penalty", 0.5),
        ("max_completion_tokens", 256),
        ("stop", ["END", "DONE"]),
        ("n", 3),
        ("response_format", {"type": "json_object"}),
        ("logprobs", True),
        ("top_logprobs", 5),
        ("user", "operator-7"),
    ],
)
def test_playground_output_params_are_forwarded_verbatim(
    fake_dataplane, stub_upstream, field, value
):
    """Ticket 19: every panel param crosses the schema AND the relay whitelist.

    The stub records the actual data-plane body, so the assertion proves real
    forwarding, not just schema acceptance (same technique as ticket 18).
    """
    app, client = fake_dataplane
    app.dependency_overrides[get_adapter] = lambda: FakeAdapter(
        contract=_fake_contract(stub_upstream)
    )
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "flagship",
            "messages": [{"role": "user", "content": "hello"}],
            field: value,
        },
    )
    assert response.status_code == 200, response.text
    assert len(_StubSSEHandler.received) == 1
    assert _StubSSEHandler.received[0]["body"][field] == value


def test_playground_extra_fields_merge_and_never_override_relay_keys(
    fake_dataplane, stub_upstream
):
    """Ticket 19: the vendor passthrough box merges, standard params win.

    Relay-owned keys (model/messages/stream/stream_options) can never be
    overridden by the passthrough box; a standard param always beats the same
    key inside extra_fields.
    """
    app, client = fake_dataplane
    app.dependency_overrides[get_adapter] = lambda: FakeAdapter(
        contract=_fake_contract(stub_upstream)
    )
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "flagship",
            "messages": [{"role": "user", "content": "hello"}],
            "temperature": 0.7,
            "extra_fields": {
                "vendor_x": "v",
                "model": "evil",
                "messages": [],
                "stream": False,
                "stream_options": {"include": True},
                "temperature": 99.0,
            },
        },
    )
    assert response.status_code == 200, response.text
    assert len(_StubSSEHandler.received) == 1
    body = _StubSSEHandler.received[0]["body"]
    assert body["vendor_x"] == "v"
    assert body["model"] == "flagship"
    assert body["stream"] is True
    assert body["messages"] == [{"role": "user", "content": "hello"}]
    assert body["temperature"] == 0.7
    assert "stream_options" not in body


@pytest.mark.parametrize(
    "stop",
    [
        ["a", "b", "c", "d", "e"],
        ["ok", ""],
    ],
)
def test_playground_stop_out_of_bounds_is_a_validation_error(
    fake_dataplane, stub_upstream, stop
):
    """Ticket 19: stop is at most 4 non-empty strings; more or empty is a 422."""
    _app, client = fake_dataplane
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "flagship",
            "messages": [{"role": "user", "content": "hello"}],
            "stop": stop,
        },
    )
    assert response.status_code == 422
    assert len(_StubSSEHandler.received) == 0


# ------------------------------------- max output tokens per registered model (t19)


def _seed_registered_model(engine_and_sessionmaker, max_output_tokens: int) -> None:
    """A public model "t19-model" whose single member registers an output cap."""
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    from l04_repo.orm import ModelTargetORM, PublicModelORM, UpstreamModelORM

    with factory() as session:
        session.add(
            UpstreamModelORM(
                id="umdl_t19",
                upstream_id="ups_test",
                name="t19-member",
                model_type="chat",
                enabled=True,
                parameters_json=json.dumps({"max_output_tokens": max_output_tokens}),
                created_at_ms=0,
            )
        )
        session.add(PublicModelORM(id="pmdl_t19", name="t19-model", created_at_ms=0))
        session.add(
            ModelTargetORM(
                id="mt_t19",
                public_model_id="pmdl_t19",
                upstream_model_id="umdl_t19",
                priority=1,
                created_at_ms=0,
            )
        )
        session.commit()


def test_playground_max_tokens_over_the_registered_limit_is_rejected(
    fake_dataplane, stub_upstream, engine_and_sessionmaker
):
    """Ticket 19: the registered max_output_tokens is the backend backstop."""
    _seed_registered_model(engine_and_sessionmaker, max_output_tokens=8192)
    app, client = fake_dataplane
    app.dependency_overrides[get_adapter] = lambda: FakeAdapter(
        contract=_fake_contract(stub_upstream)
    )
    for field in ("max_tokens", "max_completion_tokens"):
        response = client.post(
            "/admin/playground/stream",
            json={
                "model": "t19-model",
                "messages": [{"role": "user", "content": "hello"}],
                field: 8193,
            },
        )
        assert response.status_code == 422, response.text
        body = response.json()
        assert body["code"] == "VALIDATION_ERROR"
        assert "8192" in body["message"]
        assert field in body["message"]
    assert len(_StubSSEHandler.received) == 0


def test_playground_max_tokens_at_the_registered_limit_is_forwarded(
    fake_dataplane, stub_upstream, engine_and_sessionmaker
):
    """Ticket 19: a value within the registered limit relays untouched."""
    _seed_registered_model(engine_and_sessionmaker, max_output_tokens=8192)
    app, client = fake_dataplane
    app.dependency_overrides[get_adapter] = lambda: FakeAdapter(
        contract=_fake_contract(stub_upstream)
    )
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "t19-model",
            "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 8192,
        },
    )
    assert response.status_code == 200, response.text
    assert len(_StubSSEHandler.received) == 1
    assert _StubSSEHandler.received[0]["body"]["max_tokens"] == 8192


def test_playground_max_tokens_without_a_registered_capability_is_forwarded(
    fake_dataplane, stub_upstream
):
    """Ticket 19: no registered capability -> nothing to enforce per model.

    "flagship" is not in the control-plane registry, so the per-model backstop
    skips (the schema sanity bound still applies); the frontend inline hint
    uses the safe default and labels it as such.
    """
    app, client = fake_dataplane
    app.dependency_overrides[get_adapter] = lambda: FakeAdapter(
        contract=_fake_contract(stub_upstream)
    )
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "flagship",
            "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 100000,
        },
    )
    assert response.status_code == 200, response.text
    assert len(_StubSSEHandler.received) == 1
    assert _StubSSEHandler.received[0]["body"]["max_tokens"] == 100000


def test_playground_max_tokens_absurd_value_is_a_schema_validation_error(
    fake_dataplane,
):
    """Ticket 19: the schema sanity bound is the same 100M cap the registry uses."""
    _app, client = fake_dataplane
    response = client.post(
        "/admin/playground/stream",
        json={
            "model": "flagship",
            "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 100_000_001,
        },
    )
    assert response.status_code == 422
