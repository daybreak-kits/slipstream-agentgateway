"""Log requested_model (ticket 05): normalized by the adapter, never re-parsed.

The AG wire row records the final upstream model in the ledger's public_model
column and carries the client-facing name in wire attributes; the adapter
decodes it into UsageEvent.requested_model at ingest time (ADR-029). The log
API only reads the neutral column: old/legacy rows and rows without the fact
degrade to an empty string (rendered as "-"), never to a made-up public name.
"""

from __future__ import annotations

from tests.conftest import _app_client, make_admin, new_session_token

from l01_core.timeutil import now_ms
from l02_domain.models import UsageEvent
from l04_repo.orm import GatewayUsageEventORM
from l05_service.usage_ingest import ingest_usage_events
from l06_api.deps import SESSION_COOKIE


def _browser(factory):
    admin_id = make_admin(factory, username="logs-requested", role="admin")
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client


def _ingest(factory, events: list[UsageEvent]) -> None:
    with factory() as session:
        assert ingest_usage_events(session, events) == len(events)
        session.commit()


def _seed_legacy(factory, event_ids: list[str]) -> None:
    """Insert pre-neutrality rows directly: no requested_model fact, only the
    recorded models — exactly what an old demo database looks like after init."""
    now = now_ms()
    with factory() as session:
        for index, event_id in enumerate(event_ids):
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
                )
            )
        session.commit()


def _by_id(body: dict) -> dict[str, dict]:
    return {item["event_id"]: item for item in body["items"]}


def test_log_list_serves_the_adapter_normalized_requested_model(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _ingest(
        factory,
        [
            UsageEvent(
                event_id="evt_norm",
                started_at_ms=now_ms() - 10_000,
                completed_at_ms=now_ms() - 9_000,
                duration_ms=1000,
                http_status=200,
                requested_model="pub-a",
                public_model="up-a",
                upstream_model="up-a",
                provider="testv",
                input_tokens=10,
                output_tokens=5,
                total_tokens=15,
            )
        ],
    )
    row = _by_id(_browser(factory).get("/admin/logs").json())["evt_norm"]

    assert row["requested_model"] == "pub-a"
    # The ledger keeps recording the final upstream model in public_model: the
    # display field must not rewrite attribution.
    assert row["public_model"] == "up-a"
    assert row["upstream_model"] == "up-a"


def test_requested_model_degrades_to_blank_instead_of_faking_a_public_name(
    engine_and_sessionmaker,
):
    _, factory = engine_and_sessionmaker
    _seed_legacy(
        factory,
        [
            # Pre-neutrality row: the adapter never normalized a requested model.
            "evt_old",
        ],
    )
    _ingest(
        factory,
        [
            # Ingested fact without a requested model (adapter could not answer).
            UsageEvent(
                event_id="evt_no_fact",
                started_at_ms=now_ms() - 5_000,
                duration_ms=10,
                http_status=200,
                public_model="up-a",
                upstream_model="up-a",
                provider="testv",
            )
        ],
    )
    body = _browser(factory).get("/admin/logs").json()
    rows = _by_id(body)

    assert body["total"] == 2
    for event_id, row in rows.items():
        assert row["requested_model"] == "", event_id
        # Never fall back to the ledger's recorded model.
        assert row["requested_model"] != row["public_model"], event_id


def test_log_detail_carries_requested_model_like_the_list(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _ingest(
        factory,
        [
            UsageEvent(
                event_id="evt_attr",
                started_at_ms=now_ms() - 10_000,
                duration_ms=1000,
                http_status=200,
                requested_model="pub-a",
                public_model="up-a",
                upstream_model="up-a",
                provider="testv",
            )
        ],
    )
    browser = _browser(factory)
    row = _by_id(browser.get("/admin/logs").json())["evt_attr"]
    detail = browser.get("/admin/logs/evt_attr").json()

    assert detail["requested_model"] == "pub-a"
    for key, value in row.items():
        assert detail.get(key) == value, key


def test_streaming_and_payload_facts_come_from_the_normalized_columns(
    engine_and_sessionmaker,
):
    _, factory = engine_and_sessionmaker
    _ingest(
        factory,
        [
            UsageEvent(
                event_id="evt_streamed",
                started_at_ms=now_ms() - 10_000,
                duration_ms=1000,
                time_to_first_token_ms=400,
                http_status=200,
                requested_model="pub-a",
                public_model="up-a",
                upstream_model="up-a",
                provider="testv",
                is_stream=True,
                has_payload=True,
            )
        ],
    )
    row = _by_id(_browser(factory).get("/admin/logs").json())["evt_streamed"]

    assert row["is_stream"] is True
    assert row["has_payload"] is True
    assert row["requested_model"] == "pub-a"


def test_stream_verdict_falls_back_to_ttft_when_the_adapter_gave_none(
    engine_and_sessionmaker,
):
    """Rows without an explicit streaming verdict stay derivable from TTFT."""
    _, factory = engine_and_sessionmaker
    _ingest(
        factory,
        [
            UsageEvent(
                event_id="evt_ttft_only",
                started_at_ms=now_ms() - 10_000,
                duration_ms=1000,
                time_to_first_token_ms=400,
                http_status=200,
                public_model="up-a",
                upstream_model="up-a",
                provider="testv",
                is_stream=None,
            )
        ],
    )
    row = _by_id(_browser(factory).get("/admin/logs").json())["evt_ttft_only"]
    assert row["is_stream"] is True
