"""MoneyVisibilityMiddleware: one filter for every JSON /admin response."""

from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from starlette.testclient import TestClient

from l06_api.money_filter import MoneyVisibilityMiddleware


class _FakePrincipalMiddleware:
    """Put a principal into scope state, like AdminSessionMiddleware does."""

    def __init__(self, app, permissions: frozenset[str]) -> None:
        self.app = app
        self.permissions = permissions

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            state = scope.setdefault("state", {})
            if not isinstance(state, dict):
                state = {}
                scope["state"] = state
            state["principal"] = SimpleNamespace(permissions=self.permissions)
        await self.app(scope, receive, send)


def _client(permissions: frozenset[str]) -> TestClient:
    app = FastAPI()

    @app.get("/admin/demo")
    def demo() -> dict:
        return {
            "cost_micro": 7,
            "cost_center": "org-1",
            "charge_micro": 9,
            "balance_after_micro": 11,
            "nested": [{"margin": 1, "charge_micro": 2, "label": "x"}],
        }

    @app.get("/admin/cost-rows", openapi_extra={"x-money-amount-class": "cost"})
    def cost_rows() -> list[dict]:
        return [{"amount_micro": 5, "status": "ok"}]

    @app.get("/admin/spend-rows", openapi_extra={"x-money-amount-class": "spend"})
    def spend_rows() -> list[dict]:
        return [{"amount_micro": 5, "status": "ok"}]

    @app.get("/admin/plain")
    def plain() -> PlainTextResponse:
        return PlainTextResponse("cost_micro=7")

    @app.get("/public/demo")
    def public() -> dict:
        return {"cost_micro": 7}

    app.add_middleware(MoneyVisibilityMiddleware)
    app.add_middleware(_FakePrincipalMiddleware, permissions=permissions)
    return TestClient(app)


def test_without_money_permissions_all_keys_absent_not_null() -> None:
    body = _client(frozenset()).get("/admin/demo").json()
    assert "cost_micro" not in body
    assert "charge_micro" not in body
    assert "balance_after_micro" not in body
    assert body["cost_center"] == "org-1"
    assert body["nested"] == [{"label": "x"}]


def test_cost_permission_keeps_cost_but_not_spend() -> None:
    body = _client(frozenset({"billing:cost"})).get("/admin/demo").json()
    assert body["cost_micro"] == 7
    assert "charge_micro" not in body
    assert "balance_after_micro" not in body


def test_spend_permission_keeps_spend_but_not_cost() -> None:
    body = _client(frozenset({"billing:spend"})).get("/admin/demo").json()
    assert "cost_micro" not in body
    assert body["charge_micro"] == 9
    assert body["balance_after_micro"] == 11


def test_bare_amount_uses_route_declared_class() -> None:
    anonymous = _client(frozenset())
    assert anonymous.get("/admin/cost-rows").json() == [{"status": "ok"}]
    assert anonymous.get("/admin/spend-rows").json() == [{"status": "ok"}]

    cost_only = _client(frozenset({"billing:cost"}))
    assert cost_only.get("/admin/cost-rows").json() == [
        {"amount_micro": 5, "status": "ok"}
    ]
    assert cost_only.get("/admin/spend-rows").json() == [{"status": "ok"}]

    spend_only = _client(frozenset({"billing:spend"}))
    assert spend_only.get("/admin/cost-rows").json() == [{"status": "ok"}]
    assert spend_only.get("/admin/spend-rows").json() == [
        {"amount_micro": 5, "status": "ok"}
    ]


def test_non_json_and_non_admin_responses_are_untouched() -> None:
    client = _client(frozenset())
    plain = client.get("/admin/plain")
    assert plain.status_code == 200
    assert plain.text == "cost_micro=7"
    assert client.get("/public/demo").json() == {"cost_micro": 7}
