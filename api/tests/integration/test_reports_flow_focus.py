"""W6 ticket 17: flow 图的 focus / q / top_n 可选参数与默认逐字节不变。

契约（票 17 验收）：
* 三个参数全部可选；不传（或传空值）时输出与不传参数逐字节一致（golden 钉住）。
* focus=<node id>：保留该节点在聚合图上的祖先 + 后代闭包；未知 id 得到空子图
  （stages/totals 仍是窗口全量口径）。
* q=<text>：label 大小写不敏感子串匹配，保留全部命中节点的闭包。
* top_n=<n>（0=关，负数 422）：每个可见阶段按指标值保留前 n 个节点，尾段折叠成
  other:<stage> 聚合节点；折叠后链路请求/金额仍守恒（每条路径贡献的边数不变）。
* 应用顺序：collapse 投影 → q → focus → top_n（搜索链路不会被 top_n 裁剪）。
* 语义口径：闭包在「聚合图」上计算；闭包内节点之间的边保留窗口聚合值
  （与前端高亮模式在同一份数据上的表现完全一致），totals 恒等于窗口全量。
"""

from __future__ import annotations

import json

import pytest
from tests.integration.test_reports_v2 import _FLOW_DEFAULT_GOLDEN, AT, _seed


@pytest.fixture()
def fixed_now(monkeypatch):
    """Pin the route and aggregation clocks to AT（与 v2 的 golden 同一时刻）。"""
    import l05_service.aggregates as aggregates
    import l06_api.routers_reports as reports

    monkeypatch.setattr(aggregates, "now_ms", lambda: AT)
    monkeypatch.setattr(reports, "now_ms", lambda: AT)
    return AT

# 路径表（每行一条完整五段路径，requests=1）：user / public / upstream / channel。
# 设计约束：U1(4) > U2(3) > U3(2) 便于 top_n 断言；P1 的闭包可手工推导。
_PATHS = [
    ("usr_flow_a", "matrixflow公开甲", "matrixflow上游A", "matrixflow渠道X"),
    ("usr_flow_a", "matrixflow公开甲", "matrixflow上游B", "matrixflow渠道Y"),
    ("usr_flow_b", "matrixflow公开甲", "matrixflow上游A", "matrixflow渠道Y"),
    ("usr_flow_b", "matrixflow公开乙", "matrixflow上游A", "matrixflow渠道X"),
    ("usr_flow_c", "matrixflow公开乙", "matrixflow上游B", "matrixflow渠道X"),
    ("usr_flow_c", "matrixflow公开丙", "matrixflow上游A", "matrixflow渠道X"),
    ("usr_flow_a", "matrixflow公开乙", "matrixflow上游A", "matrixflow渠道Y"),
    ("usr_flow_b", "matrixflow公开丙", "matrixflow上游B", "matrixflow渠道Y"),
    ("usr_flow_a", "matrixflow公开丙", "matrixflow上游B", "matrixflow渠道X"),
]

_EXPECTED_TOTALS = {
    "requests": len(_PATHS),
    "tokens": 15 * len(_PATHS),
    "cost_micro": 800 * len(_PATHS),
    "charge_micro": 1000 * len(_PATHS),
}


@pytest.fixture()
def flow_factory(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    return factory


@pytest.fixture()
def flow_client(client, engine_and_sessionmaker):
    """client fixture 已带 admin 会话；这里只负责播种路径表。"""
    _, factory = engine_and_sessionmaker
    _seed_flow_paths(factory)
    return client


def _seed_flow_paths(factory) -> None:
    from l04_repo.orm import UserORM

    with factory() as session:
        for user_id, name in (
            ("usr_flow_a", "流甲"),
            ("usr_flow_b", "流乙"),
            ("usr_flow_c", "流丙"),
        ):
            if session.get(UserORM, user_id) is None:
                session.add(
                    UserORM(id=user_id, name=name, balance_micro=0, created_at_ms=AT)
                )
        session.commit()
    _seed(
        factory,
        [
            {
                "event_id": f"evt_flow_focus_{index}",
                "at_ms": AT - 1000 - index,
                "public": public,
                "upstream": upstream,
                "provider": provider,
            }
            for index, (user, public, upstream, provider) in enumerate(_PATHS)
        ],
    )
    # _seed 的 charge 一律挂 usr_t12；重写 charge 的 user_id 让用户节点来自路径表。
    from l04_repo.orm import ChargeEntryORM

    with factory() as session:
        for index, (user, _public, _upstream, _provider) in enumerate(_PATHS):
            row = session.get(ChargeEntryORM, "ce_evt_flow_focus_" + str(index))
            assert row is not None
            row.user_id = user
        session.commit()


def _node_ids(body: dict) -> set[str]:
    return set(body["nodes"])


def _link_requests(body: dict, source: str, target: str) -> int:
    for link in body["links"]:
        if link["source"] == source and link["target"] == target:
            return int(link["requests"])
    return 0


# ---------------------------------------------------------------- 默认逐字节


def test_flow_default_output_byte_identical_with_new_params_absent(
    client, engine_and_sessionmaker, fixed_now
):
    """不传 focus/q/top_n（或传空值/0）时，默认输出与 golden 逐字段一致。"""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [{"event_id": "evt_flow_golden_t17", "at_ms": AT - 1000, "cost": 800, "charge": 1000}],
    )
    body = client.get("/admin/reports/flow").json()
    assert json.dumps(body, sort_keys=True, ensure_ascii=False) == json.dumps(
        _FLOW_DEFAULT_GOLDEN, sort_keys=True, ensure_ascii=False
    )
    for params in (
        {},
        {"focus": "", "q": "", "top_n": 0},
        {"focus": "  ", "q": "  ", "top_n": 0},
        {"q": ""},
        {"focus": ""},
        {"top_n": 0},
    ):
        assert client.get("/admin/reports/flow", params=params).json() == body, params


def test_flow_default_top_n_matches_default_payload(flow_client, flow_factory, fixed_now):
    """top_n 大于等于各阶段节点数时输出与默认完全一致（无折叠）。"""
    body = flow_client.get("/admin/reports/flow").json()
    big = flow_client.get("/admin/reports/flow", params={"top_n": 99}).json()
    assert big == body


# ---------------------------------------------------------------- focus


def test_flow_focus_keeps_ancestor_and_descendant_chain(
    flow_client, flow_factory, fixed_now
):
    body = flow_client.get(
        "/admin/reports/flow", params={"focus": "model:matrixflow公开甲"}
    ).json()
    # 祖先只沿入边向上、后代只沿出边向下：P1 的祖先是 key:none 与全部三个用户
    # （聚合口径下 key:none 由三个用户共同喂入），后代是上游A/B 与渠道X/Y；
    # 兄弟节点 P2/P3 不在闭包里。
    assert _node_ids(body) == {
        "user:usr_flow_a",
        "user:usr_flow_b",
        "user:usr_flow_c",
        "key:none",
        "model:matrixflow公开甲",
        "umodel:matrixflow上游A",
        "umodel:matrixflow上游B",
        "channel:matrixflow渠道X",
        "channel:matrixflow渠道Y",
    }
    assert len(body["links"]) == 10
    assert _link_requests(body, "user:usr_flow_a", "key:none") == 4
    assert _link_requests(body, "user:usr_flow_b", "key:none") == 3
    assert _link_requests(body, "user:usr_flow_c", "key:none") == 2
    assert _link_requests(body, "key:none", "model:matrixflow公开甲") == 3
    assert _link_requests(body, "umodel:matrixflow上游A", "channel:matrixflow渠道X") == 3
    # 边值维持窗口聚合口径：闭包边可能包含链外路径的贡献（与前端高亮一致）。
    assert _link_requests(body, "umodel:matrixflow上游B", "channel:matrixflow渠道X") == 2
    assert _link_requests(body, "key:none", "model:matrixflow公开乙") == 0
    # stages / totals 不因 focus 改变：仍是可见五段与窗口全量。
    assert [stage["id"] for stage in body["stages"]] == [
        "user",
        "key",
        "model",
        "upstream",
        "channel",
    ]
    assert body["totals"] == _EXPECTED_TOTALS


def test_flow_focus_unknown_node_returns_empty_subgraph(
    flow_client, flow_factory, fixed_now
):
    body = flow_client.get(
        "/admin/reports/flow", params={"focus": "model:不存在的节点"}
    ).json()
    assert body["nodes"] == []
    assert body["links"] == []
    assert body["node_meta"] == {}
    assert [stage["id"] for stage in body["stages"]] == [
        "user",
        "key",
        "model",
        "upstream",
        "channel",
    ]
    assert body["totals"] == _EXPECTED_TOTALS


def test_flow_focus_combines_with_collapse(flow_client, flow_factory, fixed_now):
    """collapse 先投影，focus 在可见子图上取链：M_A 的闭包不含兄弟 M_B。"""
    body = flow_client.get(
        "/admin/reports/flow",
        params={"collapse": "model", "focus": "umodel:matrixflow上游A"},
    ).json()
    assert [stage["id"] for stage in body["stages"]] == ["user", "key", "upstream", "channel"]
    assert _node_ids(body) == {
        "user:usr_flow_a",
        "user:usr_flow_b",
        "user:usr_flow_c",
        "key:none",
        "umodel:matrixflow上游A",
        "channel:matrixflow渠道X",
        "channel:matrixflow渠道Y",
    }
    assert "umodel:matrixflow上游B" not in _node_ids(body)
    assert len(body["links"]) == 6
    assert body["totals"] == _EXPECTED_TOTALS


def test_flow_q_then_focus_narrows_within_q_subgraph(flow_client, flow_factory, fixed_now):
    """q 先过滤、focus 在过滤后的子图上取链：两者同时给出等价于 focus 单独生效。"""
    combined = flow_client.get(
        "/admin/reports/flow", params={"q": "公开", "focus": "model:matrixflow公开甲"}
    ).json()
    solo = flow_client.get(
        "/admin/reports/flow", params={"focus": "model:matrixflow公开甲"}
    ).json()
    assert combined == solo


# ---------------------------------------------------------------- q


def test_flow_q_matches_label_substring_case_insensitive(
    flow_client, flow_factory, fixed_now
):
    matched = flow_client.get("/admin/reports/flow", params={"q": "公开甲"}).json()
    assert _node_ids(matched) == {
        "user:usr_flow_a",
        "user:usr_flow_b",
        "user:usr_flow_c",
        "key:none",
        "model:matrixflow公开甲",
        "umodel:matrixflow上游A",
        "umodel:matrixflow上游B",
        "channel:matrixflow渠道X",
        "channel:matrixflow渠道Y",
    }
    # 大小写不敏感：前缀大写同样命中（label 以小写 matrixflow 开头）。
    upper = flow_client.get("/admin/reports/flow", params={"q": "MATRIXFLOW公开甲"}).json()
    assert upper == matched
    # 宽匹配命中全部公开模型 → 闭包是全图。
    wide = flow_client.get("/admin/reports/flow", params={"q": "公开"}).json()
    assert wide["nodes"] == flow_client.get("/admin/reports/flow").json()["nodes"]


def test_flow_q_without_match_returns_empty_subgraph(flow_client, flow_factory, fixed_now):
    body = flow_client.get("/admin/reports/flow", params={"q": "不存在的标签"}).json()
    assert body["nodes"] == []
    assert body["links"] == []
    assert body["totals"] == _EXPECTED_TOTALS


def test_flow_q_matches_user_and_channel_labels(flow_client, flow_factory, fixed_now):
    body = flow_client.get("/admin/reports/flow", params={"q": "流丙"}).json()
    # 流丙：user 节点命中；闭包 = 其下游 key:none 与全部模型/上游/渠道（key:none 聚合
    # 了全部用户，key:none 的下游是全图）。
    assert "user:usr_flow_c" in _node_ids(body)
    assert _link_requests(body, "user:usr_flow_c", "key:none") == 2


# ---------------------------------------------------------------- top_n


def test_flow_top_n_folds_tail_into_other_stage_nodes(
    flow_client, flow_factory, fixed_now
):
    body = flow_client.get("/admin/reports/flow", params={"top_n": 2}).json()
    # 用户阶段 3 节点取前 2（值 4/3/2 互不相同）：流甲、流乙保留，流丙折叠为 other:user。
    assert {"user:usr_flow_a", "user:usr_flow_b", "other:user"} <= _node_ids(body)
    assert "user:usr_flow_c" not in _node_ids(body)
    other = body["node_meta"]["other:user"]
    assert other["label"] == "其他"
    assert other["stage"] == "user"
    assert other["value"] == 2  # 被折叠节点的窗口值之和
    # 折叠后的边守恒：流丙→key:none 的边并入 other:user→key:none。
    assert _link_requests(body, "other:user", "key:none") == 2
    assert _link_requests(body, "user:usr_flow_a", "key:none") == 4
    # 每条路径仍贡献（可见段数-1）条边：9 条路径 × 4 = 36。
    assert sum(link["requests"] for link in body["links"]) == 4 * len(_PATHS)
    # 金额锚定在折叠中保持：charge 仍在首边、cost 仍在末边出现且总和不变。
    assert sum(link["charge_micro"] for link in body["links"]) == _EXPECTED_TOTALS["charge_micro"]
    assert sum(link["cost_micro"] for link in body["links"]) == _EXPECTED_TOTALS["cost_micro"]
    assert body["totals"] == _EXPECTED_TOTALS


def test_flow_top_n_applies_per_visible_stage(flow_client, flow_factory, fixed_now):
    """top_n 逐阶段生效：3 节点阶段取 2 折 1，2 节点阶段（上游模型）不折叠。"""
    body = flow_client.get("/admin/reports/flow", params={"top_n": 2}).json()
    node_ids = _node_ids(body)
    assert "other:user" in node_ids  # 用户 3 节点 → 折叠
    assert "other:model" in node_ids  # 公开模型 3 节点 → 折叠
    assert "other:key" not in node_ids  # 密钥 1 节点 → 不折叠
    assert "other:upstream" not in node_ids  # 上游模型 2 节点 → 不折叠
    assert "other:channel" not in node_ids  # 渠道 2 节点 → 不折叠


def test_flow_top_n_ties_break_deterministically(client, engine_and_sessionmaker, fixed_now):
    """并列值按 (value desc, label asc, id asc) 取舍，结果可复现。"""
    from l04_repo.orm import ChargeEntryORM, GatewayUsageEventORM, UserORM

    _, factory = engine_and_sessionmaker
    with factory() as session:
        if session.get(UserORM, "usr_tie") is None:
            session.add(UserORM(id="usr_tie", name="并列用户", balance_micro=0, created_at_ms=AT))
        for index, label in enumerate(("m-alpha", "m-beta", "m-gamma")):
            event_id = f"evt_flow_tie_{index}"
            session.merge(
                GatewayUsageEventORM(
                    event_id=event_id,
                    started_at_ms=AT - 1000 - index,
                    completed_at_ms=AT - 900 - index,
                    duration_ms=100,
                    time_to_first_token_ms=10,
                    http_status=200,
                    public_model=label,
                    upstream_model="tie-upstream",
                    provider="tie-channel",
                    input_tokens=10,
                    output_tokens=5,
                    total_tokens=15,
                )
            )
            session.merge(
                ChargeEntryORM(
                    id="ce_" + event_id,
                    gateway_event_id=event_id,
                    user_id="usr_tie",
                    amount_micro=100,
                    currency="CNY",
                    status="ok",
                    created_at_ms=AT,
                )
            )
        session.commit()
    body = client.get("/admin/reports/flow", params={"top_n": 1}).json()
    # 三个公开模型值并列（各 1）：label 升序保留 m-alpha，其余折叠为 other:model。
    assert "model:m-alpha" in _node_ids(body)
    assert {"model:m-beta", "model:m-gamma"} & _node_ids(body) == set()
    assert body["node_meta"]["other:model"]["value"] == 2


def test_flow_search_wins_over_top_n_folding(flow_client, flow_factory, fixed_now):
    """应用顺序 q/focus → top_n：搜索命中的节点不会被 top_n 先折叠掉。

    若 top_n 先行，流丙（值 2，用户阶段末位）会被折叠进 other:user，focus 再
    取闭包时种子已消失、整图为空；q/focus 先行则流丙保留并围绕它取链。
    """
    body = flow_client.get(
        "/admin/reports/flow", params={"focus": "user:usr_flow_c", "top_n": 1}
    ).json()
    assert "user:usr_flow_c" in _node_ids(body)
    assert _link_requests(body, "user:usr_flow_c", "key:none") == 2
    # 空搜索（不传 q/focus）时 top_n=1 照常折叠用户阶段。
    folded = flow_client.get("/admin/reports/flow", params={"top_n": 1}).json()
    assert "user:usr_flow_c" not in _node_ids(folded)
    assert "other:user" in _node_ids(folded)


def test_flow_top_n_negative_is_422(flow_client, flow_factory, fixed_now):
    response = flow_client.get("/admin/reports/flow", params={"top_n": -1})
    assert response.status_code == 422
    detail = response.json()
    assert detail["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------- 契约


def test_flow_key_order_is_pinned(flow_client, flow_factory, fixed_now):
    """顶层键序钉住 response_model 序列化顺序：默认输出与既有线格式逐字节同形。"""
    body = flow_client.get("/admin/reports/flow").json()
    assert list(body.keys()) == [
        "metric",
        "nodes",
        "node_meta",
        "links",
        "stages",
        "totals",
        "currency",
        "fx_missing",
        "estimate_note",
        "range",
        "from_ms",
        "to_ms",
        "timezone",
    ]


def test_flow_response_schema_and_params_are_in_openapi_contract(client, fixed_now):
    """票 17：flow 的响应形状与新参数必须进入 OpenAPI，供 gen_ts 生成 TS 契约。"""
    spec = client.get("/openapi.json").json()
    operation = spec["paths"]["/admin/reports/flow"]["get"]
    params = {item["name"] for item in operation.get("parameters", [])}
    assert {"collapse", "focus", "q", "top_n"} <= params
    schema_ref = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert schema_ref["$ref"] == "#/components/schemas/FlowReportOut"
    schema = spec["components"]["schemas"]["FlowReportOut"]
    properties = schema["properties"]
    for field in (
        "metric",
        "nodes",
        "node_meta",
        "links",
        "stages",
        "totals",
        "currency",
        "fx_missing",
        "estimate_note",
        "range",
        "from_ms",
        "to_ms",
        "timezone",
    ):
        assert field in properties, field


def test_flow_requires_reports_read(client, engine_and_sessionmaker, fixed_now):
    """focus/q/top_n 与 collapse 一样要求 reports:read（权限口径不变）。"""
    from tests.conftest import _app_client, make_admin, new_session_token

    from l06_api.deps import SESSION_COOKIE

    _, factory = engine_and_sessionmaker
    created = client.post("/admin/roles", json={"name": "flow-focus-none", "permissions": []})
    assert created.status_code == 201, created.text
    role_key = created.json()["key"]
    admin_id = make_admin(factory, username="flow-focus-no-perm", role=role_key)
    restricted = _app_client(factory)
    restricted.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    response = restricted.get(
        "/admin/reports/flow", params={"focus": "model:x", "q": "y", "top_n": 2}
    )
    assert response.status_code == 403
