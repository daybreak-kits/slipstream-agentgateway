"""Field-level filtering: money keys vanish instead of turning null (ticket 03)."""

from __future__ import annotations

from l06_api import field_filter


def test_cost_keys_are_absent_without_billing_cost() -> None:
    payload = {
        "requests": 1,
        "cost_micro": 10,
        "margin_micro": 2,
        "charge_micro": 3,
        "by_currency": {"CNY": {"cost_micro": 10, "margin_micro": 2, "charge_micro": 3}},
    }
    cleaned = field_filter.sanitize(payload, {"billing:spend"})
    assert "cost_micro" not in cleaned
    assert "margin_micro" not in cleaned
    assert cleaned["charge_micro"] == 3
    assert "cost_micro" not in cleaned["by_currency"]["CNY"]
    assert "margin_micro" not in cleaned["by_currency"]["CNY"]
    assert cleaned["by_currency"]["CNY"]["charge_micro"] == 3


def test_spend_keys_are_absent_without_billing_spend() -> None:
    payload = {"charge_micro": 3, "spend_micro": 4, "delta_micro": 5, "balance_after_micro": 6}
    cleaned = field_filter.sanitize(payload, {"billing:cost"})
    assert cleaned == {}


def test_amount_micro_follows_the_declared_class() -> None:
    payload = {"items": [{"amount_micro": 5, "currency": "CNY"}]}
    without = field_filter.sanitize(payload, set(), amount_micro="spend")
    assert "amount_micro" not in without["items"][0]
    assert without["items"][0]["currency"] == "CNY"
    with_spend = field_filter.sanitize(payload, {"billing:spend"}, amount_micro="spend")
    assert with_spend["items"][0]["amount_micro"] == 5
    as_cost = field_filter.sanitize(payload, {"billing:spend"}, amount_micro="cost")
    assert "amount_micro" not in as_cost["items"][0]


def test_non_money_keys_are_left_alone() -> None:
    payload = {"cost_center": "x", "charge_note": "y", "requests": 1, "currency": "CNY"}
    assert field_filter.sanitize(payload, set()) == payload


def test_model_cost_book_keys_belong_to_the_cost_class() -> None:
    payload = {
        "name": "glm-5.3",
        "cost_input_per_1m": "2.500000",
        "cost_output_per_1m": "10.000000",
        "markup": "1.2000",
        "cost_center": "x",
    }
    assert field_filter.sanitize(payload, {"upstream_models:read"}) == {
        "name": "glm-5.3",
        "cost_center": "x",
    }
    assert field_filter.sanitize(payload, {"billing:cost"}) == payload
