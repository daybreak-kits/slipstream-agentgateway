"""Log requested_model (ticket 03): the public model the client actually asked for.

AG records the final upstream model in request_logs.gen_ai_request_model (our
public_model column, ledger semantics untouched) and only the mixed-form
attributes_json carries the client-facing name as agw.ai.original_model
(docs/plans/w5-correctness-rework.md §7-3). The log API derives requested_model
from the stored raw row; old/full-form rows and malformed JSON degrade to an
empty string (rendered as "—"), never to a made-up public name.
"""

from __future__ import annotations

import json

from tests.conftest import _app_client, make_admin, new_session_token

from l01_core.timeutil import now_ms
from l04_repo.orm import GatewayUsageEventORM
from l06_api.deps import SESSION_COOKIE


def _browser(factory):
    admin_id = make_admin(factory, username="logs-requested", role="owner")
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client


def _attr(value: object) -> dict:
    """raw_json as AG stores it: attributes_json is one TEXT column holding JSON."""
    return {"attributes_json": json.dumps(value) if not isinstance(value, str) else value}


def _seed(factory, rows: list[tuple[str, object]]) -> None:
    """Insert one gateway_usage_event per (event_id, raw_json) pair.

    public_model/upstream_model are pinned to up-a on every row so a test that
    expects the requested model to stay blank can also prove the API never
    falls back to the ledger's recorded (upstream) model.
    """
    now = now_ms()
    with factory() as session:
        for index, (event_id, raw) in enumerate(rows):
            session.add(
                GatewayUsageEventORM(
                    event_id=event_id,
                    started_at_ms=now - 10_000 + index,
                    completed_at_ms=now - 9_000 + index,
                    duration_ms=1000,
                    http_status=200,
                    public_model="up-a",
                    upstream_model="up-a",
                    provider="testv",
                    input_tokens=10,
                    output_tokens=5,
                    total_tokens=15,
                    raw_json=raw if isinstance(raw, str) else json.dumps(raw),
                )
            )
        session.commit()


def _by_id(body: dict) -> dict[str, dict]:
    return {item["event_id"]: item for item in body["items"]}


def test_log_list_parses_original_model_from_attributes_json(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            (
                "evt_attr",
                _attr({"agw.ai.original_model": "pub-a", "gen_ai.request.stream": True}),
            )
        ],
    )
    row = _by_id(_browser(factory).get("/admin/logs").json())["evt_attr"]

    assert row["requested_model"] == "pub-a"
    # The ledger keeps recording the final upstream model in public_model: the
    # new display field must not rewrite attribution.
    assert row["public_model"] == "up-a"
    assert row["upstream_model"] == "up-a"


def test_requested_model_degrades_to_blank_instead_of_faking_a_public_name(
    engine_and_sessionmaker,
):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            # Old full-form direct row: no attributes_json column content at all.
            ("evt_old", {"trace_id": "t-old"}),
            # attributes_json exists but predates agw.ai.original_model.
            ("evt_no_key", _attr({"gen_ai.request.stream": False})),
            # Broken attributes_json text; must not raise or invent a name.
            ("evt_bad_attr", _attr("{not valid json")),
            # attributes_json that parses but is not an object.
            ("evt_attr_array", _attr([1, 2])),
            ("evt_null_attr", {"attributes_json": None}),
            # Non-string attribute values are not model names.
            ("evt_nonstring", _attr({"agw.ai.original_model": 7})),
            ("evt_empty_model", _attr({"agw.ai.original_model": ""})),
            # Broken raw_json and an empty raw_json row.
            ("evt_bad_raw", "not-json-at-all"),
            ("evt_empty_raw", ""),
        ],
    )
    body = _browser(factory).get("/admin/logs").json()
    rows = _by_id(body)

    assert body["total"] == 9
    for event_id, row in rows.items():
        assert row["requested_model"] == "", event_id
        # Never fall back to the ledger's recorded model.
        assert row["requested_model"] != row["public_model"], event_id


def test_log_detail_carries_requested_model_like_the_list(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed(factory, [("evt_attr", _attr({"agw.ai.original_model": "pub-a"}))])
    browser = _browser(factory)
    row = _by_id(browser.get("/admin/logs").json())["evt_attr"]
    detail = browser.get("/admin/logs/evt_attr").json()

    assert detail["requested_model"] == "pub-a"
    for key, value in row.items():
        assert detail.get(key) == value, key


def test_requested_model_does_not_need_payload_logging(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            (
                "evt_no_payload",
                _attr({"agw.ai.original_model": "pub-a", "gen_ai.request.stream": False}),
            )
        ],
    )
    with factory() as session:
        session.get(GatewayUsageEventORM, "evt_no_payload").raw_json = json.dumps(
            {
                "attributes_json": json.dumps({"agw.ai.original_model": "pub-a"}),
                "has_payload": False,
            }
        )
        session.commit()

    row = _by_id(_browser(factory).get("/admin/logs").json())["evt_no_payload"]
    assert row["has_payload"] is False
    assert row["requested_model"] == "pub-a"
