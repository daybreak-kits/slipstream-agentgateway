"""W4-F: the latency report's all-sample block and the default all-time window.

The ``all`` block anchors the log page's semantic colour (DESIGN-AUDIT §11):
same window as the paired blocks but WITHOUT the ttft>0/duration>0 pairing
filter, p50/p75/p95 nearest-rank, nulled below MIN_PERCENTILE_SAMPLES per
block. The window rule changes too: neither from_ms/to_ms nor range now means
all-time (0=全时段) instead of the old 7d enum default. Times are pinned to
2026-03-10 12:00 Asia/Shanghai like the other report suites, so every quantile
below is hand-computed against the nearest-rank formula.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from l04_repo.orm import GatewayUsageEventORM, UserORM

TZ = ZoneInfo("Asia/Shanghai")
AT = int(datetime(2026, 3, 10, 12, 0, tzinfo=TZ).timestamp() * 1000)
DAY_MS = 86_400_000


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
                UserORM(id="usr_t12", name="晓岚", balance_micro=50_000_000, created_at_ms=AT)
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
                    input_tokens=10,
                    output_tokens=5,
                    total_tokens=15,
                )
            )
        session.commit()


def test_all_block_includes_non_streaming_paired_keeps_legacy(
    client, engine_and_sessionmaker, fixed_now
):
    """ttft=0 non-streaming rows feed ``all`` but never the paired blocks."""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {"event_id": f"evt_p{i}", "at_ms": AT - (i + 1) * 1000, "ttft": ttft, "duration": dur}
            for i, (ttft, dur) in enumerate([(10, 100), (20, 200), (30, 300), (40, 400), (50, 500)])
        ]
        + [
            # the ticket's case: a non-streaming request (ttft=0) with a real duration
            {"event_id": "evt_nonstream", "at_ms": AT - 6000, "ttft": 0, "duration": 999},
            {"event_id": "evt_ttft_only", "at_ms": AT - 7000, "ttft": 7, "duration": 0},
            {"event_id": "evt_zeroed", "at_ms": AT - 8000, "ttft": 0, "duration": 0},
        ],
    )
    body = client.get("/admin/reports/latency?range=7d").json()
    # 8 events in the window, only the 5 paired ones enter the legacy calibre
    assert body["paired_samples"] == 5
    assert body["all"]["samples"] == 8
    # all-sample ttft: sorted [0, 0, 7, 10, 20, 30, 40, 50] -> ranks 4/6/8
    assert body["all"]["ttft"] == {"samples": 8, "p50_ms": 10, "p75_ms": 30, "p95_ms": 50}
    # all-sample total: sorted [0, 0, 100, 200, 300, 400, 500, 999] -> ranks 4/6/8
    assert body["all"]["total"] == {"samples": 8, "p50_ms": 200, "p75_ms": 400, "p95_ms": 999}
    # the all block pins the three tone anchors - no p99 read on this calibre
    assert set(body["all"]["ttft"]) == {"samples", "p50_ms", "p75_ms", "p95_ms"}
    # paired blocks stay byte-identical to the pre-W4-F shape and values
    assert body["ttft"] == {"samples": 5, "p50_ms": 30, "p75_ms": 40, "p95_ms": 50, "p99_ms": 50}
    assert body["total"] == {
        "samples": 5,
        "p50_ms": 300,
        "p75_ms": 400,
        "p95_ms": 500,
        "p99_ms": 500,
    }


def test_all_block_gates_independently_of_paired(client, engine_and_sessionmaker, fixed_now):
    """all.samples >= paired.samples, so all can be non-null while paired is null."""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {"event_id": f"evt_p{i}", "at_ms": AT - (i + 1) * 1000, "ttft": ttft, "duration": dur}
            for i, (ttft, dur) in enumerate([(10, 100), (20, 200), (30, 300)])
        ]
        + [
            {"event_id": "evt_u1", "at_ms": AT - 4000, "ttft": 0, "duration": 111},
            {"event_id": "evt_u2", "at_ms": AT - 5000, "ttft": 0, "duration": 222},
            {"event_id": "evt_u3", "at_ms": AT - 6000, "ttft": 0, "duration": 333},
        ],
    )
    body = client.get("/admin/reports/latency?range=7d").json()
    # 3 paired samples < MIN_PERCENTILE_SAMPLES: paired quantiles stay null
    assert body["paired_samples"] == 3
    assert body["ttft"]["p50_ms"] is None
    assert body["total"]["p95_ms"] is None
    # 6 all-sample >= 5: the new block quantifies anyway
    # ttft sorted [0, 0, 0, 10, 20, 30] -> ranks 3/5/6; total sorted
    # [100, 111, 200, 222, 300, 333] -> ranks 3/5/6
    assert body["all"]["ttft"] == {"samples": 6, "p50_ms": 0, "p75_ms": 20, "p95_ms": 30}
    assert body["all"]["total"] == {"samples": 6, "p50_ms": 200, "p75_ms": 300, "p95_ms": 333}


def test_all_block_below_min_samples_is_null(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {
                "event_id": f"evt_low{i}",
                "at_ms": AT - (i + 1) * 1000,
                "ttft": 10 + i,
                "duration": 100 + i,
            }
            for i in range(4)
        ],
    )
    body = client.get("/admin/reports/latency?range=7d").json()
    assert body["all"]["samples"] == 4
    assert body["all"]["ttft"] == {"samples": 4, "p50_ms": None, "p75_ms": None, "p95_ms": None}
    assert body["all"]["total"]["p50_ms"] is None


def test_latency_without_window_or_range_is_all_time(client, engine_and_sessionmaker, fixed_now):
    """The bare endpoint (W4-F default) covers the full calibre, not the 7d enum."""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            # 40 days old: a 7d window would drop it, all-time keeps it
            {"event_id": "evt_old", "at_ms": AT - 40 * DAY_MS, "ttft": 10, "duration": 100},
        ]
        + [
            {
                "event_id": f"evt_recent{i}",
                "at_ms": AT - (i + 1) * 1000,
                "ttft": ttft,
                "duration": dur,
            }
            for i, (ttft, dur) in enumerate([(20, 200), (30, 300), (40, 400), (50, 500)])
        ]
        + [
            {"event_id": "evt_unpaired", "at_ms": AT - 6000, "ttft": 0, "duration": 909},
        ],
    )
    response = client.get("/admin/reports/latency")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["range"] == "all"
    assert body["from_ms"] == 0
    assert body["to_ms"] == 0
    # all-time: the 40-day-old event counts too (a 7d window would drop it)
    assert body["all"]["samples"] == 6
    # ttft sorted [0, 10, 20, 30, 40, 50] -> ranks 3/5/6; total sorted
    # [100, 200, 300, 400, 500, 909] -> ranks 3/5/6
    assert body["all"]["ttft"] == {"samples": 6, "p50_ms": 20, "p75_ms": 40, "p95_ms": 50}
    assert body["all"]["total"] == {"samples": 6, "p50_ms": 300, "p75_ms": 500, "p95_ms": 909}
    assert body["paired_samples"] == 5

    # an explicit range still keeps the enum behaviour byte-identical
    week = client.get("/admin/reports/latency?range=7d").json()
    assert week["range"] == "7d"
    assert week["all"]["samples"] == 5


def test_latency_all_time_covers_events_outside_every_enum(
    client, engine_and_sessionmaker, fixed_now
):
    """全时段 equals the /admin/logs default window: no started_at clause at all."""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {"event_id": "evt_ancient", "at_ms": AT - 400 * DAY_MS, "ttft": 5, "duration": 50},
            {"event_id": "evt_now", "at_ms": AT - 1, "ttft": 15, "duration": 150},
        ],
    )
    body = client.get("/admin/reports/latency").json()
    assert body["all"]["samples"] == 2
    # 2 samples < MIN_PERCENTILE_SAMPLES: coverage is full but quantiles stay null
    assert body["all"]["ttft"] == {"samples": 2, "p50_ms": None, "p75_ms": None, "p95_ms": None}
    assert body["paired_samples"] == 2


def test_latency_half_window_still_422(client, engine_and_sessionmaker, fixed_now):
    response = client.get("/admin/reports/latency?from_ms=123")
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"

    response = client.get(f"/admin/reports/latency?to_ms={AT}")
    assert response.status_code == 422, response.text


def test_overview_latency_embeds_all_block(client, engine_and_sessionmaker, fixed_now):
    """overview_stats calls latency_report, so the overview payload gains it too."""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {"event_id": "evt_ov1", "at_ms": AT - 1000, "ttft": 10, "duration": 100},
            {"event_id": "evt_ov2", "at_ms": AT - 2000, "ttft": 0, "duration": 300},
            {"event_id": "evt_ov3", "at_ms": AT - 3000, "ttft": 30, "duration": 200},
            {"event_id": "evt_ov4", "at_ms": AT - 4000, "ttft": 20, "duration": 400},
            {"event_id": "evt_ov5", "at_ms": AT - 5000, "ttft": 40, "duration": 500},
        ],
    )
    body = client.get("/admin/reports/overview").json()
    latency = body["latency"]
    assert latency["paired_samples"] == 4  # evt_ov2 is non-streaming
    assert latency["all"]["samples"] == 5
    # ttft sorted [0, 10, 20, 30, 40] -> rank 3 = 20; total sorted
    # [100, 200, 300, 400, 500] -> rank 3 = 300
    assert latency["all"]["ttft"]["p50_ms"] == 20
    assert latency["all"]["total"]["p50_ms"] == 300
