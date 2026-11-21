"""Ticket 17 user-level bills: scope, time window and field permissions."""

from __future__ import annotations

from tests.conftest import _app_client, make_admin, new_session_token

from l01_core.timeutil import now_ms
from l04_repo.orm import ChargeEntryORM, CostEntryORM, PublicModelORM, UserORM
from l06_api.deps import SESSION_COOKIE

DAY_MS = 86_400_000


def _add_entry(
    session,
    event_id: str,
    user_id: str,
    at_ms: int,
    *,
    cost: int | None = 50,
    charge: int | None = 100,
) -> None:
    status = "ok" if charge is not None else "unpriced"
    session.add(
        ChargeEntryORM(
            id="ce_" + event_id,
            gateway_event_id=event_id,
            user_id=user_id,
            public_model_id="pmdl_test",
            input_tokens=10,
            output_tokens=5,
            amount_micro=charge,
            currency="CNY",
            price_version_id=None,
            status=status,
            created_at_ms=at_ms,
        )
    )
    if cost is not None or charge is None:
        session.add(
            CostEntryORM(
                id="co_" + event_id,
                gateway_event_id=event_id,
                amount_micro=cost,
                currency="CNY",
                price_version_id=None,
                status="ok" if cost is not None else "unpriced",
                created_at_ms=at_ms,
            )
        )


def test_self_and_subtree_scope_include_only_visible_users(client, engine_and_sessionmaker):
    """ADR-019：登录即用户行；代理的子树锚定在其自身 users.id 上。"""
    _, factory = engine_and_sessionmaker
    root_id = client.get("/admin/users/tree").json()["root_id"]
    now = now_ms()
    agent_admin = make_admin(factory, username="bill-agent", role="reseller", user_id="u_agent")
    with factory() as session:
        session.add(PublicModelORM(id="pmdl_test", name="flagship", created_at_ms=now))
        session.add_all(
            [
                UserORM(
                    id="u_child",
                    name="下级乙",
                    role="customer",
                    parent_user_id="u_agent",
                    created_at_ms=now,
                ),
                UserORM(
                    id="u_sibling",
                    name="兄弟丙",
                    role="customer",
                    parent_user_id=root_id,
                    created_at_ms=now,
                ),
            ]
        )
        _add_entry(session, "e_agent", "u_agent", now, cost=50, charge=100)
        _add_entry(session, "e_child", "u_child", now, cost=80, charge=200)
        _add_entry(session, "e_sibling", "u_sibling", now, cost=160, charge=400)
        session.commit()

    agent = _app_client(factory)
    agent.cookies.set(SESSION_COOKIE, new_session_token(factory, agent_admin))

    self_body = agent.get("/admin/bills/my-spend?range=30d&scope=self").json()
    assert self_body["scope"] == "self"
    assert self_body["user"]["id"] == "u_agent"
    assert self_body["summary"]["charge_micro"] == 100
    # 代理用户没有 billing:cost：成本/毛利键必须不存在，而不是 null。
    assert "cost_micro" not in self_body["summary"]
    assert "margin_micro" not in self_body["summary"]
    assert [row["id"] for row in self_body["by_user"]] == ["u_agent"]

    subtree = agent.get("/admin/bills/my-spend?range=30d&scope=subtree").json()
    assert subtree["scope"] == "subtree"
    assert subtree["all_users"] is False
    assert subtree["summary"]["charge_micro"] == 300
    assert "cost_micro" not in subtree["summary"]
    assert "margin_micro" not in subtree["summary"]
    assert {row["id"] for row in subtree["by_user"]} == {"u_agent", "u_child"}
    assert {row["name"] for row in subtree["by_model"]} == {"flagship"}

    selected = agent.get(
        "/admin/bills/my-spend?range=30d&scope=subtree&user_id=u_child"
    ).json()
    assert selected["user"]["id"] == "u_child"
    assert selected["summary"]["charge_micro"] == 200
    assert agent.get(
        "/admin/bills/my-spend?range=30d&scope=subtree&user_id=u_sibling"
    ).status_code == 403

    # 管理用户: subtree means every user, not just its own consumer node.
    all_users = client.get("/admin/bills/my-spend?range=30d&scope=subtree").json()
    assert all_users["all_users"] is True
    assert all_users["user"] is None
    assert all_users["summary"]["charge_micro"] == 700
    assert all_users["summary"]["cost_micro"] == 290
    assert all_users["summary"]["margin_micro"] == 410
    assert {row["id"] for row in all_users["by_user"]} == {
        "u_agent",
        "u_child",
        "u_sibling",
    }

    # The owner's own node exists under ADR-019; its self report is a valid
    # empty report (zero spend) instead of 403/500.
    unbound = client.get("/admin/bills/my-spend?range=30d&scope=self").json()
    assert unbound["summary"]["charge_micro"] == 0


def test_plain_user_sees_own_spend_without_cost_fields(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    root_id = client.get("/admin/users/tree").json()["root_id"]
    now = now_ms()
    plain_admin = make_admin(factory, username="bill-plain", role="customer", user_id="u_plain")
    with factory() as session:
        session.add_all(
            [
                UserORM(
                    id="u_other",
                    name="别家用户",
                    role="customer",
                    parent_user_id=root_id,
                    created_at_ms=now,
                ),
            ]
        )
        _add_entry(session, "e_plain", "u_plain", now, cost=60, charge=120)
        session.commit()
    plain = _app_client(factory)
    plain.cookies.set(SESSION_COOKIE, new_session_token(factory, plain_admin))

    body = plain.get("/admin/bills/my-spend?range=30d&scope=self").json()
    assert body["summary"]["charge_micro"] == 120

    def keys(value):
        if isinstance(value, dict):
            for key, item in value.items():
                yield key
                yield from keys(item)
        elif isinstance(value, list):
            for item in value:
                yield from keys(item)

    lowered = {key.lower() for key in keys(body)}
    assert "cost_micro" not in lowered
    assert "margin_micro" not in lowered
    assert "cost" not in lowered
    assert "margin" not in lowered

    denied = plain.get("/admin/bills/my-spend?range=30d&scope=subtree")
    assert denied.status_code == 403
    assert denied.json()["code"] == "FORBIDDEN"
    assert plain.get(
        "/admin/bills/my-spend?range=30d&scope=self&user_id=u_other"
    ).status_code == 403


def test_time_range_and_unpriced_count(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    now = now_ms()
    admin_id = make_admin(factory, username="bill-range", role="admin", user_id="u_range")
    with factory() as session:
        _add_entry(session, "e_now", "u_range", now, cost=50, charge=100)
        _add_entry(session, "e_old", "u_range", now - 40 * DAY_MS, cost=70, charge=140)
        _add_entry(session, "e_unpriced", "u_range", now, cost=None, charge=None)
        session.commit()
    browser = _app_client(factory)
    browser.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))

    week = browser.get("/admin/bills/my-spend?range=7d").json()
    assert week["summary"]["charge_micro"] == 100
    assert week["summary"]["unpriced"] == 1
    assert len(week["series"]) == 7

    year = browser.get("/admin/bills/my-spend?range=365d").json()
    assert year["summary"]["charge_micro"] == 240
    assert year["summary"]["cost_micro"] == 120
    assert len(year["series"]) == 365

    assert browser.get("/admin/bills/my-spend?range=90d").status_code == 422
    assert browser.get("/admin/bills/my-spend?scope=everyone").status_code == 422
    assert browser.get("/admin/bills/my-spend?tz=Mars/Base").status_code == 422


def test_charge_entries_pair_cost_and_hide_it_without_billing_cost(
    client, engine_and_sessionmaker
):
    """运营账单·营收把成本并进同一行；无 billing:cost 时 cost_micro 键不存在。"""
    _, factory = engine_and_sessionmaker
    now = now_ms()
    admin_id = make_admin(factory, username="bill-charge", role="admin", user_id="u_charge")
    with factory() as session:
        _add_entry(session, "e_charge", "u_charge", now, cost=60, charge=120)
        session.commit()

    browser = _app_client(factory)
    browser.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    rows = browser.get("/admin/charge/entries").json()
    assert rows[0]["amount_micro"] == 120
    assert rows[0]["cost_micro"] == 60

    plain_admin = make_admin(factory, username="bill-charge-plain", role="customer")
    plain = _app_client(factory)
    plain.cookies.set(SESSION_COOKIE, new_session_token(factory, plain_admin))
    plain_rows = plain.get("/admin/charge/entries").json()
    assert plain_rows[0]["amount_micro"] == 120
    assert "cost_micro" not in plain_rows[0]
