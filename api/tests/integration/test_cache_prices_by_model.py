"""缓存价按上游模型归属（W7 t03 / ADR-030）。

The cache price book (upstream_prices) is keyed by the upstream model row
(upstream_model_id). The legacy vendor_id + upstream_model key is retired with
the vendor dimension: only the model key remains, and a price cannot hang off
anything else.
"""

from __future__ import annotations

from tests.conftest import seed_channel

from l02_domain.models import UsageEvent
from l04_repo.orm import CostEntryORM
from l05_service import usage_ingest

PRICES_URL = "/admin/prices/upstream"
T0 = 1_800_000_000_000
T1 = T0 + 86_400_000
PRICE = {"item": "cache_read", "unit_price_micro": 1_000_000, "currency": "CNY"}


def _create(client, body: dict) -> dict:
    """POST one price version; the API answers 201 with {id, version}."""
    resp = client.post(PRICES_URL, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_cache_price_is_created_and_read_by_upstream_model_id(client, engine_and_sessionmaker):
    """The model key writes a price version and reads it back under the same key."""
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    model_id = seed["upstream_model_id"]

    created = _create(client, {**PRICE, "upstream_model_id": model_id, "effective_from_ms": T0})
    assert created["version"] == 1

    rows = client.get(PRICES_URL, params={"upstream_model_id": model_id}).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == created["id"]
    assert row["upstream_model_id"] == model_id
    assert row["item"] == "cache_read"
    assert row["unit_price_micro"] == 1_000_000
    assert row["currency"] == "CNY"
    assert row["effective_from_ms"] == T0
    assert row["version"] == 1


def test_version_window_by_upstream_model_id_selects_the_effective_row(
    client, engine_and_sessionmaker
):
    """Versions stack per model+item; the effective row follows the time window."""
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    model_id = seed["upstream_model_id"]

    first = _create(client, {**PRICE, "upstream_model_id": model_id, "effective_from_ms": T0})
    second = _create(
        client,
        {
            **PRICE,
            "upstream_model_id": model_id,
            "effective_from_ms": T1,
            "unit_price_micro": 2_000_000,
        },
    )
    assert (first["version"], second["version"]) == (1, 2)

    # Before the first version starts, nothing is effective yet.
    before = client.get(PRICES_URL, params={"upstream_model_id": model_id, "at_ms": T0 - 1}).json()
    assert before == []
    # Inside the first window the older version still prices.
    rows = client.get(
        PRICES_URL, params={"upstream_model_id": model_id, "item": "cache_read", "at_ms": T0}
    ).json()
    assert [row["unit_price_micro"] for row in rows] == [1_000_000]
    # From the second version on, the newer price applies.
    rows = client.get(
        PRICES_URL, params={"upstream_model_id": model_id, "item": "cache_read", "at_ms": T1}
    ).json()
    assert [row["unit_price_micro"] for row in rows] == [2_000_000]


def test_cache_billing_prices_cache_tokens_off_the_model_key(client, engine_and_sessionmaker):
    """Billing reads the cache price per model+item: cache tokens are money."""
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    model_id = seed["upstream_model_id"]
    patched = client.patch(
        "/admin/upstream-models/umdl_test",
        json={"cost_input_per_1m": "2.5", "cost_output_per_1m": "10", "markup": "1.2"},
    )
    assert patched.status_code == 200, patched.text
    _create(client, {**PRICE, "upstream_model_id": model_id, "effective_from_ms": T0})

    with factory() as session:
        event = UsageEvent(
            event_id="evt_cache_key",
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
        # input 1000 x 2.5 + output 2000 x 10 = 22_500; cache_read 500 tokens x
        # 1.0 per 1M = 500 -> 23_000.
        cost = session.query(CostEntryORM).filter_by(gateway_event_id="evt_cache_key").one()
        assert cost.amount_micro == 23_000

    # Recompute is stable: the same price keeps the same money.
    with factory() as session:
        usage_ingest.process_billing(session, recompute_event_ids=["evt_cache_key"])
        session.commit()
        cost = session.query(CostEntryORM).filter_by(gateway_event_id="evt_cache_key").one()
        assert cost.amount_micro == 23_000


def test_unknown_upstream_model_id_is_not_found(client, engine_and_sessionmaker):
    """A price cannot hang off a model row that does not exist."""
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)

    resp = client.post(PRICES_URL, json={**PRICE, "upstream_model_id": "umdl_missing"})
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "NOT_FOUND"
    assert client.get(PRICES_URL).json() == []
