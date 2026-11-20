"""HTTP smoke checks for the Slipstream control plane (task-170).

Prereqs:
    cd slipstream/api && python scripts/seed_demo.py
    cd slipstream/api && uvicorn l06_api.app:create_app --factory --port 3700

Run:
    python ops/checks/smoke_api.py                 # defaults to 127.0.0.1:3700
    python ops/checks/smoke_api.py --base http://127.0.0.1:3700 --verbose

Every check is a real HTTP request against a running server: shape assertions
(key presence / counts), RBAC (viewer vs owner), paging guards and the
settings PUT round-trip (mutates base_currency then restores it).
Exit code 0 = all green, 1 = at least one failure, 2 = server unreachable.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any

import httpx

# 身份来自登录后的 httpOnly 会话 cookie（client.cookies），不再用 X-Admin-Role。
OWNER: dict[str, str] = {}
SETTINGS_KEYS = {
    "base_currency",
    "timezone",
    "log_retention_days",
    "audit_retention_days",
    "default_tokens_per_minute",
    "default_concurrency",
}


class Checker:
    def __init__(self, client: httpx.Client, verbose: bool = False) -> None:
        self.client = client
        self.verbose = verbose
        self.results: list[tuple[bool, str, str]] = []

    def record(self, ok: bool, name: str, detail: str = "") -> None:
        self.results.append((ok, name, detail))
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {name}" + (f"  -- {detail}" if detail and (not ok or self.verbose) else ""))

    def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.client.get(path, headers=kwargs.pop("headers", OWNER), **kwargs)

    def post(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.client.post(path, headers=kwargs.pop("headers", OWNER), **kwargs)

    def put(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.client.put(path, headers=kwargs.pop("headers", OWNER), **kwargs)

    def check(self, name: str, fn) -> None:
        try:
            fn()
        except AssertionError as exc:
            self.record(False, name, str(exc))
        except Exception as exc:  # noqa: BLE001 - smoke should report, not crash
            self.record(False, name, f"{type(exc).__name__}: {exc}")
        else:
            self.record(True, name)

    def ok(self, resp: httpx.Response, expected: int = 200) -> Any:
        if resp.status_code != expected:
            raise AssertionError(f"HTTP {resp.status_code}, want {expected}: {resp.text[:300]}")
        try:
            return resp.json()
        except json.JSONDecodeError as exc:
            raise AssertionError(f"non-JSON body: {resp.text[:200]}") from exc


def items_of(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "rows", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    raise AssertionError(f"cannot find a list in payload: {str(payload)[:200]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Slipstream control plane smoke checks")
    parser.add_argument("--base", default="http://127.0.0.1:3700")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--verbose", action="store_true", help="print details for passes too")
    parser.add_argument("--username", default="admin", help="seed 默认管理员")
    parser.add_argument("--password", default="admin12345", help="seed 默认密码")
    parser.add_argument("--viewer", default="wangwu", help="只读角色账号（seed 内置普通用户）")
    args = parser.parse_args()

    with httpx.Client(base_url=args.base, timeout=args.timeout) as client:
        try:
            probe = client.get("/admin/health", headers=OWNER)
        except httpx.HTTPError as exc:
            print(f"控制面不可达：{args.base}（{exc}）")
            print("请先执行：")
            print("  cd slipstream/api && python scripts/seed_demo.py")
            print("  cd slipstream/api && uvicorn l06_api.app:create_app --factory --port 3700")
            return 2
        if probe.status_code != 200:
            print(f"控制面 /admin/health 返回 {probe.status_code}：{probe.text[:300]}")
            return 2

        auth = {"username": args.username, "password": args.password}
        login = client.post("/admin/auth/login", json=auth)
        if login.status_code != 200:
            print(f"登录失败（{args.username}）：HTTP {login.status_code} {login.text[:300]}")
            print("请确认已执行 seed_demo.py，或传 --username/--password；默认 admin / admin12345")
            return 2
        viewer = httpx.Client(base_url=args.base, timeout=args.timeout)
        viewer_login = viewer.post(
            "/admin/auth/login", json={"username": args.viewer, "password": args.password}
        )
        if viewer_login.status_code != 200:
            print(f"只读账号登录失败（{args.viewer}）：HTTP {viewer_login.status_code}")
            return 2

        c = Checker(client, args.verbose)
        original_currency: str | None = None

        # ---------------- health / auth ----------------
        c.check("GET /admin/health", lambda: c.ok(c.get("/admin/health")))

        def check_me() -> None:
            body = c.ok(c.get("/admin/auth/me"))
            assert {"id", "username", "name", "role", "permissions"} <= set(body), body
            assert body["role"] == "admin", body
            assert isinstance(body["permissions"], list), body

        c.check("GET /admin/auth/me (identity + permissions scaffold)", check_me)

        def check_unauthenticated() -> None:
            with httpx.Client(base_url=args.base, timeout=args.timeout) as anon:
                resp = anon.get("/admin/vendors")
                assert resp.status_code == 401, f"want 401, got {resp.status_code}"
                assert resp.json().get("code") == "UNAUTHORIZED", resp.text[:200]

        c.check("无会话 cookie -> 401 UNAUTHORIZED", check_unauthenticated)

        def check_role_header_ignored() -> None:
            with httpx.Client(base_url=args.base, timeout=args.timeout) as anon:
                resp = anon.get("/admin/vendors", headers={"X-Admin-Role": "owner"})
                assert resp.status_code == 401, f"X-Admin-Role must not grant identity: {resp.status_code}"

        c.check("X-Admin-Role 头不再授予身份", check_role_header_ignored)

        def check_bad_password() -> None:
            with httpx.Client(base_url=args.base, timeout=args.timeout) as anon:
                resp = anon.post(
                    "/admin/auth/login", json={"username": args.username, "password": "wrong-pass-1"}
                )
                assert resp.status_code == 401, resp.status_code
                assert resp.json().get("message") == "用户名或密码错误", resp.text[:200]

        c.check("错误密码 -> 统一 401", check_bad_password)

        def check_login_rate_limit() -> None:
            username = f"smoke-rate-{int(time.time())}"
            with httpx.Client(base_url=args.base, timeout=args.timeout) as rl:
                for _ in range(5):
                    resp = rl.post(
                        "/admin/auth/login", json={"username": username, "password": "bad-pass"}
                    )
                    assert resp.status_code == 401, resp.status_code
                blocked = rl.post(
                    "/admin/auth/login", json={"username": username, "password": "bad-pass"}
                )
                assert blocked.status_code == 429, f"want 429, got {blocked.status_code}"
                assert blocked.json().get("code") == "RATE_LIMITED", blocked.text[:200]

        c.check("失败 5 次/分钟 -> 429 RATE_LIMITED", check_login_rate_limit)

        def check_logout_revokes() -> None:
            with httpx.Client(base_url=args.base, timeout=args.timeout) as tmp:
                assert tmp.post("/admin/auth/login", json=auth).status_code == 200
                assert tmp.get("/admin/auth/me").status_code == 200
                assert tmp.post("/admin/auth/logout").status_code == 200
                after = tmp.get("/admin/auth/me")
                assert after.status_code == 401, f"session survived logout: {after.status_code}"

        c.check("logout 撤销会话（/me 立即 401）", check_logout_revokes)

        def check_settings_get() -> None:
            payload = c.ok(c.get("/admin/settings"))
            items = items_of(payload)
            keys = {row.get("key") for row in items}
            missing = SETTINGS_KEYS - keys
            assert not missing, f"missing keys {sorted(missing)}"
            for row in items:
                assert {"key", "value", "label", "updated_at"} <= set(row), row

        c.check("GET /admin/settings (items + required keys)", check_settings_get)

        def check_settings_put() -> None:
            nonlocal original_currency
            before = items_of(c.ok(c.get("/admin/settings")))
            current = next(r["value"] for r in before if r["key"] == "base_currency")
            original_currency = current
            target = "USD" if current != "USD" else "CNY"
            payload = c.ok(c.put("/admin/settings", json={"values": {"base_currency": target}}))
            assert payload.get("values", {}).get("base_currency") == target, payload
            after = items_of(c.ok(c.get("/admin/settings")))
            assert next(r["value"] for r in after if r["key"] == "base_currency") == target

        c.check("PUT /admin/settings round-trip", check_settings_put)

        def check_settings_unknown() -> None:
            resp = c.put("/admin/settings", json={"values": {"no_such_key": "x"}})
            body = c.ok(resp, 422)
            assert body.get("code") == "VALIDATION_ERROR", body

        c.check("PUT /admin/settings unknown key -> 422", check_settings_unknown)

        def check_settings_rbac() -> None:
            resp = viewer.put("/admin/settings", json={"values": {"base_currency": "CNY"}})
            assert resp.status_code == 403, f"want 403, got {resp.status_code}: {resp.text[:200]}"

        c.check("PUT /admin/settings as viewer -> 403", check_settings_rbac)

        def check_audit() -> None:
            payload = c.ok(c.get("/admin/audit-logs", params={"limit": 10}))
            assert isinstance(payload.get("total"), int) and payload["total"] > 0, payload
            items = payload.get("items") or []
            assert items, "audit items empty"
            assert {"id", "actor", "action", "target", "detail", "created_at"} <= set(items[0]), items[0]

        c.check("GET /admin/audit-logs (shape + non-empty)", check_audit)

        def check_audit_filter() -> None:
            first = c.ok(c.get("/admin/audit-logs", params={"limit": 1}))
            total_all = first["total"]
            action = first["items"][0]["action"]
            filtered = c.ok(c.get("/admin/audit-logs", params={"action": action, "limit": 200}))
            assert 0 < filtered["total"] <= total_all, (action, filtered["total"], total_all)

        c.check("GET /admin/audit-logs?action= filter", check_audit_filter)

        def check_audit_limit_guard() -> None:
            resp = c.get("/admin/audit-logs", params={"limit": 0})
            assert resp.status_code == 422, f"want 422, got {resp.status_code}"

        c.check("GET /admin/audit-logs?limit=0 -> 422", check_audit_limit_guard)

        def check_latest_revision() -> None:
            resp = c.get("/admin/config/revisions/latest")
            if resp.status_code == 404:
                body = resp.json()
                assert body.get("code") == "NOT_FOUND", body
                raise AssertionError("SKIP: 库里还没有配置版本（先跑 /admin/config/apply 或 seed）")
            body = c.ok(resp)
            assert {"id", "status", "operator", "created_at_ms"} <= set(body), body

        c.check("GET /admin/config/revisions/latest", check_latest_revision)

        def check_config_status() -> None:
            body = c.ok(c.get("/admin/config/status"))
            assert {"config_hash", "detail", "active_revision"} <= set(body), body
            allowed = (
                "config file matches last applied hash",
                "config drift: file ",
                "config file missing; hash from last apply marker",
                "no config applied yet",
                "config file present; no apply marker",
            )
            assert body["detail"].startswith(allowed), body["detail"]
            active = body["active_revision"]
            if active is not None:
                assert active["status"] == "active", active

        c.check("GET /admin/config/status (真实文件 hash / drift 文案)", check_config_status)

        def check_overview_alias() -> None:
            alias = c.ok(c.get("/admin/overview"))
            report = c.ok(c.get("/admin/reports/overview"))
            assert alias == report, f"overview alias mismatch\n alias={alias}\n report={report}"

        c.check("GET /admin/overview == /admin/reports/overview", check_overview_alias)

        # ---------------- resources ----------------
        def check_count(path: str, expected: int, name: str) -> None:
            payload = c.ok(c.get(path, params={"page_size": 200}))
            rows = items_of(payload)
            assert len(rows) == expected, f"{path}: want {expected} rows, got {len(rows)}"

        for path, expected, label in (
            ("/admin/vendors", 3, "厂商"),
            ("/admin/upstreams", 4, "上游"),  # 每项须带 has_api_key bool（由密钥行数量派生）
            ("/admin/upstream-models", 16, "上游模型"),
            ("/admin/public-models", 8, "对外模型"),
            ("/admin/model-targets", 16, "模型目标"),
            ("/admin/users", 6, "用户"),  # ticket 04 起 seed 含根用户 D
            ("/admin/api-keys", 5, "客户端密钥"),
            ("/admin/availability-rules", 2, "可用性规则"),
        ):
            c.check(f"GET {path} ({label} = {expected})", lambda p=path, e=expected: check_count(p, e, p))

        def check_upstream_has_api_key() -> None:
            rows = items_of(c.ok(c.get("/admin/upstreams", params={"page_size": 200})))
            assert rows, "upstreams empty"
            missing = [r.get("name") for r in rows if not isinstance(r.get("has_api_key"), bool)]
            assert not missing, f"upstreams missing has_api_key(bool): {missing}"
            assert any(r["has_api_key"] for r in rows), "seed 上游都应有密钥（has_api_key=true）"

        c.check("GET /admin/upstreams.has_api_key (bool)", check_upstream_has_api_key)

        # ---------------- usage / billing ----------------
        for path, expected in (
            ("/admin/usage/events", 252),
            ("/admin/usage/ledger", 249),
            ("/admin/cost/entries", 252),
            ("/admin/charge/entries", 245),
        ):
            def check_nonempty(p=path, e=expected) -> None:
                rows = items_of(c.ok(c.get(p, params={"page_size": 200})))
                assert rows, f"{p} empty"
                if path.startswith("/admin/usage") or "entries" in p:
                    assert len(rows) <= e, f"{p}: more rows ({len(rows)}) than seeded ({e})"

            c.check(f"GET {path}", check_nonempty)

        def check_daily() -> None:
            rows = items_of(c.ok(c.get("/admin/usage/daily")))
            assert rows, "usage/daily empty"

        c.check("GET /admin/usage/daily", check_daily)

        def check_unpriced() -> None:
            payload = c.ok(c.get("/admin/unpriced"))
            cost_rows = payload.get("cost") or []
            charge_rows = payload.get("charge") or []
            assert len(cost_rows) == 3, f"want 3 cost-side unpriced rows, got {len(cost_rows)}"
            assert len(charge_rows) == 3, f"want 3 charge-side unpriced rows, got {len(charge_rows)}"
            assert all("gateway_event_id" in row for row in cost_rows), cost_rows[:1]

        c.check("GET /admin/unpriced (3 条缺价)", check_unpriced)

        def check_prices() -> None:
            assert items_of(c.ok(c.get("/admin/prices/upstream"))), "upstream prices empty"
            # W5/ADR-017：「花费 = 成本 × 倍率」派生后 charge_prices 的 API 已退役；
            # 公开模型售价（成员加权派生）改用只读端点校验。
            assert items_of(c.ok(c.get("/admin/prices/public-models"))), "public model prices empty"

        c.check("GET /admin/prices/{upstream,public-models}", check_prices)

        def check_trend() -> None:
            body = c.ok(c.get("/admin/reports/trend", params={"metric": "charge_micro", "range": "7d"}))
            points = body.get("points") or []
            assert len(points) == 7, f"want 7 points, got {len(points)}"
            assert all({"day", "metric", "value"} <= set(p) for p in points), points[:1]

        c.check("GET /admin/reports/trend (7d = 7 points)", check_trend)

        def check_flow() -> None:
            body = c.ok(c.get("/admin/reports/flow"))
            assert isinstance(body.get("nodes"), list) and isinstance(body.get("links"), list), body

        c.check("GET /admin/reports/flow", check_flow)

        def check_margin_report() -> None:
            body = c.ok(c.get("/admin/reports/margin"))
            required = {
                "from_ms", "to_ms", "report_currency", "by_currency",
                "report_currency_margin_micro", "fx_missing", "estimate_note",
            }
            assert required <= set(body), f"margin missing keys: {required - set(body)}"
            assert body["report_currency"] == "CNY", body["report_currency"]
            assert "" not in body["by_currency"], f"空币种桶不应出现: {body['by_currency']}"
            # 报表币种自身的折算率恒为 1（币种可能被 SLIPSTREAM_REPORT_CURRENCY 改掉，
            # 所以校验 report_currency 那个桶，而不是硬编码 CNY）
            report_bucket = body["by_currency"].get(body["report_currency"])
            if report_bucket is not None:
                assert report_bucket["fx_rate_micro_to_report"] == 1_000_000, report_bucket
                assert report_bucket["margin_micro"] == (
                    report_bucket["charge_micro"] - report_bucket["cost_micro"]
                ), report_bucket
            # 只有存在账本行（by_currency 非空）时才要求总额非 null；清库场景总额 null 是合法语义
            if body["by_currency"] and not body["fx_missing"]:
                assert body["report_currency_margin_micro"] is not None, body

        c.check("GET /admin/reports/margin (币种归一/无空桶)", check_margin_report)

        def check_overview_windowed_money() -> None:
            overview = c.ok(c.get("/admin/overview"))
            assert isinstance(overview.get("fx_missing"), list), overview
            assert overview.get("currency") == "CNY", overview
            assert overview.get("money_scope") in ("converted", "report_currency_only"), overview
            margin = c.ok(c.get("/admin/reports/margin"))
            if not margin["fx_missing"]:
                # 汇率齐全：overview 的金额必须与 margin 的折算总额一致（同窗口同口径）
                assert overview["money_scope"] == "converted", overview
                for field in ("charge_micro", "cost_micro", "margin_micro"):
                    assert overview[field] == margin[f"report_currency_{field}"], (
                        field, overview[field], margin.get(f"report_currency_{field}")
                    )
            else:
                # 有外币缺汇率：margin 总额为 null，overview 回退到本位币账本口径
                assert overview["money_scope"] == "report_currency_only", overview
                report_bucket = margin["by_currency"].get(margin["report_currency"]) or {}
                for field in ("charge_micro", "cost_micro", "margin_micro"):
                    assert overview[field] == report_bucket.get(field, 0), (
                        field, overview[field], report_bucket.get(field)
                    )

        c.check("overview 金额与 margin 同窗口一致", check_overview_windowed_money)

        def check_logs() -> None:
            body = c.ok(c.get("/admin/logs", params={"page_size": 25}))
            assert {"total", "items", "next_offset"} <= set(body), body

        c.check("GET /admin/logs (page shape)", check_logs)

        def check_revisions() -> None:
            rows = items_of(c.ok(c.get("/admin/config/revisions")))
            assert len(rows) == 2, f"want 2 revisions, got {len(rows)}"
            # Ticket 08: failure reason and the validate-only note are auditable.
            assert {"error_detail", "validation_note"} <= set(rows[0]), rows[0]
            assert rows[0]["error_detail"] == "", rows[0]

        c.check("GET /admin/config/revisions (2 条)", check_revisions)

        def check_page_guard() -> None:
            resp = c.get("/admin/usage/events", params={"page_size": 30})
            assert resp.status_code == 422, f"want 422 for page_size=30, got {resp.status_code}"
            assert resp.json().get("code") == "VALIDATION_ERROR"

        c.check("page_size=30 -> 422 VALIDATION_ERROR", check_page_guard)

        # restore the mutated setting even when the round-trip check failed
        if original_currency:
            try:
                c.put("/admin/settings", json={"values": {"base_currency": original_currency}})
            except httpx.HTTPError:
                pass
        viewer.close()

        failed = [r for r in c.results if not r[0]]
        print()
        print(f"结果：{len(c.results) - len(failed)}/{len(c.results)} 通过，失败 {len(failed)}")
        if failed:
            for _ok, name, detail in failed:
                print(f"  - {name}: {detail}")
            return 1
        return 0


if __name__ == "__main__":
    sys.exit(main())
