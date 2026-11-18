"""Ticket F dashboard v3: explicit from_ms/to_ms windows on the four report routes.

latency/timeseries/heatmap/flow accept an optional from_ms/to_ms pair (epoch
ms) that overrides the range enum; one alone or an invalid pair is a 422.
Times are pinned to 2026-03-10 12:00 Asia/Shanghai like the ticket-12 suite,
so every bucket count below is hand-computed against the local calendar
(2026-03-02/03-09 are Mondays, 03-08 is a Sunday).
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from l04_repo.orm import ChargeEntryORM, CostEntryORM, GatewayUsageEventORM, UserORM

TZ = ZoneInfo("Asia/Shanghai")
AT = int(datetime(2026, 3, 10, 12, 0, tzinfo=TZ).timestamp() * 1000)
DAY_MS = 86_400_000


def _local_ms(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> int:
    return int(datetime(year, month, day, hour, minute, tzinfo=TZ).timestamp() * 1000)


@pytest.fixture()
def fixed_now(monkeypatch):
    import l05_service.aggregates as aggregates
    import l06_api.routers_reports as reports

    monkeypatch.setattr(aggregates, "now_ms", lambda: AT)
    monkeypatch.setattr(reports, "now_ms", lambda: AT)
    return AT


def _seed(factory, events: list[dict]) -> None:
    with factory() as session:
        if session.get(UserORM, "usr_t12") is None:
            session.add(
                UserORM(
                    id="usr_t12",
                    name="晓岚",
                    balance_micro=50_000_000,
                    created_at_ms=AT,
                )
            )
        for spec in events:
            event_id = spec["event_id"]
            at_ms = spec["at_ms"]
            duration = spec.get("duration", 1000)
            session.add(
                GatewayUsageEventORM(
                    event_id=event_id,
                    started_at_ms=at_ms,
                    completed_at_ms=at_ms + duration,
                    duration_ms=duration,
                    time_to_first_token_ms=spec.get("ttft", 100),
                    http_status=200,
                    public_model="nebula-chat-1",
                    upstream_model="nebula-01",
                    provider="青岚云",
                    input_tokens=spec.get("input_tokens", 10),
                    output_tokens=spec.get("output_tokens", 5),
                    total_tokens=spec.get("input_tokens", 10) + spec.get("output_tokens", 5),
                )
            )
            session.add(
                CostEntryORM(
                    id="co_" + event_id,
                    gateway_event_id=event_id,
                    amount_micro=800,
                    currency="CNY",
                    status="ok",
                    created_at_ms=at_ms,
                )
            )
            session.add(
                ChargeEntryORM(
                    id="ce_" + event_id,
                    gateway_event_id=event_id,
                    user_id="usr_t12",
                    amount_micro=1000,
                    currency="CNY",
                    status="ok",
                    created_at_ms=at_ms,
                )
            )
        session.commit()


# ------------------------------------------------------------------ timeseries


def test_timeseries_auto_hour_buckets_for_short_span(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    window_from = _local_ms(2026, 3, 10, 0, 0)  # 12h span -> <=48h -> hour buckets
    window_to = _local_ms(2026, 3, 10, 12, 0)
    _seed(
        factory,
        [
            {"event_id": "evt_in", "at_ms": _local_ms(2026, 3, 10, 9, 30)},
            {"event_id": "evt_after", "at_ms": _local_ms(2026, 3, 10, 13, 0)},
            {"event_id": "evt_before", "at_ms": _local_ms(2026, 3, 9, 23, 59)},
        ],
    )
    body = client.get(
        f"/admin/reports/timeseries?from_ms={window_from}&to_ms={window_to}&metric=requests"
    ).json()
    assert body["range"] == "custom"
    assert body["from_ms"] == window_from
    assert body["to_ms"] == window_to
    assert body["bucket"] == "hour"
    assert len(body["points"]) == 13  # 00:00 .. 12:00 inclusive, hand-computed
    assert body["points"][0]["bucket_start_ms"] == window_from
    assert body["points"][-1]["bucket_start_ms"] == window_to
    assert body["metric_total"] == 1


def test_timeseries_auto_day_buckets_beyond_48h_and_explicit_bucket_wins(
    client, engine_and_sessionmaker, fixed_now
):
    _, factory = engine_and_sessionmaker
    window_from = _local_ms(2026, 3, 8, 6, 0)  # 54h span -> day buckets
    window_to = _local_ms(2026, 3, 10, 12, 0)
    _seed(
        factory,
        [
            {"event_id": "evt_d1", "at_ms": _local_ms(2026, 3, 8, 10, 0)},
            {"event_id": "evt_d2", "at_ms": _local_ms(2026, 3, 7, 20, 0)},
        ],
    )
    body = client.get(
        f"/admin/reports/timeseries?from_ms={window_from}&to_ms={window_to}&metric=requests"
    ).json()
    assert body["bucket"] == "day"
    assert len(body["points"]) == 3  # local days 03-08, 03-09, 03-10
    assert body["points"][0]["bucket_start_ms"] == _local_ms(2026, 3, 8)
    assert body["points"][-1]["label"] == "2026-03-10"
    assert body["metric_total"] == 1

    # an explicit bucket parameter still beats the span-derived auto choice
    hourly = client.get(
        f"/admin/reports/timeseries?from_ms={window_from}&to_ms={window_to}&bucket=hour"
        "&metric=requests"
    ).json()
    assert hourly["bucket"] == "hour"


def test_timeseries_explicit_window_overrides_range_enum(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    window_from = _local_ms(2026, 3, 10, 9, 0)
    window_to = _local_ms(2026, 3, 10, 11, 0)
    _seed(
        factory,
        [
            {"event_id": "evt_w", "at_ms": _local_ms(2026, 3, 10, 9, 30)},
            {"event_id": "evt_out_7d", "at_ms": _local_ms(2026, 3, 10, 8, 0)},
        ],
    )
    body = client.get(
        f"/admin/reports/timeseries?range=7d&from_ms={window_from}&to_ms={window_to}"
        "&metric=requests"
    ).json()
    assert body["range"] == "custom"
    assert body["metric_total"] == 1  # the 7d event outside the window is dropped

    # the enum is fully overridden: even a bogus range key no longer validates
    bogus = client.get(
        f"/admin/reports/timeseries?range=bogus&from_ms={window_from}&to_ms={window_to}"
        "&metric=requests"
    )
    assert bogus.status_code == 200
    assert bogus.json()["range"] == "custom"


# --------------------------------------------------------------------- heatmap


def test_heatmap_short_span_keeps_weekday_hour_layout(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    window_from = _local_ms(2026, 3, 9, 0, 0)  # Mon 00:00, 36h span -> weekday×hour
    window_to = _local_ms(2026, 3, 10, 12, 0)
    _seed(
        factory,
        [
            {"event_id": "evt_mon", "at_ms": _local_ms(2026, 3, 9, 23, 10),
             "input_tokens": 100, "output_tokens": 50},
            {"event_id": "evt_tue", "at_ms": _local_ms(2026, 3, 10, 11, 30)},
            {"event_id": "evt_sun_out", "at_ms": _local_ms(2026, 3, 8, 12, 0)},
        ],
    )
    body = client.get(
        f"/admin/reports/heatmap?from_ms={window_from}&to_ms={window_to}&metric=tokens"
    ).json()
    assert body["range"] == "custom"
    assert body["mode"] == "weekday_hour"
    assert len(body["rows"]) == 7
    assert body["rows"][0]["values"][23] == 150  # Mon 23:xx cell
    assert body["rows"][1]["values"][11] == 15  # Tue 11:xx cell
    assert body["total"] == 165
    assert body["max"] == 150


def test_heatmap_span_exactly_seven_days_is_weekday_hour(
    client, engine_and_sessionmaker, fixed_now
):
    _, factory = engine_and_sessionmaker
    window_from = _local_ms(2026, 3, 2, 0, 0)  # Mon -> next Mon, exactly 7d
    window_to = _local_ms(2026, 3, 9, 0, 0)
    _seed(factory, [{"event_id": "evt_sun", "at_ms": _local_ms(2026, 3, 8, 23, 10)}])
    body = client.get(
        f"/admin/reports/heatmap?from_ms={window_from}&to_ms={window_to}&metric=tokens"
    ).json()
    assert body["mode"] == "weekday_hour"
    assert body["rows"][6]["values"][23] == 15  # Sunday row


def test_heatmap_long_span_uses_one_row_per_covered_local_day(
    client, engine_and_sessionmaker, fixed_now
):
    _, factory = engine_and_sessionmaker
    window_from = _local_ms(2026, 3, 1, 12, 0)  # 9d span -> date×hour
    window_to = _local_ms(2026, 3, 10, 12, 0)
    _seed(
        factory,
        [{"event_id": "evt_h", "at_ms": _local_ms(2026, 3, 5, 8, 0),
          "input_tokens": 20, "output_tokens": 5}],
    )
    body = client.get(
        f"/admin/reports/heatmap?from_ms={window_from}&to_ms={window_to}&metric=tokens"
    ).json()
    assert body["mode"] == "date_hour"
    assert len(body["rows"]) == 10  # local days 03-01 .. 03-10 even with a mid-day start
    assert body["rows"][0]["key"] == "2026-03-01"
    assert body["rows"][-1]["key"] == "2026-03-10"
    assert body["rows"][0]["label"] == "03-01"  # <= 30 rows keep short labels
    assert body["rows"][4]["values"][8] == 25
    assert body["total"] == 25
    assert body["max"] == 25


# --------------------------------------------------------------------- latency


def test_latency_paired_rule_survives_custom_window(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    window_from = _local_ms(2026, 3, 10, 10, 0)
    window_to = _local_ms(2026, 3, 10, 12, 0)
    _seed(
        factory,
        [
            {"event_id": f"evt_p{i}", "at_ms": _local_ms(2026, 3, 10, 10, 30) + i * 600_000,
             "ttft": ttft, "duration": dur}
            for i, (ttft, dur) in enumerate([(10, 100), (20, 200), (30, 300), (40, 400), (50, 500)])
        ]
        + [
            {"event_id": "evt_paired_out", "at_ms": _local_ms(2026, 3, 10, 9, 0),
             "ttft": 60, "duration": 600},
            {"event_id": "evt_unpaired", "at_ms": _local_ms(2026, 3, 10, 11, 50),
             "ttft": 0, "duration": 999},
        ],
    )
    body = client.get(f"/admin/reports/latency?from_ms={window_from}&to_ms={window_to}").json()
    assert body["range"] == "custom"
    assert body["from_ms"] == window_from
    assert body["to_ms"] == window_to
    assert body["paired_samples"] == 5
    assert body["ttft"] == {"samples": 5, "p50_ms": 30, "p75_ms": 40, "p95_ms": 50, "p99_ms": 50}
    assert body["total"]["p50_ms"] == 300
    assert body["total"]["p95_ms"] == 500


# ------------------------------------------------------------------------ flow


def test_flow_link_aggregation_follows_custom_window(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    window_from = _local_ms(2026, 3, 10, 10, 0)
    window_to = _local_ms(2026, 3, 10, 12, 0)
    _seed(
        factory,
        [
            {"event_id": "evt_f1", "at_ms": _local_ms(2026, 3, 10, 10, 30)},
            {"event_id": "evt_f2", "at_ms": _local_ms(2026, 3, 10, 9, 0)},
        ],
    )
    body = client.get(f"/admin/reports/flow?from_ms={window_from}&to_ms={window_to}").json()
    assert body["range"] == "custom"
    assert body["from_ms"] == window_from
    assert body["to_ms"] == window_to
    assert body["totals"] == {
        "requests": 1,
        "tokens": 15,
        "cost_micro": 800,
        "charge_micro": 1000,
    }
    # one five-stage path folds into four edges, each carrying the full count
    assert sum(link["requests"] for link in body["links"]) == 4
    assert sum(link["tokens"] for link in body["links"]) == 60


# ------------------------------------------------------------------- validation


@pytest.mark.parametrize("endpoint", ["latency", "timeseries", "heatmap", "flow"])
@pytest.mark.parametrize(
    ("param", "value"),
    [("from_ms", str(_local_ms(2026, 3, 10, 0, 0))), ("to_ms", str(AT))],
)
def test_half_window_is_422(client, engine_and_sessionmaker, fixed_now, endpoint, param, value):
    response = client.get(f"/admin/reports/{endpoint}?{param}={value}")
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("endpoint", ["latency", "timeseries", "heatmap", "flow"])
def test_span_over_366_days_is_422(client, engine_and_sessionmaker, fixed_now, endpoint):
    response = client.get(f"/admin/reports/{endpoint}?from_ms=0&to_ms={366 * DAY_MS + 1}")
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_span_of_exactly_366_days_is_allowed(client, engine_and_sessionmaker, fixed_now):
    response = client.get(f"/admin/reports/timeseries?from_ms=0&to_ms={366 * DAY_MS}")
    assert response.status_code == 200, response.text
    assert response.json()["range"] == "custom"


@pytest.mark.parametrize(
    "query",
    [
        # from >= to
        f"from_ms={_local_ms(2026, 3, 10, 0, 0)}&to_ms={_local_ms(2026, 3, 10, 0, 0)}",
        f"from_ms={_local_ms(2026, 3, 10, 2, 0)}&to_ms={_local_ms(2026, 3, 10, 1, 0)}",
        # negative timestamps are not a valid epoch window
        f"from_ms=-1&to_ms={AT}",
        f"from_ms={AT}&to_ms=-5",
    ],
)
def test_invalid_window_pairs_are_422(client, engine_and_sessionmaker, fixed_now, query):
    response = client.get(f"/admin/reports/timeseries?{query}")
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_non_integer_window_value_hits_shared_422_envelope(
    client, engine_and_sessionmaker, fixed_now
):
    response = client.get(f"/admin/reports/heatmap?from_ms=abc&to_ms={AT}")
    assert response.status_code == 422, response.text
    payload = response.json()
    assert payload["code"] == "VALIDATION_ERROR"
    assert payload["message"] == "request validation failed"
    assert "request_id" in payload


# ------------------------------------------------- enum compatibility regression


def test_without_window_params_enum_behaviour_is_untouched(
    client, engine_and_sessionmaker, fixed_now
):
    series = client.get("/admin/reports/timeseries?range=7d&bucket=day&metric=requests").json()
    assert series["range"] == "7d"
    assert series["bucket"] == "day"
    assert len(series["points"]) == 7
    assert series["points"][0]["bucket_start_ms"] == _local_ms(2026, 3, 4)

    heat = client.get("/admin/reports/heatmap?range=7d&metric=tokens").json()
    assert heat["range"] == "7d"
    assert heat["mode"] == "weekday_hour"
    assert len(heat["rows"]) == 7

    latency = client.get("/admin/reports/latency?range=7d").json()
    assert latency["range"] == "7d"
    assert latency["from_ms"] == _local_ms(2026, 3, 4)

    flow = client.get("/admin/reports/flow").json()
    assert flow["range"] == "all"

    flow_week = client.get("/admin/reports/flow?range=7d").json()
    assert flow_week["range"] == "7d"


def test_365d_hour_restriction_survives_only_on_the_enum_path(
    client, engine_and_sessionmaker, fixed_now
):
    response = client.get("/admin/reports/timeseries?range=365d&bucket=hour")
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"

    # custom windows have no 365d tier, so an explicit hour bucket stays allowed
    window_from = _local_ms(2026, 3, 10, 9, 0)
    window_to = _local_ms(2026, 3, 10, 12, 0)
    ok = client.get(
        f"/admin/reports/timeseries?range=365d&bucket=hour&from_ms={window_from}"
        f"&to_ms={window_to}"
    )
    assert ok.status_code == 200
    assert ok.json()["bucket"] == "hour"
