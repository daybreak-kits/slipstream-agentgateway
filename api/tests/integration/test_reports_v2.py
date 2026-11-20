"""Ticket 12 dashboard API v2: ranges, buckets, dimensions, heatmap, flow, latency.

All timestamps are pinned to 2026-03-10 12:00 Asia/Shanghai so local-midnight and
365d boundaries are deterministic; ranges are local-calendar based, which SQLite
strftime cannot express correctly, so these tests are the boundary guard.
"""

from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from tests.conftest import _app_client, make_admin, new_session_token

from l04_repo.orm import ChargeEntryORM, CostEntryORM, GatewayUsageEventORM, UserORM
from l06_api.deps import SESSION_COOKIE

TZ = ZoneInfo("Asia/Shanghai")
AT = int(datetime(2026, 3, 10, 12, 0, tzinfo=TZ).timestamp() * 1000)
DAY_MS = 86_400_000


def _local_ms(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> int:
    return int(datetime(year, month, day, hour, minute, tzinfo=TZ).timestamp() * 1000)


def _local_midnight(ms: int) -> int:
    local = datetime.fromtimestamp(ms / 1000, tz=TZ)
    return int(local.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


@pytest.fixture()
def fixed_now(monkeypatch):
    """Pin the route and aggregation clocks to AT (2026-03-10 12:00 +08)."""
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


def _custom_browser(admin_client, factory, name: str, permissions: list[str]):
    created = admin_client.post("/admin/roles", json={"name": name, "permissions": permissions})
    assert created.status_code == 201, created.text
    return _browser(factory, created.json()["key"], "u-" + name)


def _add_event(
    session,
    event_id: str,
    at_ms: int,
    *,
    public: str = "nebula-chat-1",
    upstream: str = "nebula-01",
    provider: str = "青岚云",
    ttft: int = 100,
    duration: int = 1000,
    input_tokens: int = 10,
    output_tokens: int = 5,
    cache_read: int = 0,
    cache_write: int = 0,
    cost: int | None = 800,
    charge: int | None = 1000,
    currency: str = "CNY",
    http_status: int = 200,
) -> None:
    session.add(
        GatewayUsageEventORM(
            event_id=event_id,
            started_at_ms=at_ms,
            completed_at_ms=at_ms + duration,
            duration_ms=duration,
            time_to_first_token_ms=ttft,
            http_status=http_status,
            public_model=public,
            upstream_model=upstream,
            provider=provider,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
            cache_read_tokens=cache_read,
            cache_write_tokens=cache_write,
        )
    )
    if cost is not None:
        session.add(
            CostEntryORM(
                id="co_" + event_id,
                gateway_event_id=event_id,
                amount_micro=cost,
                currency=currency,
                status="ok",
                created_at_ms=at_ms,
            )
        )
    if charge is not None:
        session.add(
            ChargeEntryORM(
                id="ce_" + event_id,
                gateway_event_id=event_id,
                user_id="usr_t12",
                amount_micro=charge,
                currency=currency,
                status="ok",
                created_at_ms=at_ms,
            )
        )


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
            _add_event(session, **spec)
        session.commit()


def _keys(payload) -> set[str]:
    found: set[str] = set()
    if isinstance(payload, dict):
        for key, value in payload.items():
            found.add(key)
            found |= _keys(value)
    elif isinstance(payload, list):
        for item in payload:
            found |= _keys(item)
    return found


def test_today_and_24h_local_bucket_boundaries(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    midnight = _local_midnight(AT)
    start_24h = midnight - 11 * 3_600_000  # 13:00 the previous local day
    assert start_24h == _local_ms(2026, 3, 9, 13, 0)
    _seed(
        factory,
        [
            {"event_id": "evt_today_in", "at_ms": midnight},
            {"event_id": "evt_today_out", "at_ms": midnight - 1},
            {"event_id": "evt_24h_in", "at_ms": start_24h},
            {"event_id": "evt_24h_out", "at_ms": start_24h - 1},
        ],
    )

    today = client.get("/admin/reports/timeseries?range=today&metric=requests").json()
    assert today["bucket"] == "hour"
    assert len(today["points"]) == 13  # 00:00 .. 12:00 inclusive
    assert today["points"][0]["bucket_start_ms"] == midnight
    assert today["points"][-1]["bucket_start_ms"] == _local_ms(2026, 3, 10, 12)
    assert today["metric_total"] == 1  # midnight is in, 1ms before is not

    rolling = client.get("/admin/reports/timeseries?range=24h&metric=requests").json()
    assert rolling["bucket"] == "hour"
    assert len(rolling["points"]) == 24
    assert rolling["points"][0]["bucket_start_ms"] == start_24h
    assert rolling["metric_total"] == 3  # 13:00, 23:59:59.999, midnight


@pytest.mark.parametrize(
    ("range_key", "days", "first_day"),
    [
        ("7d", 7, (2026, 3, 4)),
        ("30d", 30, (2026, 2, 9)),
        ("365d", 365, (2025, 3, 11)),
    ],
)
def test_day_ranges_include_exact_start_and_exclude_previous_ms(
    client, engine_and_sessionmaker, fixed_now, range_key, days, first_day
):
    _, factory = engine_and_sessionmaker
    start = _local_ms(*first_day)
    _seed(
        factory,
        [
            {"event_id": "evt_edge_in", "at_ms": start},
            {"event_id": "evt_edge_out", "at_ms": start - 1},
        ],
    )
    body = client.get(
        f"/admin/reports/timeseries?range={range_key}&bucket=day&metric=requests"
    ).json()
    assert body["bucket"] == "day"
    assert len(body["points"]) == days
    assert body["points"][0]["bucket_start_ms"] == start
    assert body["metric_total"] == 1


def test_timeseries_dimensions_money_and_topn(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {
                "event_id": "evt_a",
                "at_ms": AT - 1000,
                "public": "nebula-chat-1",
                "upstream": "nebula-01",
                "provider": "青岚云",
                "input_tokens": 10,
                "output_tokens": 5,
                "cost": 800,
                "charge": 1000,
            },
            {
                "event_id": "evt_b",
                "at_ms": AT - 2000,
                "public": "nebula-chat-2",
                "upstream": "nebula-02",
                "provider": "星环",
                "input_tokens": 100,
                "output_tokens": 50,
                "cost": 200,
                "charge": 300,
            },
        ],
    )

    combo = client.get(
        "/admin/reports/timeseries?range=7d&bucket=day&dimension=combo&metric=tokens"
    ).json()
    assert combo["dimension"] == "combo"
    assert {member["label"] for member in combo["members"]} == {
        "nebula-chat-1",
        "nebula-chat-2",
    }
    assert combo["metric_total"] == 165
    assert combo["totals"]["tokens"] == 165
    assert len(combo["points"]) == 7
    assert combo["points"][-1]["label"] == "2026-03-10"
    assert combo["points"][-1]["total"] == 165

    upstream = client.get(
        "/admin/reports/timeseries?range=7d&dimension=upstream&metric=requests"
    ).json()
    assert {member["label"] for member in upstream["members"]} == {
        "nebula-01",
        "nebula-02",
    }

    channel = client.get(
        "/admin/reports/timeseries?range=7d&dimension=channel&metric=requests"
    ).json()
    assert {member["label"] for member in channel["members"]} == {"青岚云", "星环"}

    money = client.get("/admin/reports/timeseries?range=7d&dimension=combo&metric=cost").json()
    assert money["metric"] == "cost_micro"
    assert money["metric_total"] == 1000
    assert money["totals"]["cost_micro"] == 1000
    assert money["totals"]["charge_micro"] == 1300
    assert sum(member["cost_micro"] for member in money["members"]) == 1000

    folded = client.get(
        "/admin/reports/timeseries?range=7d&dimension=combo&metric=requests&top_n=1"
    ).json()
    assert folded["folded_members"] == 1
    assert len(folded["members"]) == 2
    assert folded["members"][0]["id"] == "model:nebula-chat-1"
    assert folded["members"][1]["id"] == "other:combo"
    assert folded["members"][1]["label"] == "其他（1）"
    assert folded["metric_total"] == 2
    assert sum(point["total"] for point in folded["points"]) == 2


def test_latency_paired_samples_and_nearest_rank(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {"event_id": f"evt_p{i}", "at_ms": AT - (i + 1) * 1000, "ttft": ttft, "duration": dur}
            for i, (ttft, dur) in enumerate([(10, 100), (20, 200), (30, 300), (40, 400), (50, 500)])
        ]
        + [
            {"event_id": "evt_unpaired_ttft", "at_ms": AT - 6000, "ttft": 0, "duration": 999},
            {"event_id": "evt_unpaired_total", "at_ms": AT - 7000, "ttft": 7, "duration": 0},
        ],
    )
    body = client.get("/admin/reports/latency?range=7d").json()
    assert body["paired_samples"] == 5
    assert body["min_samples"] == 5
    assert body["ttft"] == {
        "samples": 5,
        "p50_ms": 30,
        "p75_ms": 40,
        "p95_ms": 50,
        "p99_ms": 50,
    }
    assert body["total"] == {
        "samples": 5,
        "p50_ms": 300,
        "p75_ms": 400,
        "p95_ms": 500,
        "p99_ms": 500,
    }


def test_latency_hides_quantiles_below_min_samples(client, engine_and_sessionmaker, fixed_now):
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
    assert body["paired_samples"] == 4
    assert body["ttft"] == {
        "samples": 4,
        "p50_ms": None,
        "p75_ms": None,
        "p95_ms": None,
        "p99_ms": None,
    }
    assert body["total"]["p50_ms"] is None
    assert body["total"]["p75_ms"] is None


def test_flow_has_five_stages_and_conserved_money(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    _seed(factory, [{"event_id": "evt_flow", "at_ms": AT - 1000, "cost": 800, "charge": 1000}])
    body = client.get("/admin/reports/flow").json()
    assert body["stages"] == [
        {"id": "user", "label": "用户"},
        {"id": "key", "label": "连接密钥"},
        {"id": "model", "label": "公开模型"},
        {"id": "upstream", "label": "上游模型"},
        {"id": "channel", "label": "上游"},
    ]
    assert len(body["links"]) == 4
    assert sum(link["requests"] for link in body["links"]) == 4
    assert sum(link["charge_micro"] for link in body["links"]) == 1000
    assert sum(link["cost_micro"] for link in body["links"]) == 800
    labels = {meta["label"] for meta in body["node_meta"].values()}
    assert {"晓岚", "nebula-chat-1", "nebula-01", "青岚云"} <= labels
    assert body["totals"] == {
        "requests": 1,
        "tokens": 15,
        "cost_micro": 800,
        "charge_micro": 1000,
    }


def test_flow_collapse_reconnects_the_remaining_stages(
    client, engine_and_sessionmaker, fixed_now
):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [{"event_id": "evt_flow_collapse", "at_ms": AT - 1000, "cost": 800, "charge": 1000}],
    )

    body = client.get("/admin/reports/flow?collapse=key").json()
    assert [stage["id"] for stage in body["stages"]] == ["user", "model", "upstream", "channel"]
    assert {node["stage"] for node in body["node_meta"].values()} == {
        "user",
        "model",
        "upstream",
        "channel",
    }
    assert len(body["links"]) == 3
    first = next(link for link in body["links"] if link["source"].startswith("user:"))
    last = next(link for link in body["links"] if link["target"].startswith("channel:"))
    assert first["target"].startswith("model:")
    assert sum(link["requests"] for link in body["links"]) == 3
    assert first["charge_micro"] == 1000
    assert last["cost_micro"] == 800
    assert body["totals"] == {"requests": 1, "tokens": 15, "cost_micro": 800, "charge_micro": 1000}


def test_flow_collapse_conserves_every_visible_edge_shape(
    client, engine_and_sessionmaker, fixed_now
):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [{"event_id": "evt_flow_edges", "at_ms": AT - 1000, "cost": 800, "charge": 1000}],
    )
    stages = ["user", "key", "model", "upstream", "channel"]
    prefixes = {
        "user": "user:",
        "key": "key:",
        "model": "model:",
        "upstream": "umodel:",
        "channel": "channel:",
    }
    original = client.get("/admin/reports/flow").json()
    assert len(original["links"]) == 4

    for mask in range(1, (1 << len(stages)) - 1):
        hidden = [stage for bit, stage in enumerate(stages) if mask & (1 << bit)]
        if len(hidden) > len(stages) - 2:
            continue
        body = client.get("/admin/reports/flow", params={"collapse": ",".join(hidden)}).json()
        visible = [stage for stage in stages if stage not in hidden]
        assert [stage["id"] for stage in body["stages"]] == visible
        assert len(body["links"]) == len(visible) - 1
        assert sum(link["requests"] for link in body["links"]) == 1 * (len(visible) - 1)
        first = next(
            link for link in body["links"] if link["source"].startswith(prefixes[visible[0]])
        )
        last = next(
            link for link in body["links"] if link["target"].startswith(prefixes[visible[-1]])
        )
        assert first["charge_micro"] == 1000
        assert last["cost_micro"] == 800
        assert sum(link["charge_micro"] for link in body["links"]) == 1000
        assert sum(link["cost_micro"] for link in body["links"]) == 800
        assert all(link["source"] != link["target"] for link in body["links"])


def test_flow_collapse_rejects_unknown_or_too_many_stages(client, fixed_now):
    unknown = client.get("/admin/reports/flow", params={"collapse": "nope,user"})
    assert unknown.status_code == 422
    detail = unknown.json()
    assert detail["code"] == "VALIDATION_ERROR"
    assert detail["details"]["collapse"] == ["nope"]
    assert detail["details"]["allowed"] == ["user", "key", "model", "upstream", "channel"]
    for raw in ("user,key,model,upstream", "user,key,model,upstream,channel"):
        too_many = client.get("/admin/reports/flow", params={"collapse": raw})
        assert too_many.status_code == 422
        assert too_many.json()["code"] == "VALIDATION_ERROR"
    # 恰好保留两段是合法下界：隐藏 3 段后 visible 只剩首末两段。
    lower_bound = client.get("/admin/reports/flow", params={"collapse": "user,key,model"})
    assert lower_bound.status_code == 200
    assert [stage["id"] for stage in lower_bound.json()["stages"]] == ["upstream", "channel"]


_FLOW_DEFAULT_GOLDEN = {
    "metric": "requests",
    "nodes": [
        "user:usr_t12",
        "key:none",
        "model:nebula-chat-1",
        "umodel:nebula-01",
        "channel:青岚云",
    ],
    "node_meta": {
        "user:usr_t12": {"id": "user:usr_t12", "label": "晓岚", "stage": "user", "value": 1},
        "key:none": {"id": "key:none", "label": "无密钥", "stage": "key", "value": 1},
        "model:nebula-chat-1": {
            "id": "model:nebula-chat-1",
            "label": "nebula-chat-1",
            "stage": "model",
            "value": 1,
        },
        "umodel:nebula-01": {
            "id": "umodel:nebula-01",
            "label": "nebula-01",
            "stage": "upstream",
            "value": 1,
        },
        "channel:青岚云": {
            "id": "channel:青岚云",
            "label": "青岚云",
            "stage": "channel",
            "value": 1,
        },
    },
    "links": [
        {
            "source": "key:none",
            "target": "model:nebula-chat-1",
            "requests": 1,
            "tokens": 15,
            "cost_micro": 0,
            "charge_micro": 0,
            "value": 1,
        },
        {
            "source": "model:nebula-chat-1",
            "target": "umodel:nebula-01",
            "requests": 1,
            "tokens": 15,
            "cost_micro": 0,
            "charge_micro": 0,
            "value": 1,
        },
        {
            "source": "umodel:nebula-01",
            "target": "channel:青岚云",
            "requests": 1,
            "tokens": 15,
            "cost_micro": 800,
            "charge_micro": 0,
            "value": 1,
        },
        {
            "source": "user:usr_t12",
            "target": "key:none",
            "requests": 1,
            "tokens": 15,
            "cost_micro": 0,
            "charge_micro": 1000,
            "value": 1,
        },
    ],
    "stages": [
        {"id": "user", "label": "用户"},
        {"id": "key", "label": "连接密钥"},
        {"id": "model", "label": "公开模型"},
        {"id": "upstream", "label": "上游模型"},
        {"id": "channel", "label": "上游"},
    ],
    "totals": {"requests": 1, "tokens": 15, "cost_micro": 800, "charge_micro": 1000},
    "currency": "CNY",
    "fx_missing": [],
    "estimate_note": "token amounts fold cache into input (stage B pending)",
    "range": "all",
    "from_ms": 0,
    "to_ms": 1773115200001,
    "timezone": "Asia/Shanghai",
}


def test_flow_default_payload_is_byte_identical_to_pre_collapse_golden(
    client, engine_and_sessionmaker, fixed_now
):
    """默认（不传 collapse）输出必须与 collapse 引入前逐字节一致。

    Golden 取自 collapse 之前的实现（HEAD e1c6220）对同一份种子的响应；任何
    默认路径的字段/顺序/取值变化都会在这里显形。
    """
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [{"event_id": "evt_flow_golden", "at_ms": AT - 1000, "cost": 800, "charge": 1000}],
    )
    body = client.get("/admin/reports/flow").json()
    assert json.dumps(body, sort_keys=True, ensure_ascii=False) == json.dumps(
        _FLOW_DEFAULT_GOLDEN, sort_keys=True, ensure_ascii=False
    )
    # 空 collapse / 只有分隔符的 collapse 等价于缺省，默认输出不因新参数而变化。
    for raw in ("", ",,", "  "):
        assert client.get("/admin/reports/flow", params={"collapse": raw}).json() == body


def test_flow_collapse_dedupes_and_ignores_blank_entries(
    client, engine_and_sessionmaker, fixed_now
):
    _, factory = engine_and_sessionmaker
    _seed(factory, [{"event_id": "evt_flow_dedupe", "at_ms": AT - 1000}])
    reference = client.get("/admin/reports/flow", params={"collapse": "key"}).json()
    for raw in ("key,key", "key, key", " key ", ",key,", ",,key"):
        body = client.get("/admin/reports/flow", params={"collapse": raw}).json()
        assert body == reference, raw
    default = client.get("/admin/reports/flow").json()
    for raw in ("", ",", ",,,", "   "):
        assert client.get("/admin/reports/flow", params={"collapse": raw}).json() == default, raw


def test_flow_collapse_conserves_multi_path_graph(client, engine_and_sessionmaker, fixed_now):
    """任意合法隐藏组合下节点/边守恒，金额只锚定首末可见边，totals 按完整路径累计。"""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {"event_id": "evt_mp1", "at_ms": AT - 1000},
            {
                "event_id": "evt_mp2",
                "at_ms": AT - 2000,
                "public": "nebula-chat-2",
                "upstream": "nebula-02",
                "cost": 300,
                "charge": 700,
            },
            {
                "event_id": "evt_mp3",
                "at_ms": AT - 3000,
                "public": "nebula-chat-2",
                "upstream": "nebula-03",
                "provider": "OpenRouter",
                "cost": 200,
                "charge": 400,
            },
        ],
    )
    stages = ["user", "key", "model", "upstream", "channel"]
    totals = {"requests": 3, "tokens": 45, "cost_micro": 1300, "charge_micro": 2100}
    full = client.get("/admin/reports/flow").json()
    nodes_by_stage = {
        stage: {node_id for node_id, meta in full["node_meta"].items() if meta["stage"] == stage}
        for stage in stages
    }

    for metric in ("requests", "tokens"):
        step = totals["requests"] if metric == "requests" else totals["tokens"]
        for mask in range(1, (1 << len(stages)) - 1):
            hidden = [stage for bit, stage in enumerate(stages) if mask & (1 << bit)]
            if len(hidden) > len(stages) - 2:
                continue  # 不足两段由 422 覆盖，不是投影输入
            visible = [stage for stage in stages if stage not in hidden]
            body = client.get(
                "/admin/reports/flow", params={"metric": metric, "collapse": ",".join(hidden)}
            ).json()

            assert body["totals"] == totals
            assert [stage["id"] for stage in body["stages"]] == visible
            meta = body["node_meta"]
            assert set(body["nodes"]) == set(meta)
            for stage in visible:
                assert {node_id for node_id, node in meta.items() if node["stage"] == stage} == (
                    nodes_by_stage[stage]
                )
            assert {node["stage"] for node in meta.values()} == set(visible)

            links = body["links"]
            pairs = [(link["source"], link["target"]) for link in links]
            assert len(set(pairs)) == len(pairs), "重复边应已合并"
            assert all(source != target for source, target in pairs), "投影后不允许自环"
            assert all(source in meta and target in meta for source, target in pairs)
            assert all(link["requests"] > 0 for link in links)
            value_field = "requests" if metric == "requests" else "tokens"
            assert all(link["value"] == link[value_field] for link in links)

            meta_stage = {node_id: node["stage"] for node_id, node in meta.items()}
            first_edges = [link for link in links if meta_stage[link["source"]] == visible[0]]
            last_edges = [link for link in links if meta_stage[link["target"]] == visible[-1]]
            assert sum(link["value"] for link in first_edges) == step
            assert sum(link["value"] for link in last_edges) == step
            assert sum(link["charge_micro"] for link in first_edges) == totals["charge_micro"]
            assert sum(link["cost_micro"] for link in last_edges) == totals["cost_micro"]
            assert sum(link["charge_micro"] for link in links) == totals["charge_micro"]
            assert sum(link["cost_micro"] for link in links) == totals["cost_micro"]

            in_sum: dict[str, int] = {}
            out_sum: dict[str, int] = {}
            for link in links:
                out_sum[link["source"]] = out_sum.get(link["source"], 0) + link["value"]
                in_sum[link["target"]] = in_sum.get(link["target"], 0) + link["value"]
            for node_id, node in meta.items():
                stage = node["stage"]
                if stage == visible[0]:
                    assert node["value"] == out_sum[node_id]
                    assert node_id not in in_sum
                elif stage == visible[-1]:
                    assert node["value"] == in_sum[node_id]
                    assert node_id not in out_sum
                else:
                    assert node["value"] == in_sum[node_id] == out_sum[node_id]


def test_heatmap_shapes_and_cells(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {
                "event_id": "evt_tue",
                "at_ms": _local_ms(2026, 3, 10, 11, 30),
                "input_tokens": 10,
                "output_tokens": 5,
                "cost": 800,
                "charge": 1000,
            },
            {
                "event_id": "evt_mon",
                "at_ms": _local_ms(2026, 3, 9, 23, 10),
                "input_tokens": 100,
                "output_tokens": 50,
                "cost": 200,
                "charge": 300,
            },
        ],
    )

    week = client.get("/admin/reports/heatmap?range=7d&metric=tokens").json()
    assert week["mode"] == "weekday_hour"
    assert len(week["columns"]) == 24
    assert len(week["rows"]) == 7
    assert week["rows"][1]["label"] == "周二"
    assert week["rows"][1]["values"][11] == 15
    assert week["rows"][0]["values"][23] == 150
    assert week["total"] == 165
    assert week["max"] == 150

    month = client.get("/admin/reports/heatmap?range=30d&metric=tokens").json()
    assert month["mode"] == "date_hour"
    assert len(month["rows"]) == 30
    assert month["rows"][0]["key"] == "2026-02-09"
    assert month["rows"][-1]["key"] == "2026-03-10"
    assert month["rows"][-1]["values"][11] == 15

    year = client.get("/admin/reports/heatmap?range=365d&metric=tokens").json()
    assert len(year["rows"]) == 365
    assert year["rows"][0]["key"] == "2025-03-11"
    assert year["rows"][-1]["key"] == "2026-03-10"

    cost = client.get("/admin/reports/heatmap?range=7d&metric=cost").json()
    assert cost["metric"] == "cost_micro"
    assert cost["rows"][1]["values"][11] == 800
    assert cost["total"] == 1000


def test_field_level_money_absence_and_presence(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    _seed(factory, [{"event_id": "evt_money", "at_ms": AT - 1000}])

    plain = _custom_browser(client, factory, "看板无金额", ["reports:read"])
    series = plain.get("/admin/reports/timeseries?range=7d&dimension=combo&metric=tokens").json()
    assert not ({"cost_micro", "charge_micro"} & _keys(series))
    heat = plain.get("/admin/reports/heatmap?range=7d&metric=tokens").json()
    assert not ({"cost_micro", "charge_micro"} & _keys(heat))
    flow = plain.get("/admin/reports/flow").json()
    assert not ({"cost_micro", "charge_micro"} & _keys(flow))

    cost_only = _custom_browser(client, factory, "看板仅成本", ["reports:read", "billing:cost"])
    cost_body = cost_only.get(
        "/admin/reports/timeseries?range=7d&dimension=combo&metric=cost"
    ).json()
    assert cost_body["totals"]["cost_micro"] == 800
    assert "cost_micro" in cost_body["members"][0]
    assert "charge_micro" not in cost_body["totals"]
    assert "charge_micro" not in cost_body["members"][0]

    spend_only = _custom_browser(client, factory, "看板仅花费", ["reports:read", "billing:spend"])
    spend_body = spend_only.get(
        "/admin/reports/timeseries?range=7d&dimension=combo&metric=spend"
    ).json()
    assert spend_body["totals"]["charge_micro"] == 1000
    assert "charge_micro" in spend_body["members"][0]
    assert "cost_micro" not in spend_body["totals"]
    assert "cost_micro" not in spend_body["members"][0]

    user_browser = _browser(factory, "user", "plain-v2-money")
    assert (
        user_browser.get(
            "/admin/reports/timeseries?range=7d&dimension=combo&metric=cost"
        ).status_code
        == 403
    )
    assert user_browser.get("/admin/reports/heatmap?range=7d&metric=cost").status_code == 403
    assert (
        user_browser.get(
            "/admin/reports/timeseries?range=7d&dimension=combo&metric=spend"
        ).status_code
        == 200
    )


def test_invalid_range_bucket_dimension_and_metric_are_422(
    client, engine_and_sessionmaker, fixed_now
):
    cases = [
        "/admin/reports/timeseries?range=90d",
        "/admin/reports/timeseries?range=7d&bucket=week",
        "/admin/reports/timeseries?range=7d&dimension=bogus",
        "/admin/reports/timeseries?range=7d&metric=bogus",
        "/admin/reports/timeseries?range=7d&metrics=bogus",
        "/admin/reports/timeseries?range=7d&metrics=cost,,charge",
        "/admin/reports/timeseries?range=7d&top_n=0",
        "/admin/reports/timeseries?range=365d&bucket=hour",
        "/admin/reports/heatmap?range=24h",
        "/admin/reports/heatmap?range=7d&metric=requests",
    ]
    for url in cases:
        response = client.get(url)
        assert response.status_code == 422, (url, response.text)
        assert response.json()["code"] == "VALIDATION_ERROR"


def test_overview_counts_errors_and_active_minutes(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    minute = 60_000
    _seed(
        factory,
        [
            {"event_id": "evt_ov_ok1", "at_ms": AT - 3 * minute},
            {"event_id": "evt_ov_ok2", "at_ms": AT - 3 * minute + 1000},
            {"event_id": "evt_ov_err", "at_ms": AT - 7 * minute, "cost": 0, "charge": None},
        ],
    )
    with factory() as session:
        # the failed event's http_status must be non-200 for this fixture
        row = session.get(GatewayUsageEventORM, "evt_ov_err")
        row.http_status = 503
        session.commit()

    body = client.get("/admin/reports/overview").json()
    assert body["requests"] == 3
    assert body["error_count"] == 1
    assert body["active_minutes"] == 2  # two distinct minutes, failures included


def test_timeseries_totals_carry_error_count_and_active_minutes(
    client, engine_and_sessionmaker, fixed_now
):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {"event_id": "evt_ts_ok", "at_ms": AT - 3 * 60_000},
            {"event_id": "evt_ts_err", "at_ms": AT - 7 * 60_000, "cost": 0, "charge": None},
        ],
    )
    with factory() as session:
        row = session.get(GatewayUsageEventORM, "evt_ts_err")
        row.http_status = 500
        session.commit()

    body = client.get("/admin/reports/timeseries?range=7d&bucket=day&metric=tokens").json()
    assert body["totals"]["error_count"] == 1
    assert body["totals"]["active_minutes"] == 2
    assert body["metrics"] == ["tokens"]
    # legacy totals keys stay intact
    assert body["totals"]["tokens"] == 30
    assert body["totals"]["requests"] == 2


def test_timeseries_totals_carry_minute_peaks(client, engine_and_sessionmaker, fixed_now):
    """peak_rpm/peak_tpm = busiest single LOCAL minute (GLOSSARY §5 「最高峰」).

    Distribution: minute AT-2min holds ten small requests (request peak);
    minute AT-1min holds one huge request (token peak) - each MAX must pick
    its own minute, not the busiest-by-the-other-metric one.
    """
    _, factory = engine_and_sessionmaker
    burst = [
        {
            "event_id": f"evt_peak_{index}",
            "at_ms": AT - 2 * 60_000,
            "input_tokens": 100,
            "output_tokens": 50,
        }
        for index in range(10)
    ]
    _seed(
        factory,
        [
            *burst,
            {
                "event_id": "evt_peak_heavy",
                "at_ms": AT - 60_000,
                "input_tokens": 10_000,
                "output_tokens": 5_000,
            },
        ],
    )

    body = client.get("/admin/reports/timeseries?range=7d&bucket=day&metric=requests").json()
    assert body["totals"]["peak_rpm"] == 10  # ten requests share one local minute
    assert body["totals"]["peak_tpm"] == 15_000  # the huge minute, not the busy one
    # peaks share the window/aggregation of the legacy totals keys
    assert body["totals"]["requests"] == 11
    assert body["totals"]["tokens"] == 16_500
    assert body["totals"]["active_minutes"] == 2

    # a window without events reports 0 peaks (MAX over an empty GROUP BY)
    empty = client.get(
        "/admin/reports/timeseries?range=7d&bucket=day&metric=requests"
        "&from_ms=1577836800000&to_ms=1577923200000"
    ).json()
    assert empty["totals"]["peak_rpm"] == 0
    assert empty["totals"]["peak_tpm"] == 0


def test_cache_token_totals_in_overview_and_timeseries(
    client, engine_and_sessionmaker, fixed_now
):
    """cache_read_tokens/cache_write_tokens are window sums of the event columns.

    Seeded per the folded口径 (input_tokens = net + cache, GLOSSARY §5):
    evt_cache_a net=10 cache_read=250 cache_write=10 -> input 270;
    evt_cache_b net=10 cache_read=100                -> input 110;
    evt_cache_c net=10, no cache                     -> input 10.
    """
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {
                "event_id": "evt_cache_a",
                "at_ms": AT - 60_000,
                "input_tokens": 270,
                "output_tokens": 50,
                "cache_read": 250,
                "cache_write": 10,
            },
            {
                "event_id": "evt_cache_b",
                "at_ms": AT - 120_000,
                "public": "nebula-chat-2",
                "input_tokens": 110,
                "output_tokens": 20,
                "cache_read": 100,
            },
            {"event_id": "evt_cache_c", "at_ms": AT - 180_000},
        ],
    )

    overview = client.get("/admin/reports/overview").json()
    # hand-computed: 250 + 100 + 0 read, 10 + 0 + 0 write
    assert overview["cache_read_tokens"] == 350
    assert overview["cache_write_tokens"] == 10
    # input_tokens keeps the folded口径; the frontend derives net input from it
    assert overview["input_tokens"] == 390
    net = overview["input_tokens"] - overview["cache_read_tokens"] - overview["cache_write_tokens"]
    assert net == 30

    # every metric combination carries the same two totals keys (shape stable)
    for url in (
        "/admin/reports/timeseries?range=7d&bucket=day&metric=requests",
        "/admin/reports/timeseries?range=7d&bucket=day&metric=tokens",
        "/admin/reports/timeseries?range=7d&bucket=day&metrics=cost_micro,charge_micro",
    ):
        body = client.get(url).json()
        assert body["totals"]["cache_read_tokens"] == 350, url
        assert body["totals"]["cache_write_tokens"] == 10, url
    # legacy totals keys stay intact next to the new ones
    assert body["totals"]["input_tokens"] == 390
    assert body["totals"]["requests"] == 3


def test_timeseries_multi_metric_one_roundtrip(client, engine_and_sessionmaker, fixed_now):
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            {"event_id": "evt_mm_a", "at_ms": AT - 1000, "cost": 800, "charge": 1000},
            {
                "event_id": "evt_mm_b",
                "at_ms": AT - 2000,
                "public": "nebula-chat-2",
                "cost": 200,
                "charge": 300,
            },
        ],
    )

    body = client.get(
        "/admin/reports/timeseries?range=7d&bucket=day&metrics=cost_micro,charge_micro"
    ).json()
    assert body["metrics"] == ["cost_micro", "charge_micro"]
    assert body["metric"] == "cost_micro"  # first series drives the legacy fields
    assert body["metric_total"] == 1000
    assert body["totals"]["cost_micro"] == 1000
    assert body["totals"]["charge_micro"] == 1300
    for member in body["members"]:
        assert member["totals"]["cost_micro"] == member["cost_micro"]
        assert member["totals"]["charge_micro"] == member["charge_micro"]
    assert sum(member["totals"]["charge_micro"] for member in body["members"]) == 1300
    last = body["points"][-1]
    assert last["total"] == 1000
    for values in last["values"].values():
        assert set(values) == {"cost_micro", "charge_micro"}

    # singular metric keeps the flat legacy shape (values are plain ints)
    single = client.get("/admin/reports/timeseries?range=7d&bucket=day&metric=cost").json()
    assert "metrics" in single
    assert all(isinstance(v, int) for v in single["points"][-1]["values"].values())
    assert single["totals"]["cost_micro"] == 1000

    # metrics aliases (cost/spend) canonicalise into the same series
    aliased = client.get("/admin/reports/timeseries?range=7d&bucket=day&metrics=cost,spend").json()
    assert aliased["metrics"] == ["cost_micro", "charge_micro"]

    # money permission still applies per requested series
    plain = _custom_browser(client, factory, "看板多指标", ["reports:read"])
    assert (
        plain.get("/admin/reports/timeseries?range=7d&metrics=cost_micro,charge_micro").status_code
        == 403
    )
    spend_only = _custom_browser(
        client, factory, "看板仅花费多指标", ["reports:read", "billing:spend"]
    )
    assert (
        spend_only.get(
            "/admin/reports/timeseries?range=7d&metrics=cost_micro,charge_micro"
        ).status_code
        == 403
    )
    both = _custom_browser(
        client,
        factory,
        "看板双权限多指标",
        ["reports:read", "billing:cost", "billing:spend"],
    )
    granted = both.get("/admin/reports/timeseries?range=7d&metrics=cost,spend")
    assert granted.status_code == 200
    assert granted.json()["metrics"] == ["cost_micro", "charge_micro"]
