"""厂商维度彻底删除（W7 t03 / ADR-030）。

从 API 与 DB 边界断言：旧 vendors 路由 404、上游/价目/成本流水不再有
vendor 字段、缓存价只按 upstream_model_id 归属、vendors 权限键退场。
"""

from __future__ import annotations

from sqlalchemy import inspect
from tests.conftest import seed_channel

from l02_domain.models import UsageEvent
from l04_repo.orm import UpstreamModelORM
from l05_service import rbac, usage_ingest

PRICES_URL = "/admin/prices/upstream"
T0 = 1_800_000_000_000


def _columns(engine, table: str) -> set[str]:
    inspector = inspect(engine)
    if not inspector.has_table(table):
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def test_db_schema_has_no_vendor_tables_or_columns(engine_and_sessionmaker) -> None:
    engine, _factory = engine_and_sessionmaker
    inspector = inspect(engine)
    assert "vendors" not in inspector.get_table_names()
    assert "vendor_id" not in _columns(engine, "upstreams")
    price_columns = _columns(engine, "upstream_prices")
    assert "vendor_id" not in price_columns
    assert "upstream_model" not in price_columns
    assert "upstream_model_id" in price_columns
    assert "vendor_id" not in _columns(engine, "cost_entries")
    assert "vendor_id" not in _columns(engine, "cost_daily")


def test_vendors_routes_are_gone(client) -> None:
    """旧厂商路由删除后按项目路由策略返回 404（GET 落 SPA 兜底）；POST 无路由 405。"""
    assert client.get("/admin/vendors").status_code == 404
    assert client.post("/admin/vendors", json={"name": "x", "slug": "x"}).status_code == 405


def test_vendor_permission_keys_are_retired() -> None:
    assert "vendors:read" not in rbac.PERMISSION_KEYS
    assert "vendors:write" not in rbac.PERMISSION_KEYS


def test_upstream_api_never_returns_vendor_fields(client, engine_and_sessionmaker) -> None:
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)

    created = client.post(
        "/admin/upstreams",
        json={
            "base_url": "https://another.example/v1",
            "api_style": "openai_chat",
            "api_key": "sk-no-vendor-1",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert "vendor_id" not in body
    # 名称由 base_url 生成（ADR-023 #6）：host:port 折叠为 - 分隔。
    assert body["name"] == "another-example"

    listed = client.get("/admin/upstreams").json()
    assert listed
    for item in listed:
        assert "vendor_id" not in item

    detail = client.get("/admin/upstreams/" + seed["upstream_id"]).json()
    assert "vendor_id" not in detail


def test_cache_price_api_is_keyed_by_upstream_model_only(client, engine_and_sessionmaker) -> None:
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    model_id = seed["upstream_model_id"]

    created = client.post(
        PRICES_URL,
        json={
            "item": "cache_read",
            "unit_price_micro": 1_000_000,
            "currency": "CNY",
            "upstream_model_id": model_id,
            "effective_from_ms": T0,
        },
    )
    assert created.status_code == 201, created.text

    rows = client.get(PRICES_URL).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["upstream_model_id"] == model_id
    assert "vendor_id" not in row
    assert "upstream_model" not in row


def test_cache_price_api_rejects_the_legacy_vendor_key(client, engine_and_sessionmaker) -> None:
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)

    legacy = client.post(
        PRICES_URL,
        json={
            "item": "cache_read",
            "unit_price_micro": 1_000_000,
            "currency": "CNY",
            "upstream_model": "glm-5.3",
        },
    )
    assert legacy.status_code == 422
    assert legacy.json()["code"] == "VALIDATION_ERROR"

    nothing = client.post(
        PRICES_URL,
        json={"item": "cache_read", "unit_price_micro": 1_000_000, "currency": "CNY"},
    )
    assert nothing.status_code == 422
    assert client.get(PRICES_URL).json() == []


def test_cost_entry_response_has_no_vendor_field(client, engine_and_sessionmaker) -> None:
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    model_id = seed["upstream_model_id"]

    patched = client.patch(
        "/admin/upstream-models/" + model_id,
        json={"cost_input_per_1m": "2.5", "cost_output_per_1m": "10", "markup": "1.2"},
    )
    assert patched.status_code == 200, patched.text
    priced = client.post(
        PRICES_URL,
        json={
            "item": "cache_read",
            "unit_price_micro": 1_000_000,
            "currency": "CNY",
            "upstream_model_id": model_id,
            "effective_from_ms": T0,
        },
    )
    assert priced.status_code == 201, priced.text

    with factory() as session:
        event = UsageEvent(
            event_id="evt_no_vendor",
            started_at_ms=T0,
            http_status=200,
            public_model="flagship",
            upstream_model="glm-5.3",
            provider=seed["upstream_id"],
            api_key_id=seed["key_id"],
            input_tokens=1000,
            output_tokens=2000,
            total_tokens=3000,
            cache_read_tokens=500,
        )
        usage_ingest.ingest_usage_events(session, [event])
        usage_ingest.process_billing(session)
        session.commit()

    rows = client.get("/admin/cost/entries").json()
    assert len(rows) == 1
    row = rows[0]
    assert "vendor_id" not in row
    assert row["upstream_model_id"] == model_id
    # 入 1000×2.5 + 出 2000×10 + 缓存读 500×1.0 = 23_000（缓存价按模型行取到）。
    assert row["amount_micro"] == 23_000


def test_cache_price_is_resolved_per_upstream_model(client, engine_and_sessionmaker) -> None:
    """两个上游模型各自的缓存价：计费必须取事件实际命中的模型行，不会串价。"""
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    other = client.post(
        "/admin/upstreams",
        json={
            "base_url": "https://backup.example/v1",
            "api_style": "openai_chat",
            "api_key": "sk-backup-1",
        },
    )
    assert other.status_code == 201, other.text
    other_upstream_id = other.json()["id"]
    created = client.post(
        "/admin/upstream-models",
        json={"upstream_id": other_upstream_id, "name": "backup-chat"},
    )
    assert created.status_code == 201, created.text
    other_model_id = created.json()["id"]

    for model_id, micro in ((seed["upstream_model_id"], 1_000_000), (other_model_id, 3_000_000)):
        priced = client.post(
            PRICES_URL,
            json={
                "item": "cache_read",
                "unit_price_micro": micro,
                "currency": "CNY",
                "upstream_model_id": model_id,
                "effective_from_ms": T0,
            },
        )
        assert priced.status_code == 201, priced.text

    with factory() as session:
        first = session.get(UpstreamModelORM, seed["upstream_model_id"])
        first.cost_input_per_1m = 0
        first.cost_output_per_1m = 0
        second = session.get(UpstreamModelORM, other_model_id)
        second.cost_input_per_1m = 0
        second.cost_output_per_1m = 0
        session.commit()
        events = [
            UsageEvent(
                event_id="evt_model_key_a",
                started_at_ms=T0,
                http_status=200,
                public_model="flagship",
                upstream_model="glm-5.3",
                provider=seed["upstream_id"],
                api_key_id=seed["key_id"],
                input_tokens=1000,
                output_tokens=0,
                total_tokens=1000,
                cache_read_tokens=1000,
            ),
            UsageEvent(
                event_id="evt_model_key_b",
                started_at_ms=T0,
                http_status=200,
                public_model="flagship",
                upstream_model="backup-chat",
                provider=other_upstream_id,
                api_key_id=seed["key_id"],
                input_tokens=1000,
                output_tokens=0,
                total_tokens=1000,
                cache_read_tokens=1000,
            ),
        ]
        usage_ingest.ingest_usage_events(session, events)
        usage_ingest.process_billing(session)
        session.commit()

    costs = {
        row["gateway_event_id"]: row
        for row in client.get("/admin/cost/entries", params={"page_size": 200}).json()
    }
    # cache_read 1000 tokens × 每 1M 单价 → 1_000 与 3_000；两行互不串价。
    assert costs["evt_model_key_a"]["amount_micro"] == 1_000
    assert costs["evt_model_key_b"]["amount_micro"] == 3_000
