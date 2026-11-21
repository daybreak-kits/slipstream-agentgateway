"""W6 ticket 07: unified error shape at the HTTP boundary.

Recon (``.scratch/w6/recon/500s.md`` category B1) showed uncaught exceptions
returning bare-text 500s with no request id. The contract now is:

- 500 responses are JSON with exactly code/message/request_id (no internals,
  never plain text);
- the request id agrees between the X-Request-Id header and the JSON body and
  is unique per request (the old handlers minted a second, different id);
- AppError responses keep their JSON shape and obey the same agreement.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from l03_adapters.fake import FakeAdapter
from l06_api.deps import SESSION_COOKIE, get_adapter


def _defuse_adapter(client: TestClient) -> None:
    """Make the request-scoped adapter dependency raise like a real uncaught bug."""

    def _boom() -> None:
        raise RuntimeError("boom: uncaught adapter bug")

    client.app.dependency_overrides[get_adapter] = _boom


def _quiet_client(client: TestClient) -> TestClient:
    """Same app + session cookie, but server exceptions surface as 500 responses."""
    raw = TestClient(client.app, raise_server_exceptions=False)
    raw.cookies.set(SESSION_COOKIE, client.cookies.get(SESSION_COOKIE))
    return raw


def test_uncaught_exception_returns_json_500(client):
    _defuse_adapter(client)
    body = _quiet_client(client).get("/admin/logs/evt_x/payload")
    assert body.status_code == 500, body.text
    assert body.headers["content-type"].startswith("application/json")
    payload = body.json()
    # Exactly the three contract fields: no details, no internals, no text.
    assert set(payload) == {"code", "message", "request_id"}, payload
    assert payload["code"] == "INTERNAL_ERROR"
    assert payload["message"]
    assert payload["request_id"]


def test_request_id_unique_per_request_and_matches_header(client):
    _defuse_adapter(client)
    raw = _quiet_client(client)
    first = raw.get("/admin/logs/evt_x/payload")
    second = raw.get("/admin/logs/evt_x/payload")
    assert first.json()["request_id"] != second.json()["request_id"]
    for response in (first, second):
        assert response.headers["x-request-id"] == response.json()["request_id"]


def test_app_error_request_id_agrees_between_header_and_body(client):
    """AppError JSON existed before, but header and body ids were minted apart."""
    adapter = FakeAdapter()
    client.app.dependency_overrides[get_adapter] = lambda: adapter
    try:
        body = client.get("/admin/logs/evt_missing/payload")
    finally:
        client.app.dependency_overrides.pop(get_adapter, None)
    assert body.status_code == 404, body.text
    payload = body.json()
    assert payload["code"] == "NOT_FOUND"
    assert payload["request_id"]
    assert body.headers["x-request-id"] == payload["request_id"]
