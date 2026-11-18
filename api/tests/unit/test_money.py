"""Money engine: one rounding rule, one fx rule, one pricing pass."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from l01_core.errors import AppError
from l05_service import money


def test_round_micro_is_half_up_for_both_signs() -> None:
    assert money.round_micro(2_500_000) == 3
    assert money.round_micro(2_499_999) == 2
    assert money.round_micro(-2_500_000) == -3
    assert money.round_micro(-2_499_999) == -2


def test_convert_returns_none_instead_of_guessing() -> None:
    rates = {"CNY": money.MICRO, "USD": 7_200_000}
    assert money.convert(1_000_000, "CNY", rates) == 1_000_000
    assert money.convert(1_000_000, "USD", rates) == 7_200_000
    assert money.convert(1_000_000, "EUR", rates) is None
    assert money.convert(1_000_000, "", rates) is None
    assert money.convert(None, "CNY", rates) is None


def _cost_book() -> dict:
    return {
        "input": SimpleNamespace(id="u-in", unit_price_micro=2_500_000, currency="CNY"),
        "output": SimpleNamespace(id="u-out", unit_price_micro=10_000_000, currency="CNY"),
    }


def test_price_books_rounds_once_and_applies_markup() -> None:
    result = money.price_books(
        {"input": 1000, "output": 2000},
        _cost_book(),
        {
            "request": SimpleNamespace(
                id="c-markup", mode="markup", value=12_000, currency="CNY"
            )
        },
    )
    # numerator = 1000*2.5M + 2000*10M = 22.5e9; cost 22_500 micro; charge x1.2 = 27_000
    assert result.cost_micro == 22_500
    assert result.charge_micro == 27_000
    assert result.status is money.PriceStatus.OK
    assert result.cost_currency == "CNY"
    assert result.cost_price_version_id == "u-in"


def test_price_books_unpriced_has_no_silent_zero() -> None:
    result = money.price_books(
        {"input": 1000, "output": 2000},
        {"input": _cost_book()["input"]},
        {"request": SimpleNamespace(id="c", mode="markup", value=12_000, currency="CNY")},
    )
    assert result.cost_micro is None
    assert result.charge_micro is None
    assert result.status is money.PriceStatus.UNPRICED


def test_price_books_fixed_charge_and_free_status() -> None:
    result = money.price_books(
        {"input": 1000},
        {"input": _cost_book()["input"]},
        {"input": SimpleNamespace(id="c-fixed", mode="fixed", value=1_000_000, currency="CNY")},
    )
    assert result.charge_micro == 1000
    assert result.status is money.PriceStatus.OK

    free = money.price_books(
        {"input": 1000},
        {"input": _cost_book()["input"]},
        {"input": SimpleNamespace(id="c-zero", mode="fixed", value=0, currency="CNY")},
    )
    assert free.charge_micro == 0
    assert free.status is money.PriceStatus.FREE


def test_charge_book_rejects_mixed_fixed_and_markup_request() -> None:
    with pytest.raises(AppError):
        money.charge_from_cost_numerator(
            1_000_000,
            {
                "input": SimpleNamespace(id="c", mode="fixed", value=1, currency="CNY"),
                "request": SimpleNamespace(id="r", mode="markup", value=12_000, currency="CNY"),
            },
            {"input": 1},
        )
