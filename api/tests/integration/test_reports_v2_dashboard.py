"""Ticket 13 dashboard v2 (UI) contract: currency, range honouring, empty-range safety.

The dashboard renders every money figure in the payload's report currency, reuses
the same endpoints while the range chips change, and must never print NaN when a
range has no traffic. Those are UI guarantees that ticket 12's suite does not pin.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from tests.conftest import _app_client, make_admin, new_session_token

from l04_repo.orm import ChargeEntryORM, CostEntryORM, GatewayUsageEventORM, UserORM
from l06_api.deps import SESSION_COOKIE

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


def _browser(factory, role: str, username: str):
    admin_id = make_admin(factory, username=username, role=role)
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client


def _seed(factory, events: list[dict]) -> None:
    with factory() as session:
        if session.get(UserORM, "usr_t12") is None:
            session.add(
                UserORM(id="usr_t12", name="晓岚", balance_micro=50_000_000, created_at_ms=AT)
            )
        for spec in events:
            event_id = spec["event_id"]
            at_ms = spec["at_ms"]
            tokens = spec.get("input_tokens", 10) + spec.get("output_tokens", 5)
            session.add(
                GatewayUsageEventORM(
                    event_id=event_id,
                    started_at_ms=at_ms,
                    completed_at_ms=at_ms + 1000,
                    duration_ms=1000,
                    time_to_first_token_ms=100,
                    http_status=200,
                    public_model="nebula-chat-1",
                    upstream_model="nebula-01",
                    provider="青岚云",
                    input_tokens=spec.get("input_tokens", 10),
                    output_tokens=spec.get("output_tokens", 5),
                    total_tokens=tokens,
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


def test_money_payloads_carry_report_currency(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    _seed(factory, [{"event_id": "evt_cur", "at_ms": AT - 1000}])

    for path in (
        "/admin/reports/timeseries?range=7d&metric=tokens",
        "/admin/reports/heatmap?range=7d&metric=tokens",
        "/admin/reports/flow?range=7d&metric=requests",
    ):
        response = client.get(path)
        assert response.status_code == 200, response.text
        assert response.json()["currency"] == "CNY", path
        assert "NaN" not in response.text and "Infinity" not in response.text, path


def test_heatmap_money_metric_follows_permissions(
    client, engine_and_sessionmaker, fixed_now
):
    _, factory = engine_and_sessionmaker
    _seed(factory, [{"event_id": "evt_perm", "at_ms": AT - 1000}])

    for metric in ("cost", "spend"):
        assert client.get(f"/admin/reports/heatmap?range=7d&metric={metric}").status_code == 200

    # 普通用户有 billing:spend、没有 billing:cost：花费可看，成本必须拒绝。
    viewer = _browser(factory, "user", "u-dash")
    assert viewer.get("/admin/reports/heatmap?range=7d&metric=spend").status_code == 200
    assert viewer.get("/admin/reports/heatmap?range=7d&metric=cost").status_code == 403


def test_range_chips_filter_every_card(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {"event_id": "evt_in_1", "at_ms": AT - 1000},
            {"event_id": "evt_in_2", "at_ms": AT - 2 * DAY_MS},
            # 视窗外：40 天前，7d/30d 都不应统计
            {"event_id": "evt_out", "at_ms": AT - 40 * DAY_MS},
        ],
    )

    series = client.get("/admin/reports/timeseries?range=7d&metric=tokens").json()
    assert series["metric_total"] == 30

    flow = client.get("/admin/reports/flow?range=7d&metric=requests").json()
    assert flow["totals"]["requests"] == 2

    heat7 = client.get("/admin/reports/heatmap?range=7d&metric=tokens").json()
    assert heat7["total"] == 30
    assert heat7["max"] > 0

    # 40 天前那条只在 365d 视窗里，7d/30d 都必须排除。
    heat30 = client.get("/admin/reports/heatmap?range=30d&metric=tokens").json()
    assert heat30["total"] == 30
    heat365 = client.get("/admin/reports/heatmap?range=365d&metric=tokens").json()
    assert heat365["total"] == 45


def test_empty_range_renders_zeros_not_nan(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    _seed(factory, [{"event_id": "evt_old", "at_ms": AT - 40 * DAY_MS}])

    series = client.get("/admin/reports/timeseries?range=7d&metric=tokens").json()
    assert len(series["points"]) == 7
    assert all(point["total"] == 0 for point in series["points"])
    assert series["members"] == []
    assert series["metric_total"] == 0

    heat = client.get("/admin/reports/heatmap?range=7d&metric=tokens").json()
    assert heat["max"] == 0
    assert heat["total"] == 0

    flow = client.get("/admin/reports/flow?range=7d&metric=requests").json()
    assert flow["links"] == []
    assert flow["totals"]["requests"] == 0
