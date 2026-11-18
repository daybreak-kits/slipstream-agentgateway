"""Field-level filtering for money data (ticket 03).

A permission gates a field, not only a page: without billing:cost the response
simply has no cost/margin keys (absence, not null), and without billing:spend no
charge/spend/balance keys. Filtering happens on the finished payload so query
code stays untouched and the wire contract stays easy to assert.
"""

from __future__ import annotations

from typing import Any, Literal

CostClass = Literal["cost", "spend"]

COST_FIELD_NAMES: frozenset[str] = frozenset(
    {"cost", "cost_micro", "margin", "margin_micro", "markup", "markup_ratio"}
)
# cost_center is an org field, not a price: keep it visible to every reader.
COST_PREFIX_EXCEPTIONS: frozenset[str] = frozenset({"cost_center"})
SPEND_FIELD_NAMES: frozenset[str] = frozenset(
    {
        "charge",
        "charge_micro",
        "spend",
        "spend_micro",
        "delta_micro",
        "balance_micro",
        "balance_after_micro",
    }
)


def is_cost_key(key: str) -> bool:
    """True for cost/margin/markup money fields (not e.g. "cost_center")."""
    lowered = key.lower()
    return (
        lowered in COST_FIELD_NAMES
        or (lowered.startswith("cost_") and lowered not in COST_PREFIX_EXCEPTIONS)
        or lowered.endswith("_cost")
        or lowered.endswith("_cost_micro")
        or lowered.endswith("_margin")
        or lowered.endswith("_margin_micro")
        or lowered.endswith("_markup")
        or lowered.endswith("_markup_ratio")
    )


def is_spend_key(key: str) -> bool:
    """True for charge/spend/balance money fields."""
    lowered = key.lower()
    return (
        lowered in SPEND_FIELD_NAMES
        or lowered.endswith("_charge")
        or lowered.endswith("_charge_micro")
        or lowered.endswith("_spend")
        or lowered.endswith("_spend_micro")
    )


def sanitize(
    payload: Any,
    permissions: frozenset[str] | set[str],
    *,
    amount_micro: CostClass | None = None,
) -> Any:
    """Recursively drop money keys the caller may not see.

    amount_micro names the class of a bare "amount_micro" field for routes
    (cost entries vs charge/day aggregates) where the unit depends on context.
    """
    allow_cost = "billing:cost" in permissions
    allow_spend = "billing:spend" in permissions

    def scrub(value: Any) -> Any:
        if isinstance(value, dict):
            cleaned: dict[str, Any] = {}
            for key, item in value.items():
                if key == "amount_micro" and amount_micro == "cost" and not allow_cost:
                    continue
                if key == "amount_micro" and amount_micro == "spend" and not allow_spend:
                    continue
                if is_cost_key(key) and not allow_cost:
                    continue
                if is_spend_key(key) and not allow_spend:
                    continue
                cleaned[key] = scrub(item)
            return cleaned
        if isinstance(value, list):
            return [scrub(item) for item in value]
        return value

    return scrub(payload)


def filter_payload(
    payload: Any,
    permissions: frozenset[str] | set[str],
    *,
    amount_micro: CostClass | None = None,
) -> Any:
    """Central response filter; one call site (MoneyVisibilityMiddleware)."""
    return sanitize(payload, permissions, amount_micro=amount_micro)
