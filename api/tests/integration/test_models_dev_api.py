"""W4-H: adopt endpoints + GET /admin/my/models over HTTP.

Covers the ticket's verified surface: the single/batch 兑入 endpoints (only
blank keys filled, per-key results, params_source badge), the RBAC gate
(upstream_models:write for adoption; bare login session for /admin/my/models),
offline degradation (a broken fetch answers 200 from the stored snapshot /
no-match instead of erroring) and the user-facing parameter shape with no
money keys anywhere.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest
from tests.conftest import seed_channel

from l01_core.timeutil import now_ms
from l04_repo.orm import FxSnapshotORM
from l05_service import models_dev

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "models_dev_api.json"


@pytest.fixture(autouse=True)
def _offline_fetch(monkeypatch):
    """Every HTTP adopt must be hermetic: the "network" returns the fixture."""
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    monkeypatch.setattr(models_dev, "fetch_snapshot", lambda *a, **k: payload)


@pytest.fixture()
def seeded_ids(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        session.add(
            FxSnapshotORM(
                currency="USD", as_of_ms=now_ms(), rate_micro=7_200_000, created_at_ms=now_ms()
            )
        )
        session.commit()
    return ids


def _create_model(client, name: str = "glm-4.6", **extra) -> dict:
    payload = {
        "upstream_id": "ups_test",
        "name": name,
        "model_type": "chat",
        "model_type_source": "default",
        "parameters": {},
        **extra,
    }
    response = client.post("/admin/upstream-models", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# ------------------------------------------------------------------- adoption


def test_adopt_single_fills_blank_and_reports_keys(client, seeded_ids):
    created = _create_model(client, cost_input_per_1m=None, cost_output_per_1m=None)
    response = client.post(f"/admin/upstream-models/{created['id']}/adopt-modelsdev")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["matched"] is True and body["provider"] == "zhipuai"
    assert body["params_source"] == "models.dev"
    assert body["results"]["parameters.max_input_tokens"] == "filled"
    assert body["results"]["cost_input_per_1m"] == "filled"

    listed = client.get("/admin/upstream-models?page_size=200").json()
    row = next(item for item in listed if item["id"] == created["id"])
    assert row["params_source"] == "models.dev"
    assert row["parameters"]["max_input_tokens"] == 204_800
    assert Decimal(row["cost_input_per_1m"]) == Decimal("4.32")


def test_adopt_manual_edit_flips_source_back(client, seeded_ids):
    created = _create_model(client)
    assert client.post(f"/admin/upstream-models/{created['id']}/adopt-modelsdev").status_code == 200
    listed = client.get("/admin/upstream-models?page_size=200").json()
    adopted = next(item for item in listed if item["id"] == created["id"])
    # A no-op save keeps the badge; a real change reclaims it for manual.
    patch = client.patch(
        f"/admin/upstream-models/{created['id']}",
        json={"parameters": adopted["parameters"]},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["params_source"] == "models.dev"  # nothing changed
    changed = client.patch(
        f"/admin/upstream-models/{created['id']}",
        json={"parameters": {**adopted["parameters"], "max_output_tokens": 8192}},
    )
    assert changed.json()["params_source"] == "manual"


def test_adopt_batch_summarizes(client, seeded_ids):
    _create_model(client, "glm-4.6")
    _create_model(client, "not-in-modelsdev")
    response = client.post("/admin/upstream-models/adopt-modelsdev")
    assert response.status_code == 200, response.text
    body = response.json()
    # seed_channel's glm-5.3 row + the two created above
    assert body["total"] == 3
    assert body["matched"] == 1
    assert body["no_match"] == 2
    assert body["filled_models"] == 1
    assert body["refreshed"] is True
    assert body["snapshot"]["models"] == 5


def test_modelsdev_status_empty_before_any_sync(client, seeded_ids):
    response = client.get("/admin/upstream-models/modelsdev-status")
    assert response.status_code == 200, response.text
    assert response.json() == {"models": 0, "providers": 0, "fetched_at_ms": 0}


def test_modelsdev_status_reports_stored_snapshot(client, seeded_ids):
    _create_model(client)
    assert client.post("/admin/upstream-models/adopt-modelsdev").status_code == 200
    response = client.get("/admin/upstream-models/modelsdev-status")
    assert response.status_code == 200, response.text
    body = response.json()
    # The fixture snapshot has 5 models across providers; no network call here.
    assert body["models"] == 5
    assert body["providers"] >= 1
    assert body["fetched_at_ms"] > 0


def test_modelsdev_status_requires_login(client, anon_client):
    assert client.get("/admin/upstream-models/modelsdev-status").status_code == 200
    assert anon_client.get("/admin/upstream-models/modelsdev-status").status_code == 401


def test_adopt_requires_write_permission(client, seeded_ids, login_cookies, anon_client):
    _create_model(client)
    # user role can read upstream models but has no upstream_models:write.
    forbidden = client.post(
        "/admin/upstream-models/adopt-modelsdev", cookies=login_cookies("user")
    )
    assert forbidden.status_code == 403
    assert anon_client.post("/admin/upstream-models/adopt-modelsdev").status_code == 401


def test_adopt_degrades_when_offline(client, seeded_ids, monkeypatch):
    def _broken(*_a, **_k):
        raise models_dev.ModelsDevError("网络不可用")

    monkeypatch.setattr(models_dev, "fetch_snapshot", _broken)
    created = _create_model(client)
    # No stored snapshot: the row is no-match but the endpoint still answers 200.
    response = client.post(f"/admin/upstream-models/{created['id']}/adopt-modelsdev")
    assert response.status_code == 200, response.text
    assert response.json()["matched"] is False
    assert response.json()["status"] == "no-match"


# ------------------------------------------------------------- GET /admin/my/models


def test_my_models_shape_and_no_money_keys(client, seeded_ids):
    response = client.get("/admin/my/models")
    assert response.status_code == 200, response.text
    items = response.json()
    assert [item["name"] for item in items] == ["flagship"]
    item = items[0]
    assert set(item) == {"name", "model_type", "parameters", "sources"}
    assert item["model_type"] == "chat"
    assert item["sources"] == ["glm-5.3"]
    parameters = item["parameters"]
    assert set(parameters) == {
        "max_input_tokens",
        "max_output_tokens",
        "reasoning_level",
        "reasoning_levels",
        "default_reasoning_level",
        "input_types",
        "output_types",
        "tool_call",
        "reasoning",
        "attachment",
        "structured_output",
    }
    blob = json.dumps(items)
    for money_key in ("cost", "markup", "price", "micro", "balance"):
        assert money_key not in blob


def test_my_models_merges_members_fill_blanks(client, seeded_ids):
    richer = _create_model(
        client,
        "claude-sonnet-4-5",
        parameters={
            "max_input_tokens": 200_000,
            "max_output_tokens": 64_000,
            "tool_call": True,
        },
    )
    client.post(
        "/admin/model-targets",
        json={"public_model_id": "pmdl_test", "upstream_model_id": richer["id"], "priority": 2},
    )
    items = client.get("/admin/my/models").json()
    flagship = next(item for item in items if item["name"] == "flagship")
    # glm-5.3 (priority 1) seeds, the richer member fills only its blanks.
    assert flagship["sources"] == ["glm-5.3", "claude-sonnet-4-5"]
    assert flagship["parameters"]["max_input_tokens"] == 200_000
    assert flagship["parameters"]["tool_call"] is True


def test_my_models_carries_reasoning_declaration_and_merge_fills_blanks(
    client, seeded_ids
):
    """Ticket 18: 声明集合与默认档进 /admin/my/models；成员合并沿用只填空语义。"""
    undeclared = _create_model(client, "glm-4.6")
    client.post(
        "/admin/model-targets",
        json={"public_model_id": "pmdl_test", "upstream_model_id": undeclared["id"], "priority": 2},
    )
    items = client.get("/admin/my/models").json()
    flagship = next(item for item in items if item["name"] == "flagship")
    # glm-5.3（priority 1）没有声明 → 空集合与空串原样透出。
    assert flagship["parameters"]["reasoning_levels"] == []
    assert flagship["parameters"]["default_reasoning_level"] == ""

    declared = _create_model(
        client,
        "reasoning-rich",
        parameters={
            "reasoning_levels": ["default", "none", "high", "xhigh"],
            "default_reasoning_level": "high",
        },
    )
    client.post(
        "/admin/model-targets",
        json={"public_model_id": "pmdl_test", "upstream_model_id": declared["id"], "priority": 3},
    )
    items = client.get("/admin/my/models").json()
    flagship = next(item for item in items if item["name"] == "flagship")
    # 后位成员只填空：空声明被补齐，非空声明不被覆盖。
    assert flagship["parameters"]["reasoning_levels"] == ["default", "none", "high", "xhigh"]
    assert flagship["parameters"]["default_reasoning_level"] == "high"


def test_my_models_excludes_disabled(client, seeded_ids):
    created = _create_model(client, "glm-4.6")
    client.post(
        "/admin/model-targets",
        json={"public_model_id": "pmdl_test", "upstream_model_id": created["id"], "priority": 2},
    )
    patched = client.patch("/admin/upstream-models/" + created["id"], json={"enabled": False})
    assert patched.status_code == 200
    items = client.get("/admin/my/models").json()
    flagship = next(item for item in items if item["name"] == "flagship")
    assert flagship["sources"] == ["glm-5.3"]  # disabled member skipped


def test_my_models_login_only(client, seeded_ids, login_cookies, anon_client):
    # Reseller and customer sessions both read the same public catalog.
    for role in ("reseller", "customer"):
        response = client.get("/admin/my/models", cookies=login_cookies(role))
        assert response.status_code == 200, response.text
        assert isinstance(response.json(), list)
    assert anon_client.get("/admin/my/models").status_code == 401
