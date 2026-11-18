"""API surface: RBAC, pagination tiers, transforms endpoints, keys, balances (ADR-007/008)."""

from __future__ import annotations

from tests.conftest import seed_channel

TRANSFORMS = {
    "request_headers": [{"op": "update", "name": "x-trace", "value": "slip"}],
    "request_body": [
        {"op": "update", "path": "temperature", "value": "0.2",
         "conditions": [{"field": "model", "mode": "full", "value": "glm-5.3"}]}
    ],
}


def test_health(client):
    response = client.get("/admin/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_rbac_viewer_cannot_write(client, login_cookies):
    response = client.post(
        "/admin/vendors",
        json={"name": "V", "slug": "v"},
        cookies=login_cookies("viewer"),
    )
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"


def test_rbac_unknown_role_rejected(anon_client):
    # Header spoofing is no longer an identity source: no cookie means 401.
    response = anon_client.get("/admin/vendors", headers={"X-Admin-Role": "superboss"})
    assert response.status_code == 401


def test_pagination_tiers(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    ok = client.get("/admin/vendors", params={"page_size": 200})
    assert ok.status_code == 200
    bad = client.get("/admin/vendors", params={"page_size": 30})
    assert bad.status_code == 422
    assert bad.json()["code"] == "VALIDATION_ERROR"


def test_upstream_transforms_put_get_preview(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    upstream_id = ids["upstream_id"]
    put = client.put(
        f"/admin/upstreams/{upstream_id}/transforms",
        json=TRANSFORMS,
    )
    assert put.status_code == 200
    got = client.get(
        f"/admin/upstreams/{upstream_id}/transforms",
    )
    assert got.status_code == 200
    assert got.json()["transforms"]["request_headers"][0]["name"] == "x-trace"
    preview = client.post(
        f"/admin/upstreams/{upstream_id}/transforms/preview",
        json=TRANSFORMS,
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["after"]["request"]["set"] == {"x-trace": '"slip"'}
    assert body["after"]["conditional"][0]["predicate"].startswith("json(request.body)")
    assert body["skipped"] == []
    assert isinstance(body["notes"], list)


def test_protected_header_rejected_with_readable_error(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    bad = dict(TRANSFORMS)
    bad["request_headers"] = [{"op": "update", "name": "x-api-key", "value": "evil"}]
    put = client.put(
        f"/admin/upstreams/{ids['upstream_id']}/transforms",
        json=bad,
    )
    assert put.status_code == 422
    assert "x-api-key" in put.json()["message"].lower()


def test_key_issue_once_mask_list_and_reveal(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    listed = client.get("/admin/api-keys")
    assert listed.status_code == 200
    rows = [r for r in listed.json() if r["id"] == ids["key_id"]]
    assert rows and rows[0]["mask"].startswith("sk-...")
    assert ids["key_plaintext"] not in listed.text  # mask only in list views
    created = client.post(
        "/admin/users",
        json={"name": "bob", "balance_micro": 1_000},
    )
    assert created.status_code == 201
    new_id = created.json()["id"]
    issued = client.post(
        f"/admin/users/{new_id}/api-keys",
        json={"user_id": new_id, "length": 64},
    )
    assert issued.status_code == 201
    assert issued.json()["key"].startswith("sk-")
    again = client.post(
        f"/admin/users/{new_id}/api-keys",
        json={"user_id": new_id, "length": 64},
    )
    assert again.status_code == 201  # ADR-023: a user holds many keys (cap 50)
    assert again.json()["name"] == "密钥 2"
    revealed = client.post(
        f"/admin/api-keys/{ids['key_id']}/reveal",
    )
    assert revealed.status_code == 200
    assert revealed.json()["key"] == ids["key_plaintext"]


def test_balance_topup_books_ledger_and_user(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    top = client.post(
        f"/admin/users/{ids['user_id']}/balance",
        json={"amount_micro": 500, "note": "recharge"},
    )
    assert top.status_code == 200
    assert top.json()["balance_after_micro"] == 50_000_500
    ledger = client.get(
        f"/admin/users/{ids['user_id']}/ledger"
    )
    assert ledger.status_code == 200
    assert "topup" in {row["kind"] for row in ledger.json()}
    user = client.get(f"/admin/users/{ids['user_id']}")
    assert user.json()["balance_micro"] == 50_000_500


def test_vendor_crud_flow(client):
    created = client.post(
        "/admin/vendors", json={"name": "Vendor One", "slug": "vendor-one"},
    )
    assert created.status_code == 201
    vid = created.json()["id"]
    patched = client.patch(
        f"/admin/vendors/{vid}", json={"note": "hello"},
    )
    assert patched.json()["note"] == "hello"
    deleted = client.delete(f"/admin/vendors/{vid}")
    assert deleted.status_code == 204
