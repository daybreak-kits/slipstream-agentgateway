"""One money engine: integer rounding, FX conversion and per-request pricing.

ADR-011 keeps two books (cost and charge) and says unpriced is not zero;
ADR-017 says charge = cost x markup. Both rules are implemented here once:

* every per-request numerator is rounded exactly once, half up (billing.md 5.5);
* converting to the report currency returns None when an fx rate is missing,
  so callers cannot silently turn "unknown" into 0;
* a request is priced from the two effective price books in one pass, and the
  resulting PriceResult is what the ledger writers and reports consume.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from l01_core.errors import AppError, ErrorCode

MICRO = 1_000_000
MARKUP_SCALE = 10_000
PRICE_ITEMS = ("input", "output", "cache_read", "cache_write", "request")
CHARGE_MODES = ("markup", "fixed")


def round_micro(numerator: int, denominator: int = MICRO) -> int:
    """Integer round-half-up division; the one rounding rule for money."""
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    if numerator >= 0:
        return (numerator + denominator // 2) // denominator
    return -((-numerator + denominator // 2) // denominator)


def convert(
    amount_micro: int | None, currency: str | None, rates: Mapping[str, int]
) -> int | None:
    """Convert micro units into the report currency; None means fx is unknown.

    An empty currency is also unknown: guessing the report currency would hide a
    data-quality bug. A rate of exactly MICRO means the currency is the report
    currency and needs no arithmetic.
    """
    if amount_micro is None:
        return None
    code = (currency or "").strip().upper()
    if not code:
        return None
    rate = rates.get(code)
    if rate is None:
        return None
    if rate == MICRO:
        return int(amount_micro)
    return round_micro(int(amount_micro) * rate, MICRO)


class PriceStatus(StrEnum):
    """One vocabulary for cost/charge entry status."""

    OK = "ok"
    UNPRICED = "unpriced"
    FREE = "free"


@dataclass(frozen=True, slots=True)
class PriceResult:
    """The two books for one request; None means that book is unknown."""

    cost_micro: int | None
    charge_micro: int | None
    cost_currency: str
    charge_currency: str
    status: PriceStatus
    cost_price_version_id: str
    charge_price_version_id: str


class CostPrice(Protocol):
    id: str
    unit_price_micro: int
    currency: str


class ChargePrice(Protocol):
    id: str
    value: int
    mode: str
    currency: str


def cost_numerator(
    tokens_by_item: Mapping[str, int],
    prices: Mapping[str, CostPrice],
    per_request_items: int = 1,
) -> int | None:
    """Exact pre-rounding cost numerator; None when any needed item is unpriced."""
    numerator = 0
    for item, tokens in tokens_by_item.items():
        price = prices.get(item)
        if price is None:
            return None
        numerator += int(tokens) * int(price.unit_price_micro)
    request_price = prices.get("request")
    if request_price is not None:
        numerator += per_request_items * int(request_price.unit_price_micro)
    return numerator


def charge_from_cost_numerator(
    cost_numerator: int,
    prices: Mapping[str, ChargePrice],
    tokens_by_item: Mapping[str, int],
    per_request_items: int = 1,
) -> int | None:
    """Charge numerator from the cost numerator (markup) or fixed prices.

    Markup applies the ten-thousandths ratio to the exact cost numerator and
    rounds once. Fixed items mirror the cost math. Mixing fixed items with a
    markup request price is rejected, exactly as before.
    """
    request_price = prices.get("request")
    fixed_numerator = 0
    has_fixed = False
    for item, tokens in tokens_by_item.items():
        price = prices.get(item)
        if price is None or price.mode == "markup":
            if request_price is not None and request_price.mode == "markup":
                continue  # markup covers every item
            if price is None:
                return None
        else:
            has_fixed = True
            fixed_numerator += int(tokens) * int(price.value)
    if request_price is not None and request_price.mode == "fixed":
        has_fixed = True
        fixed_numerator += per_request_items * int(request_price.value)
    if has_fixed and request_price is not None and request_price.mode == "markup":
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "charge price book mixes fixed items with a markup request price",
        )
    if has_fixed:
        return round_micro(fixed_numerator, MICRO)
    if request_price is not None and request_price.mode == "markup":
        return round_micro(
            int(cost_numerator) * int(request_price.value), MICRO * MARKUP_SCALE
        )
    return None


def _first_price(prices: Mapping[str, object]) -> object | None:
    for item in ("input", "output", "cache_read", "cache_write", "request"):
        if item in prices:
            return prices[item]
    return next(iter(prices.values()), None)


def price_books(
    tokens_by_item: Mapping[str, int],
    cost_prices: Mapping[str, CostPrice],
    charge_prices: Mapping[str, ChargePrice],
    per_request_items: int = 1,
) -> PriceResult:
    """Price one request from the two books in a single pass."""
    numerator = cost_numerator(tokens_by_item, cost_prices, per_request_items)
    cost_micro = None if numerator is None else round_micro(numerator, MICRO)
    charge_micro = (
        None
        if numerator is None
        else charge_from_cost_numerator(
            numerator, charge_prices, tokens_by_item, per_request_items
        )
    )
    if cost_micro is None or charge_micro is None:
        status = PriceStatus.UNPRICED
    elif charge_micro == 0:
        status = PriceStatus.FREE
    else:
        status = PriceStatus.OK

    cost_price = _first_price(cost_prices)
    charge_price = _first_price(charge_prices)
    return PriceResult(
        cost_micro=cost_micro,
        charge_micro=charge_micro,
        cost_currency=str(getattr(cost_price, "currency", "") or ""),
        charge_currency=str(getattr(charge_price, "currency", "") or ""),
        status=status,
        cost_price_version_id=str(getattr(cost_price, "id", "") or ""),
        charge_price_version_id=str(getattr(charge_price, "id", "") or ""),
    )
