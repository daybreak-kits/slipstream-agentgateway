"""Ticket 03: the transform preview API answers through the SPI port.

Seam: POST /admin/upstreams/{id}/transforms/preview with the adapter dependency
overridden. The response must mirror whatever the injected driver's
preview_transforms returns (the concrete compiler is adapter-private), while
keeping the existing front-end contract keys (upstream_id/before/after/skipped/
notes) byte-compatible.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from tests.conftest import make_admin, new_session_token

from l03_adapters.fake import FakeAdapter
from l06_api.app import create_app
from l06_api.deps import SESSION_COOKIE, get_adapter

TRANSFORMS = {
    "request_headers": [{"op": "update", "name": "x-trace", "value": "slip"}],
}


def test_preview_answer_from_the_injected_adapter_port(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    app = create_app(session_factory=factory, init_tables=False)
    adapter = FakeAdapter()
    app.dependency_overrides[get_adapter] = lambda: adapter
    client = TestClient(app, raise_server_exceptions=True)
    admin_id = make_admin(factory, username="preview-port")
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))

    response = client.post("/admin/upstreams/ups_any/transforms/preview", json=TRANSFORMS)

    assert response.status_code == 200, response.text
    body = response.json()
    # The port answer, not a system-side compile: the fake driver's preview is
    # recognizable and cannot come from a concrete transform compiler.
    assert body["after"] == {"fake": True, "rules": 0}
    assert body["skipped"] == []
    assert body["notes"] == ["fake adapter: transform preview is in-memory"]
    # Existing front-end contract keys stay stable.
    assert set(body) == {"upstream_id", "before", "after", "skipped", "notes"}
    assert body["upstream_id"] == "ups_any"
    assert body["before"] == TRANSFORMS
