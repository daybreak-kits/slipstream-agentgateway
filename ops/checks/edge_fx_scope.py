"""Throwaway edge-case check: external currency without an fx snapshot.

Builds a temp sqlite DB, injects one CNY and one USD cost/charge row, overrides
the session dependency, then walks:
  margin/overview without USD fx  -> fx_missing ["USD"], totals null,
                                     overview money_scope=report_currency_only
  PUT /admin/fx USD               -> totals converted, money_scope=converted
The temporary database is deleted at the end.
"""

import json
import os
import time

DB = "sqlite:///./.edge_fx_test.db"
path = DB.split("///", 1)[1]
if os.path.exists(path):
    os.remove(path)

from fastapi.testclient import TestClient

from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l04_repo.base import init_db, make_engine, make_sessionmaker
from l04_repo.orm import AdminUserORM, ChargeEntryORM, CostEntryORM
from l05_service import auth
from l06_api import deps
from l06_api.app import create_app

engine = make_engine(DB)
init_db(engine)
Session = make_sessionmaker(engine)

now = int(time.time() * 1000)
with Session() as s:
    for i, cur in enumerate(("CNY", "USD")):
        amount = 100_000_000 if cur == "CNY" else 500_000
        s.add(CostEntryORM(
            id=f"cost_edge_{cur}", gateway_event_id=f"edge_evt_{cur}", vendor_id="vend_edge",
            upstream_model_id="umdl_edge", input_tokens=1000, output_tokens=500,
            amount_micro=amount, currency=cur, price_version_id="", status="ok",
            created_at_ms=now,
        ))
        s.add(ChargeEntryORM(
            id=f"chg_edge_{cur}", gateway_event_id=f"edge_evt_{cur}", user_id="user_edge",
            public_model_id="pmdl_edge", input_tokens=1000, output_tokens=500,
            amount_micro=int(amount * 1.2), currency=cur, price_version_id="", status="ok",
            created_at_ms=now,
        ))
    s.add(AdminUserORM(
        id=new_id("adm"), username="edge-owner", display_name="edge",
        password_hash=auth.hash_password("edge-pass-123"), role="owner",
        status="active", created_at_ms=now_ms(), updated_at_ms=now_ms(),
    ))
    s.commit()

app = create_app(init_tables=False)
# 认证中间件读 app.state.session_factory；op 检查也要指向这个临时库。
app.state.session_factory = Session


def _session_override():
    session = Session()
    try:
        yield session
    finally:
        session.close()


app.dependency_overrides[deps.session_of] = _session_override
c = TestClient(app)
login = c.post("/admin/auth/login", json={"username": "edge-owner", "password": "edge-pass-123"})
assert login.status_code == 200, login.text


def show(label: str) -> None:
    margin = c.get("/admin/reports/margin").json()
    overview = c.get("/admin/overview").json()
    print(f"== {label}")
    print("margin fx_missing=", margin["fx_missing"],
          "total_margin=", margin["report_currency_margin_micro"],
          "buckets=", sorted(margin["by_currency"]))
    print("overview money_scope=", overview.get("money_scope"),
          "charge=", overview["charge_micro"], "cost=", overview["cost_micro"],
          "margin=", overview["margin_micro"], "fx_missing=", overview.get("fx_missing"))
    return margin, overview


m1, o1 = show("no USD fx")
assert m1["fx_missing"] == ["USD"], m1["fx_missing"]
assert m1["report_currency_margin_micro"] is None, m1
assert o1["money_scope"] == "report_currency_only", o1
cny = m1["by_currency"]["CNY"]
for f in ("charge_micro", "cost_micro", "margin_micro"):
    assert o1[f] == cny[f], (f, o1[f], cny[f])

for payload in (
    {"currency": "USD", "rate_micro": 7_200_000, "as_of_ms": now, "source": "edge_test"},
    {"currency": "USD", "rate_micro": 7_200_000},
):
    r = c.put("/admin/fx", json=payload)
    print("PUT /admin/fx", r.status_code, r.text[:160])
    if r.status_code < 300:
        break
assert r.status_code < 300, r.text

m2, o2 = show("after USD fx")
assert m2["fx_missing"] == [], m2["fx_missing"]
assert o2["money_scope"] == "converted", o2
usd_margin = m2["by_currency"]["USD"]["margin_micro"]
assert m2["report_currency_margin_micro"] == cny["margin_micro"] + usd_margin * 72 // 10, m2

print("EDGE-CASE OK")
