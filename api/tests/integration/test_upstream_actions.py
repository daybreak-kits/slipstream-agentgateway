"""Ticket 09: upstream keys, probes, discovery/import, delete protection and batch."""

from __future__ import annotations

import pytest

from conftest import seed_channel
from l05_service import upstream_ops


def _upstream(client, *, key: str = "sk-initial") -> dict:
    # ADR-030: no vendor dimension - the name derives from the base_url and
    # dedupes with a numeric suffix, so several upstreams in one test stay
    # distinct without any explicit name.
    response = client.post(
        "/admin/upstreams",
        json={
            "base_url": "https://api.example/v1",
            "api_style": "openai_chat",
            "api_key": key,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _keys(client, upstream_id: str) -> dict:
    response = client.get(f"/admin/upstreams/{upstream_id}/keys")
    assert response.status_code == 200, response.text
    return response.json()


def test_new_upstream_has_one_masked_key(client):
    upstream = _upstream(client)
    keys = _keys(client, upstream["id"])
    assert keys["limit"] == 20
    assert len(keys["items"]) == 1
    key = keys["items"][0]
    # ADR-026: no primary concept; the row has never been tested.
    assert "is_primary" not in key
    assert key["last_test"] is None and key["last_test_at_ms"] == 0
    assert key["masked"] == "…tial"
    assert "sk-initial" not in key["masked"]

    listed = client.get("/admin/upstreams").json()
    row = next(item for item in listed if item["id"] == upstream["id"])
    assert row["key_count"] == 1
    # ADR-026: the credential lives in the key row; has_api_key is derived from
    # the key count, not from the retired api_key_enc mirror column.
    assert row["has_api_key"] is True
    assert row["model_count"] == 0
    assert row["last_probe"] is None


def test_key_add_patch_and_delete_stay_equal_peers(client):
    upstream = _upstream(client)
    upstream_id = upstream["id"]

    added = client.post(
        f"/admin/upstreams/{upstream_id}/keys",
        json={"label": "backup", "api_key": "sk-backup-9999"},
    )
    assert added.status_code == 201, added.text
    second = added.json()
    assert second["label"] == "backup"
    assert second["masked"] == "…9999"
    assert "is_primary" not in second

    duplicate = client.post(
        f"/admin/upstreams/{upstream_id}/keys",
        json={"label": "dup", "api_key": "sk-backup-9999"},
    )
    assert duplicate.status_code == 409

    renamed = client.patch(
        f"/admin/upstreams/{upstream_id}/keys/{second['id']}",
        json={"label": "backup-2"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["label"] == "backup-2"

    # ADR-026 ②: is_primary is retired - the schema rejects the field (422),
    # and the rotate endpoint no longer exists.
    rejected = client.patch(
        f"/admin/upstreams/{upstream_id}/keys/{second['id']}",
        json={"label": "x", "is_primary": True},
    )
    assert rejected.status_code == 422, rejected.text
    rotated = client.post(
        f"/admin/upstreams/{upstream_id}/rotate-key", json={"api_key": "sk-rotated-2026"}
    )
    assert rotated.status_code in (404, 405)

    removed = client.delete(f"/admin/upstreams/{upstream_id}/keys/{second['id']}")
    assert removed.status_code == 200, removed.text
    remaining = _keys(client, upstream_id)["items"]
    assert len(remaining) == 1
    assert "is_primary" not in remaining[0]


def test_batch_delete_reports_per_key_and_keeps_the_last(client):
    upstream_id = _upstream(client)["id"]
    initial = _keys(client, upstream_id)["items"][0]["id"]
    ids = []
    for index in range(2):
        response = client.post(
            f"/admin/upstreams/{upstream_id}/keys",
            json={"label": f"b{index}", "api_key": f"sk-batch-{index}"},
        )
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])

    # three deletable keys + one unknown id; the batch never aborts on a miss
    response = client.post(
        f"/admin/upstreams/{upstream_id}/keys/batch-delete",
        json={"ids": [initial, ids[0], "upk_missing"]},
    )
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["upstream_id"] == upstream_id
    assert report["deleted"] == 2
    assert [item["key_id"] for item in report["items"]] == [initial, ids[0], "upk_missing"]
    assert report["items"][0]["ok"] is True
    assert report["items"][2]["ok"] is False and "不存在" in report["items"][2]["error"]

    keys = _keys(client, upstream_id)["items"]
    assert [key["id"] for key in keys] == [ids[1]]

    # the last remaining key is refused as a per-item 409-shaped error, not an abort
    blocked = client.post(
        f"/admin/upstreams/{upstream_id}/keys/batch-delete",
        json={"ids": [ids[1]]},
    )
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()["deleted"] == 0
    assert blocked.json()["items"][0]["ok"] is False
    assert "至少保留一把" in blocked.json()["items"][0]["error"]
    assert len(_keys(client, upstream_id)["items"]) == 1

    empty = client.post(
        f"/admin/upstreams/{upstream_id}/keys/batch-delete", json={"ids": []}
    )
    assert empty.status_code == 422


def test_key_test_reports_and_persists_per_key(client, monkeypatch):
    seen: list[str] = []

    def fake_fetch_models(*, base_url, api_style, api_key, timeout_s=8.0):
        seen.append(api_key)
        if api_key == "sk-bad-9999":
            return 401, [], 11
        return 200, ["glm-5.3"], 5

    monkeypatch.setattr(upstream_ops, "fetch_models", fake_fetch_models)
    upstream_id = _upstream(client, key="sk-bad-9999")["id"]
    good = client.post(
        f"/admin/upstreams/{upstream_id}/keys",
        json={"label": "good", "api_key": "sk-good-0001"},
    )
    assert good.status_code == 201, good.text

    response = client.post(f"/admin/upstreams/{upstream_id}/keys/test")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["upstream_id"] == upstream_id
    assert body["api_style"] == "openai_chat"
    items = body["items"]
    assert len(items) == 2
    by_ok = {item["ok"]: item for item in items}
    assert by_ok[True]["status_code"] == 200 and by_ok[True]["latency_ms"] == 5
    assert by_ok[True]["error"] == ""
    assert by_ok[False]["status_code"] == 401
    assert "401" in by_ok[False]["error"]

    # the outcome lands on each row and survives a re-list
    keys = _keys(client, upstream_id)["items"]
    tests = {key["masked"]: key["last_test"] for key in keys}
    assert tests["…0001"]["ok"] is True
    assert tests["…9999"]["ok"] is False
    for key in keys:
        assert key["last_test_at_ms"] > 0

    # an unknown style override is rejected before any request
    bad_style = client.post(
        f"/admin/upstreams/{upstream_id}/keys/test", json={"api_style": "nope"}
    )
    assert bad_style.status_code == 422
    assert seen == ["sk-bad-9999", "sk-good-0001"]


def test_key_test_scope_probes_only_the_requested_keys(client, monkeypatch):
    """W8 ticket 04: row test probes only its key; batch probes only the selection.

    One API/one probe loop serves both: key_id addresses one row, keys addresses
    an explicit set (request order, duplicates collapse). Unknown ids and the
    mutually exclusive body shapes are request errors raised before any request,
    so a bad batch can never probe (or persist) a partially wrong set.
    """
    seen: list[str] = []

    def fake_fetch_models(*, base_url, api_style, api_key, timeout_s=8.0):
        seen.append(api_key)
        if api_key == "sk-bad-9999":
            return 401, [], 11
        return 200, ["glm-5.3"], 5

    monkeypatch.setattr(upstream_ops, "fetch_models", fake_fetch_models)
    upstream_id = _upstream(client, key="sk-first-0001")["id"]
    first_id = _keys(client, upstream_id)["items"][0]["id"]
    second = client.post(
        f"/admin/upstreams/{upstream_id}/keys",
        json={"label": "second", "api_key": "sk-second-0002"},
    ).json()
    third = client.post(
        f"/admin/upstreams/{upstream_id}/keys",
        json={"label": "third", "api_key": "sk-third-0003"},
    ).json()

    # row scope: exactly one probe and exactly one persisted row
    response = client.post(
        f"/admin/upstreams/{upstream_id}/keys/test", json={"key_id": second["id"]}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["upstream_id"] == upstream_id
    assert [item["key_id"] for item in body["items"]] == [second["id"]]
    assert body["items"][0]["ok"] is True
    assert seen == ["sk-second-0002"]
    by_id = {key["id"]: key for key in _keys(client, upstream_id)["items"]}
    assert by_id[second["id"]]["last_test"]["ok"] is True
    assert by_id[first_id]["last_test"] is None
    assert by_id[third["id"]]["last_test"] is None

    # batch scope: request order wins, duplicates collapse, untouched rows stay
    seen.clear()
    response = client.post(
        f"/admin/upstreams/{upstream_id}/keys/test",
        json={"keys": [third["id"], first_id, third["id"]]},
    )
    assert response.status_code == 200, response.text
    batch = response.json()
    assert [item["key_id"] for item in batch["items"]] == [third["id"], first_id]
    assert seen == ["sk-third-0003", "sk-first-0001"]
    by_id = {key["id"]: key for key in _keys(client, upstream_id)["items"]}
    assert by_id[first_id]["last_test"]["ok"] is True
    assert by_id[third["id"]]["last_test"]["ok"] is True
    # the row tested earlier keeps its own outcome (the batch did not rewrite it)
    assert by_id[second["id"]]["last_test"]["ok"] is True

    # both scopes at once, an unknown id and unknown body fields are 422s
    seen.clear()
    both = client.post(
        f"/admin/upstreams/{upstream_id}/keys/test",
        json={"key_id": first_id, "keys": [first_id]},
    )
    assert both.status_code == 422, both.text
    assert both.json()["code"] == "VALIDATION_ERROR"
    unknown = client.post(
        f"/admin/upstreams/{upstream_id}/keys/test", json={"key_id": "upk_missing"}
    )
    assert unknown.status_code == 422, unknown.text
    assert unknown.json()["code"] == "VALIDATION_ERROR"
    unknown_batch = client.post(
        f"/admin/upstreams/{upstream_id}/keys/test",
        json={"keys": [first_id, "upk_missing"]},
    )
    assert unknown_batch.status_code == 422, unknown_batch.text
    assert unknown_batch.json()["code"] == "VALIDATION_ERROR"
    assert seen == []

    # empty selection, over-limit list and a typo field never reach the probe
    assert (
        client.post(
            f"/admin/upstreams/{upstream_id}/keys/test", json={"keys": []}
        ).status_code
        == 422
    )
    too_many = ["upk_" + str(index) for index in range(21)]
    assert (
        client.post(
            f"/admin/upstreams/{upstream_id}/keys/test", json={"keys": too_many}
        ).status_code
        == 422
    )
    typo = client.post(
        f"/admin/upstreams/{upstream_id}/keys/test", json={"keyid": first_id}
    )
    assert typo.status_code == 422
    assert seen == []


def test_pre_migration_inline_key_is_not_surfaced_as_a_synthetic_row(
    client, engine_and_sessionmaker
):
    """A pre-upstream_keys database reports no keys until the migration runs.

    Ticket 09 review: read paths no longer fall back to the retired
    upstreams.api_key_enc mirror, so the console shows key_count 0 and tells the
    operator to run scripts/migrate_multikey_v2.py instead of inventing a
    synthetic row. The first write still materializes the inline credential so
    the legacy key is never orphaned.
    """
    from l01_core.crypto import SecretBox
    from l01_core.timeutil import now_ms
    from l04_repo.orm import UpstreamORM

    engine, factory = engine_and_sessionmaker
    box = SecretBox("test-secret")
    with factory() as session:
        upstream = UpstreamORM(
            id="ups_inline",
            name="inline-era",
            base_url="https://inline.example/v1",
            api_style="openai_chat",
            api_key_enc=box.encrypt("sk-inline-7777"),
            created_at_ms=now_ms(),
        )
        session.add(upstream)
        session.commit()
    assert seed_channel  # conftest import guard: the fixture stays wired

    assert _keys(client, upstream.id)["items"] == []
    row = next(
        item
        for item in client.get("/admin/upstreams").json()
        if item["id"] == upstream.id
    )
    assert row["key_count"] == 0
    assert row["has_api_key"] is False
    # No synthetic row means "legacy" is not a resolvable key id any more.
    unknown = client.patch(
        f"/admin/upstreams/{upstream.id}/keys/legacy", json={"label": "首把密钥"}
    )
    assert unknown.status_code == 404, unknown.text
    # Write path (kept from ADR-026): the first key action materializes the old
    # inline credential, so adding a backup key yields two real rows.
    added = client.post(
        f"/admin/upstreams/{upstream.id}/keys",
        json={"label": "backup", "api_key": "sk-backup-7777"},
    )
    assert added.status_code == 201, added.text
    after = _keys(client, upstream.id)["items"]
    assert [key["label"] for key in after] == ["密钥 1", "backup"]
    assert "is_primary" not in after[0]


def test_key_cap_is_twenty_and_last_key_is_protected(client):
    upstream_id = _upstream(client)["id"]
    for index in range(19):
        response = client.post(
            f"/admin/upstreams/{upstream_id}/keys",
            json={"label": f"k{index}", "api_key": f"sk-extra-{index:04d}"},
        )
        assert response.status_code == 201, response.text
    assert len(_keys(client, upstream_id)["items"]) == 20

    overflow = client.post(
        f"/admin/upstreams/{upstream_id}/keys",
        json={"label": "too-many", "api_key": "sk-overflow"},
    )
    assert overflow.status_code == 409
    assert "20" in overflow.json()["message"]

    fresh_id = _upstream(client, key="sk-solo-1111")["id"]
    only_key = _keys(client, fresh_id)["items"][0]
    blocked = client.delete(f"/admin/upstreams/{fresh_id}/keys/{only_key['id']}")
    assert blocked.status_code == 409
    assert len(_keys(client, fresh_id)["items"]) == 1


def test_connection_and_discovery_share_the_probe_record(client, monkeypatch):
    seen: list[tuple[str, str, str]] = []

    def fake_fetch_models(*, base_url, api_style, api_key, timeout_s=8.0):
        seen.append((base_url, api_style, api_key))
        return 200, ["glm-5.3", "deepseek-v3"], 7

    monkeypatch.setattr(upstream_ops, "fetch_models", fake_fetch_models)
    upstream_id = _upstream(client, key="sk-probe-7777")["id"]

    tested = client.post(f"/admin/upstreams/{upstream_id}/test-connection")
    assert tested.status_code == 200, tested.text
    body = tested.json()
    assert body["status"] == "ok"
    assert body["http_status"] == 200
    assert body["latency_ms"] == 7
    assert body["model_count"] == 2
    assert seen == [("https://api.example/v1", "openai_chat", "sk-probe-7777")]

    detail = client.get(f"/admin/upstreams/{upstream_id}").json()
    assert detail["last_probe"]["status"] == "ok"
    assert detail["last_probe"]["model_count"] == 2

    discovered = client.post(f"/admin/upstreams/{upstream_id}/discover-models")
    assert discovered.status_code == 200, discovered.text
    assert set(discovered.json()["models"]) == {"deepseek-v3", "glm-5.3"}

    imported = client.post(
        f"/admin/upstreams/{upstream_id}/import-models",
        json={"names": sorted(discovered.json()["models"])},
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["created"] == ["deepseek-v3", "glm-5.3"]
    assert imported.json()["skipped"] == []
    assert client.get(f"/admin/upstreams/{upstream_id}").json()["model_count"] == 2

    again = client.post(
        f"/admin/upstreams/{upstream_id}/import-models",
        json={"names": ["glm-5.3", "new-model"]},
    )
    assert again.json()["created"] == ["new-model"]
    assert again.json()["skipped"] == ["glm-5.3"]


def test_failed_probe_is_reported_not_raised(client, monkeypatch):
    def fake_fetch_models(*, base_url, api_style, api_key, timeout_s=8.0):
        return 401, [], 12

    monkeypatch.setattr(upstream_ops, "fetch_models", fake_fetch_models)
    upstream_id = _upstream(client)["id"]
    response = client.post(f"/admin/upstreams/{upstream_id}/test-connection")
    assert response.status_code == 200
    assert response.json()["status"] == "error"
    assert response.json()["http_status"] == 401
    assert "401" in response.json()["message"]


def test_delete_blocked_when_a_public_model_references_it(client, engine_and_sessionmaker):
    ids = seed_channel(*engine_and_sessionmaker)
    response = client.delete(f"/admin/upstreams/{ids['upstream_id']}")
    assert response.status_code == 409
    payload = response.json()
    assert payload["code"] == "CONFLICT"
    assert payload["details"]["models"] == ["glm-5.3"]
    assert client.get(f"/admin/upstreams/{ids['upstream_id']}").status_code == 200


def test_delete_removes_keys_and_models_for_an_unreferenced_upstream(client):
    upstream_id = _upstream(client)["id"]
    client.post(
        f"/admin/upstreams/{upstream_id}/import-models", json={"names": ["m1"]}
    )
    deleted = client.delete(f"/admin/upstreams/{upstream_id}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"deleted": upstream_id}
    assert client.get(f"/admin/upstreams/{upstream_id}").status_code == 404
    assert client.get(f"/admin/upstreams/{upstream_id}/keys").status_code == 404


def test_batch_enable_disable_delete_with_per_item_report(client, engine_and_sessionmaker):
    first = _upstream(client, key="sk-a-1111")["id"]
    second = _upstream(client, key="sk-b-2222")["id"]

    disabled = client.patch(
        "/admin/upstreams/batch",
        json={"ids": [first, second, "ups_missing"], "action": "disable"},
    )
    assert disabled.status_code == 200, disabled.text
    report = disabled.json()
    assert report["changed"] == [first, second]
    assert report["missing"] == ["ups_missing"]
    assert report["failed"] == []
    assert client.get(f"/admin/upstreams/{first}").json()["enabled"] is False
    assert client.get(f"/admin/upstreams/{second}").json()["enabled"] is False

    enabled = client.patch(
        "/admin/upstreams/batch", json={"ids": [first], "action": "enable"}
    )
    assert enabled.json()["changed"] == [first]
    assert client.get(f"/admin/upstreams/{first}").json()["enabled"] is True

    ids = seed_channel(*engine_and_sessionmaker)
    deleted = client.patch(
        "/admin/upstreams/batch",
        json={"ids": [ids["upstream_id"], second], "action": "delete"},
    )
    report = deleted.json()
    assert report["changed"] == [second]
    assert report["failed"][0]["id"] == ids["upstream_id"]
    assert report["failed"][0]["code"] == "CONFLICT"
    assert client.get(f"/admin/upstreams/{second}").status_code == 404
    assert client.get(f"/admin/upstreams/{ids['upstream_id']}").status_code == 200


def test_batch_validation_rejects_unknown_action(client):
    response = client.patch(
        "/admin/upstreams/batch", json={"ids": ["ups_x"], "action": "explode"}
    )
    assert response.status_code == 422


@pytest.mark.parametrize("missing_action", ["enable", "disable", "delete"])
def test_batch_only_reports_missing_ids(client, missing_action):
    response = client.patch(
        "/admin/upstreams/batch",
        json={"ids": ["ups_nope"], "action": missing_action},
    )
    assert response.status_code == 200, response.text
    assert response.json()["missing"] == ["ups_nope"]
    assert response.json()["changed"] == []


# --- ADR-023 #6: explicit rename via PATCH ------------------------------------


def _named_upstream(client, name: str, base_url: str) -> dict:
    response = client.post(
        "/admin/upstreams",
        json={
            "name": name,
            "base_url": base_url,
            "api_style": "openai_chat",
            "api_key": "sk-rename",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_patch_upstream_renames_and_keeps_the_explicit_name(client):
    _named_upstream(client, "alpha", "https://a.example/v1")
    beta = _named_upstream(client, "beta", "https://b.example/v1")
    url = f"/admin/upstreams/{beta['id']}"

    renamed = client.patch(url, json={"name": "gamma"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "gamma"

    # Duplicate names are a 422 like every other entity.
    conflict = client.patch(url, json={"name": "alpha"})
    assert conflict.status_code == 422
    assert conflict.json()["code"] == "VALIDATION_ERROR"

    # A blank value and renaming to the current name are both no-ops.
    blank = client.patch(url, json={"name": "   "})
    assert blank.status_code == 200, blank.text
    assert blank.json()["name"] == "gamma"
    same = client.patch(url, json={"name": "gamma"})
    assert same.status_code == 200

    # Without name the field is untouched; the explicit name is authoritative
    # afterwards, so changing base_url never re-derives a host:port name.
    moved = client.patch(url, json={"base_url": "https://c.example:8443/v1"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["name"] == "gamma"
    assert moved.json()["base_url"] == "https://c.example:8443/v1"


def test_patch_upstream_name_strips_surrounding_whitespace(client):
    row = _named_upstream(client, "padded-target", "https://d.example/v1")
    patched = client.patch(f"/admin/upstreams/{row['id']}", json={"name": "  tidy  "})
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "tidy"


# --- ADR-023 #6: api_style="auto" protocol detection -------------------------


def _detect_result(protocol: str | None, steps: list[dict] | None = None) -> dict:
    return {
        "protocol": protocol,
        "steps": steps
        if steps is not None
        else [{"order": 1, "protocol": protocol, "method": "GET", "url": "u",
               "http_status": 200, "latency_ms": 3, "ok": True, "detail": ""}],
        "models": ["glm-5.3"] if protocol else [],
        "message": f"自动探测命中 {protocol}" if protocol else "四种协议均未命中",
        "latency_ms": 12,
    }


def test_create_with_auto_resolves_and_records_the_detection(client, monkeypatch):
    monkeypatch.setattr(
        upstream_ops, "detect_api_style", lambda **kw: _detect_result("openai_chat")
    )
    response = client.post(
        "/admin/upstreams",
        json={
            "base_url": "https://api.example/v1",
            "api_style": "auto",
            "api_key": "sk-auto-1111",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    # stored value is the resolved concrete style; "auto" never lands in the db
    assert body["api_style"] == "openai_chat"
    assert body["api_style_source"] == "auto"
    assert body["last_probe"]["kind"] == "detect"

    detail = client.get(f"/admin/upstreams/{body['id']}").json()
    assert detail["api_style"] == "openai_chat"
    assert detail["api_style_source"] == "auto"

    # a later manual style edit flips the reported source back to manual
    patched = client.patch(f"/admin/upstreams/{body['id']}", json={"api_style": "gemini"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["api_style"] == "gemini"
    assert patched.json()["api_style_source"] == "manual"


def test_create_with_auto_fails_422_with_per_protocol_reasons(client, monkeypatch):
    steps = [
        {"order": 1, "protocol": "openai_chat", "method": "GET", "url": "u",
         "http_status": 401, "latency_ms": 3, "ok": False, "detail": "HTTP 401"},
        {"order": 2, "protocol": "anthropic_messages", "method": "GET", "url": "u",
         "http_status": 401, "latency_ms": 3, "ok": False, "detail": "HTTP 401"},
        {"order": 3, "protocol": "gemini", "method": "GET", "url": "u",
         "http_status": 401, "latency_ms": 3, "ok": False, "detail": "HTTP 401"},
    ]
    monkeypatch.setattr(
        upstream_ops, "detect_api_style", lambda **kw: _detect_result(None, steps)
    )
    response = client.post(
        "/admin/upstreams",
        json={
            "base_url": "https://api.example/v1",
            "api_style": "auto",
            "api_key": "sk-auto-2222",
        },
    )
    assert response.status_code == 422, response.text
    payload = response.json()
    assert "均未命中" in payload["message"]
    assert [step["protocol"] for step in payload["details"]["probe_steps"]] == [
        "openai_chat",
        "anthropic_messages",
        "gemini",
    ]
    # nothing was created: the retry derives its name from the base_url
    retry = client.post(
        "/admin/upstreams",
        json={
            "base_url": "https://api.example/v1",
            "api_style": "openai_chat",
            "api_key": "sk-plain-4444",
        },
    )
    assert retry.status_code == 201, retry.text
    assert retry.json()["name"] == "api-example"


def test_patch_with_auto_resolves_against_the_stored_key(client, monkeypatch):
    upstream = _upstream(client, key="sk-patch-3333")
    seen: dict = {}

    def fake_detect(*, base_url, api_key, timeout_s=8.0):
        seen.update(base_url=base_url, api_key=api_key)
        return _detect_result("anthropic_messages")

    monkeypatch.setattr(upstream_ops, "detect_api_style", fake_detect)
    patched = client.patch(
        f"/admin/upstreams/{upstream['id']}",
        json={"api_style": "auto", "base_url": "https://api.example/v2"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["api_style"] == "anthropic_messages"
    assert patched.json()["api_style_source"] == "auto"
    # the probe used the updated base_url and the decrypted primary key
    assert seen == {"base_url": "https://api.example/v2", "api_key": "sk-patch-3333"}


def test_discover_models_with_auto_returns_protocol_and_steps(client, monkeypatch):
    upstream_id = _upstream(client)["id"]
    steps = [
        {"order": 1, "protocol": "openai_chat", "method": "GET", "url": "u1",
         "http_status": 401, "latency_ms": 2, "ok": False, "detail": "HTTP 401"},
        {"order": 2, "protocol": "anthropic_messages", "method": "GET", "url": "u2",
         "http_status": 200, "latency_ms": 5, "ok": True, "detail": ""},
    ]
    monkeypatch.setattr(
        upstream_ops, "detect_api_style", lambda **kw: _detect_result("anthropic_messages", steps)
    )
    response = client.post(
        f"/admin/upstreams/{upstream_id}/discover-models", json={"api_style": "auto"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["protocol"] == "anthropic_messages"
    assert body["protocol_source"] == "auto"
    assert body["probe_steps"] == steps
    # the models array keeps its historical shape (plain list of ids)
    assert body["models"] == ["glm-5.3"]
    assert body["status"] == "ok"
    assert body["model_count"] == 1


def test_discover_and_test_connection_keep_legacy_fields_for_a_fixed_style(
    client, monkeypatch
):
    def fake_fetch_models(*, base_url, api_style, api_key, timeout_s=8.0):
        return 200, ["glm-5.3"], 7

    monkeypatch.setattr(upstream_ops, "fetch_models", fake_fetch_models)
    upstream_id = _upstream(client)["id"]

    tested = client.post(f"/admin/upstreams/{upstream_id}/test-connection")
    assert tested.status_code == 200, tested.text
    body = tested.json()
    assert body["protocol"] == "openai_chat"
    assert body["protocol_source"] == "manual"
    assert body["probe_steps"] == [
        {
            "order": 1,
            "protocol": "openai_chat",
            "method": "GET",
            "url": "https://api.example/v1/models",
            "http_status": 200,
            "latency_ms": 7,
            "ok": True,
            "detail": "",
        }
    ]
    # historical keys survive untouched
    for key in ("id", "kind", "status", "http_status", "latency_ms", "message",
                "model_count", "models", "tested_at_ms"):
        assert key in body

    detail = client.get(f"/admin/upstreams/{upstream_id}").json()
    assert detail["api_style_source"] == "manual"


def test_probe_request_can_override_the_style_for_one_call(client, monkeypatch):
    seen: list[str] = []

    def fake_fetch_models(*, base_url, api_style, api_key, timeout_s=8.0):
        seen.append(api_style)
        return 200, ["claude-x"], 4

    monkeypatch.setattr(upstream_ops, "fetch_models", fake_fetch_models)
    upstream_id = _upstream(client)["id"]
    response = client.post(
        f"/admin/upstreams/{upstream_id}/discover-models",
        json={"api_style": "anthropic_messages"},
    )
    assert response.status_code == 200, response.text
    assert seen == ["anthropic_messages"]
    assert response.json()["protocol"] == "anthropic_messages"
    assert response.json()["protocol_source"] == "manual"


def test_auto_probe_failure_is_reported_not_raised(client, monkeypatch):
    steps = [
        {"order": 1, "protocol": "openai_chat", "method": "GET", "url": "u",
         "http_status": 0, "latency_ms": 0, "ok": False, "detail": "连接失败：boom"},
    ]
    monkeypatch.setattr(
        upstream_ops, "detect_api_style", lambda **kw: _detect_result(None, steps)
    )
    upstream_id = _upstream(client)["id"]
    response = client.post(
        f"/admin/upstreams/{upstream_id}/test-connection", json={"api_style": "auto"}
    )
    assert response.status_code == 200  # probe outcome is data, not a request error
    body = response.json()
    assert body["status"] == "error"
    assert body["protocol"] is None
    assert body["protocol_source"] == "auto"
    assert body["probe_steps"] == steps
    assert "均未命中" in body["message"]


def test_unknown_probe_style_is_rejected(client):
    upstream_id = _upstream(client)["id"]
    response = client.post(
        f"/admin/upstreams/{upstream_id}/test-connection", json={"api_style": "nope"}
    )
    assert response.status_code == 422
    assert "unknown api_style" in response.json()["message"]


# --------------------------------------------------------------- ADR-023 #6:
# 名称由连接地址生成（工单 D + ADR-030）。名称即上游标志，重名 422，可手改。


def _bare_upstream(client, base_url: str, **extra) -> dict:
    response = client.post(
        "/admin/upstreams",
        json={"base_url": base_url, "api_style": "openai_chat", "api_key": "sk-bare", **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_upstream_generates_name_from_base_url(client):
    upstream = _bare_upstream(client, "https://www.abc.com:8080/v1")
    assert upstream["name"] == "www-abc-com-8080"

    # 默认端口去掉；非 [a-z0-9] 字符折叠为 -
    dropped = _bare_upstream(client, "https://WWW.Abc.com:443/v1")
    assert dropped["name"] == "www-abc-com"
    plain_http = _bare_upstream(client, "http://1.2.3.4:80/v1")
    assert plain_http["name"] == "1-2-3-4"
    kept = _bare_upstream(client, "http://10.0.0.9:8000/v1")
    assert kept["name"] == "10-0-0-9-8000"


def test_generated_names_dedupe_with_numeric_suffix(client):
    first = _bare_upstream(client, "https://www.abc.com:8080/v1")
    second = _bare_upstream(client, "https://www.abc.com:8080/v1")
    assert (first["name"], second["name"]) == ("www-abc-com-8080", "www-abc-com-8080-2")
    third = _bare_upstream(client, "https://www.abc.com:8080/v1")
    assert third["name"] == "www-abc-com-8080-3"


def test_explicit_name_wins_and_duplicates_are_422(client):
    upstream = _bare_upstream(client, "https://host.example/v1", name="自命名渠道")
    assert upstream["name"] == "自命名渠道"
    clash = client.post(
        "/admin/upstreams",
        json={
            "name": "自命名渠道",
            "base_url": "https://other.example/v1",
            "api_style": "openai_chat",
            "api_key": "sk-x",
        },
    )
    assert clash.status_code == 422
    assert "already exists" in clash.json()["message"]


def test_discover_models_route_is_registered_exactly_once(client):
    """routers_ops 的死路由删除后，探测端点只剩 C 工单版本。"""
    from l06_api import routers_ops, routers_upstreams

    def _discover_paths(router):
        return [
            route.path
            for route in router.routes
            if getattr(route, "path", "") and "discover-models" in route.path
        ]

    assert _discover_paths(routers_upstreams.router) == [
        "/admin/upstreams/{upstream_id}/discover-models"
    ]
    assert _discover_paths(routers_ops.router) == []
