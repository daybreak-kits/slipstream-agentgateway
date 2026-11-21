"""P1-5: the global ledger and daily usage endpoints follow the caller's user scope.

Before the fix both routes returned every row to anyone holding ledger:read /
logs:read, so an ordinary user read the whole platform's money movements. The
subtree rule (user_tree.visible_ids) is the same one the user routes use:

- built-in admin role  -> every row;
- branch/subtree role  -> only its own subtree;
- ordinary role        -> only its own rows.
"""

from __future__ import annotations

from tests.conftest import _app_client, make_admin, new_session_token

from l01_core.timeutil import now_ms
from l04_repo.orm import LedgerEntryORM, UserDailyORM, UserORM
from l06_api.deps import SESSION_COOKIE


def _client_for(factory, role: str, username: str):
    admin_id = make_admin(factory, username=username, role=role)
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client, admin_id


def _rows_for(factory, user_id: str, *, tag: str, amount: int) -> None:
    """One ledger row and one daily row for a user (unique ids per tag)."""
    now = now_ms()
    with factory() as session:
        session.add_all(
            [
                LedgerEntryORM(
                    id=f"led_{tag}",
                    user_id=user_id,
                    kind="charge",
                    delta_micro=-amount,
                    balance_after_micro=1_000 - amount,
                    currency="CNY",
                    created_at_ms=now,
                ),
                UserDailyORM(
                    day="2026-11-19",
                    user_id=user_id,
                    requests=1,
                    input_tokens=1,
                    output_tokens=1,
                    amount_micro=amount,
                    currency="CNY",
                ),
            ]
        )
        session.commit()


def _branch_role(client, name: str, permissions: list[str]) -> str:
    created = client.post(
        "/admin/roles",
        json={"name": name, "description": "scope test", "permissions": permissions},
    )
    assert created.status_code == 201, created.text
    return created.json()["key"]


def test_ledger_and_daily_show_every_row_to_an_admin(engine_and_sessionmaker, client):
    engine, factory = engine_and_sessionmaker
    other = client.post("/admin/users", json={"name": "别家分支"})
    assert other.status_code == 201, other.text
    other_id = other.json()["id"]
    _rows_for(factory, other_id, tag="other", amount=200)

    ledger_users = {row["user_id"] for row in client.get("/admin/usage/ledger").json()}
    daily_users = {row["user_id"] for row in client.get("/admin/usage/daily").json()}
    assert other_id in ledger_users, "the built-in admin role sees every ledger row"
    assert other_id in daily_users


def test_ordinary_user_sees_only_its_own_rows(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    plain, plain_id = _client_for(factory, "customer", "scope-plain")
    other_id = make_admin(factory, username="scope-other", role="customer")
    _rows_for(factory, plain_id, tag="self", amount=100)
    _rows_for(factory, other_id, tag="other", amount=200)

    assert [row["user_id"] for row in plain.get("/admin/usage/ledger").json()] == [plain_id]
    assert [row["user_id"] for row in plain.get("/admin/usage/daily").json()] == [plain_id]


def test_branch_role_sees_only_its_subtree(engine_and_sessionmaker, client):
    """A subtree reader sees its own branch: its node, its child, not the outsider.

    `visible_ids` is the caller's OWN subtree, so the reader is an unrestricted
    role (every permission) with the branch user and its child under it; the
    sibling branch hangs off the same parent but stays outside the subtree.
    """
    engine, factory = engine_and_sessionmaker
    reader_id = make_admin(factory, username="scope-branch-reader", role="admin")
    branch = client.post(
        "/admin/users", json={"name": "分支甲", "parent_user_id": reader_id}
    )
    assert branch.status_code == 201, branch.text
    branch_id = branch.json()["id"]
    child = client.post(
        "/admin/users", json={"name": "分支甲下级", "parent_user_id": branch_id}
    )
    assert child.status_code == 201, child.text
    child_id = child.json()["id"]
    # The sibling branch hangs off the branch's parent (the root), NOT off the
    # reader, so it stays outside the reader's subtree.
    root_id = client.get("/admin/users/tree").json()["root_id"]
    outsider = client.post(
        "/admin/users", json={"name": "别家分支", "parent_user_id": root_id}
    )
    assert outsider.status_code == 201, outsider.text
    outsider_id = outsider.json()["id"]

    _rows_for(factory, reader_id, tag="reader", amount=100)
    _rows_for(factory, branch_id, tag="branch", amount=100)
    _rows_for(factory, child_id, tag="child", amount=100)
    _rows_for(factory, outsider_id, tag="outsider", amount=999)

    # Downgrade the reader to the built-in subtree role (reseller): the permissions
    # are read at session resolution, so a fresh session picks them up. The node's
    # position in the tree is what scopes it, not the role name.
    with factory() as session:
        session.get(UserORM, reader_id).role = "reseller"
        session.commit()
    branch_client = _app_client(factory)
    branch_client.cookies.set(SESSION_COOKIE, new_session_token(factory, reader_id))

    ledger_users = {
        row["user_id"] for row in branch_client.get("/admin/usage/ledger").json()
    }
    daily_users = {row["user_id"] for row in branch_client.get("/admin/usage/daily").json()}
    # Own subtree only: the outsider's rows (same parent, other branch) never appear.
    assert ledger_users == {reader_id, branch_id, child_id}
    assert daily_users == {reader_id, branch_id, child_id}
    assert outsider_id not in ledger_users | daily_users
