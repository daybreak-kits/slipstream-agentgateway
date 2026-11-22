"""The query-syntax catalog is the single source for the console help dialog."""

from __future__ import annotations

from tests.conftest import _app_client, make_admin, new_session_token

from l06_api.deps import SESSION_COOKIE

_EXPECTED = [
    "model:glm",
    "upstream:zai",
    "user:alice",
    "key:WXYZ",
    "status:200",
    "status:5xx",
    "latency>500",
    "latency<200",
    "ttft>300",
    "cache>30",
    "stream:true",
]


def _browser(factory):
    admin_id = make_admin(factory, username="syntax-owner", role="admin")
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client


def test_query_syntax_catalog(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    response = _browser(factory).get("/admin/logs/query-syntax")
    assert response.status_code == 200
    tokens = response.json()["tokens"]
    assert [token["token"] for token in tokens] == _EXPECTED
    assert all(token["meaning"] and token["example"] for token in tokens)
