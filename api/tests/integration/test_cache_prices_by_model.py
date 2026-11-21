"""缓存价按上游模型归属（W7 t02 expand）：新键与旧 vendor 键并存且同价。

The cache price book (upstream_prices) grows a second key: the upstream model
row (upstream_model_id). The legacy vendor_id + upstream_model key keeps
working unchanged, so the operator reads the same price whichever key
addresses it, and the vendor key can be deleted later without moving money.
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


def test_legacy_vendor_key_still_creates_and_reads_prices(client, engine_and_sessionmaker):
    """The vendor+model key is untouched: same endpoint, same row shape."""
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)

    created = _create(
        client,
        {
            **PRICE,
            "vendor_id": seed["vendor_id"],
            "upstream_model": "glm-5.3",
            "effective_from_ms": T0,
        },
    )
    assert created["version"] == 1

    rows = client.get(
        PRICES_URL, params={"vendor_id": seed["vendor_id"], "upstream_model": "glm-5.3"}
    ).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == created["id"]
    assert row["vendor_id"] == seed["vendor_id"]
    assert row["upstream_model"] == "glm-5.3"
    assert row["upstream_model_id"] is None
    assert row["unit_price_micro"] == 1_000_000
    assert row["version"] == 1


def test_legacy_key_keeps_prices_of_upstreams_without_a_vendor(client, engine_and_sessionmaker):
    """ADR-023 upstreams may have no vendor; their price row keeps an empty vendor."""
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)

    created = _create(
        client,
        {**PRICE, "vendor_id": "", "upstream_model": "glm-5.3", "effective_from_ms": T0},
    )
    assert created["version"] == 1
    rows = client.get(PRICES_URL, params={"upstream_model": "glm-5.3"}).json()
    assert len(rows) == 1
    assert rows[0]["vendor_id"] == ""
    assert rows[0]["upstream_model"] == "glm-5.3"


def test_both_keys_price_the_same_data_identically(client, engine_and_sessionmaker):
    """One price written under either key reads back as the same money."""
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    model_id = seed["upstream_model_id"]

    _create(
        client,
        {
            **PRICE,
            "vendor_id": seed["vendor_id"],
            "upstream_model": "glm-5.3",
            "effective_from_ms": T0,
        },
    )
    _create(client, {**PRICE, "upstream_model_id": model_id, "effective_from_ms": T0})

    legacy = client.get(
        PRICES_URL,
        params={
            "vendor_id": seed["vendor_id"],
            "upstream_model": "glm-5.3",
            "item": "cache_read",
            "at_ms": T0,
        },
    ).json()
    by_model = client.get(
        PRICES_URL,
        params={"upstream_model_id": model_id, "item": "cache_read", "at_ms": T0},
    ).json()
    assert len(legacy) == 1
    assert len(by_model) == 1
    # Same data, two keys: price, currency, window and version number agree.
    assert legacy[0]["unit_price_micro"] == by_model[0]["unit_price_micro"] == 1_000_000
    assert legacy[0]["currency"] == by_model[0]["currency"] == "CNY"
    assert legacy[0]["effective_from_ms"] == by_model[0]["effective_from_ms"] == T0
    assert legacy[0]["version"] == by_model[0]["version"] == 1


def test_cache_billing_stays_the_same_whichever_key_addresses_the_price(
    client, engine_and_sessionmaker
):
    """Billing keeps reading one price per model+item: no double counting."""
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    model_id = seed["upstream_model_id"]
    patched = client.patch(
        "/admin/upstream-models/umdl_test",
        json={"cost_input_per_1m": "2.5", "cost_output_per_1m": "10", "markup": "1.2"},
    )
    assert patched.status_code == 200, patched.text
    _create(
        client,
        {
            **PRICE,
            "vendor_id": seed["vendor_id"],
            "upstream_model": "glm-5.3",
            "effective_from_ms": T0,
        },
    )

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
        # 1.0 per 1M = 500 -> 23_000 (the legacy key still prices the cache).
        cost = session.query(CostEntryORM).filter_by(gateway_event_id="evt_cache_key").one()
        assert cost.amount_micro == 23_000

    # The same price under the model key must not be counted twice.
    _create(client, {**PRICE, "upstream_model_id": model_id, "effective_from_ms": T0})
    with factory() as session:
        usage_ingest.process_billing(session, recompute_event_ids=["evt_cache_key"])
        session.commit()
        cost = session.query(CostEntryORM).filter_by(gateway_event_id="evt_cache_key").one()
        assert cost.amount_micro == 23_000


def test_a_price_needs_exactly_one_key(client, engine_and_sessionmaker):
    """No key, half a key or both keys are rejected instead of guessed."""
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)

    assert client.post(PRICES_URL, json={**PRICE}).status_code == 422
    only_vendor = client.post(PRICES_URL, json={**PRICE, "vendor_id": seed["vendor_id"]})
    assert only_vendor.status_code == 422
    only_model_name = client.post(PRICES_URL, json={**PRICE, "upstream_model": "glm-5.3"})
    assert only_model_name.status_code == 422
    mixed = client.post(
        PRICES_URL,
        json={
            **PRICE,
            "vendor_id": seed["vendor_id"],
            "upstream_model": "glm-5.3",
            "upstream_model_id": seed["upstream_model_id"],
        },
    )
    assert mixed.status_code == 422
    assert mixed.json()["code"] == "VALIDATION_ERROR"
    # Nothing was written by the rejected calls.
    assert client.get(PRICES_URL).json() == []


def test_unknown_upstream_model_id_is_not_found(client, engine_and_sessionmaker):
    """A price cannot hang off a model row that does not exist."""
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)

    resp = client.post(PRICES_URL, json={**PRICE, "upstream_model_id": "umdl_missing"})
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "NOT_FOUND"
    assert client.get(PRICES_URL).json() == []
