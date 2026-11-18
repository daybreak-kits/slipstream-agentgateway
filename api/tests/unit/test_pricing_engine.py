"""Model-level pricing engine: Decimal precision, markup, average price, missing prices."""

from __future__ import annotations

from decimal import Decimal

import pytest

from l01_core.errors import AppError
from l04_repo.orm import ModelTargetORM, PublicModelORM, UpstreamModelORM
from l05_service import pricing


def test_cost_is_exact_decimal_integer_micro():
    # 1000 tokens @ CNY 2.5 / 1M and 500 @ 10 / 1M => 2500 + 5000 micro.
    assert pricing.cost_micro(1000, 500, Decimal("2.5"), Decimal("10")) == 7500
    # Price per 1M is small enough that one token lands on a half micro -> round up.
    assert pricing.cost_micro(1, 0, Decimal("0.5"), Decimal("1")) == 1
    assert pricing.cost_micro(0, 0, Decimal("2.5"), Decimal("10")) == 0


def test_missing_price_is_unpriced_never_zero():
    assert pricing.cost_micro(10, 0, None, Decimal("3")) is None
    assert pricing.cost_micro(0, 10, Decimal("3"), None) is None
    assert pricing.cost_micro(0, 0, None, None) is None
    # A zero bucket does not require its price: text-only request prices fine.
    assert pricing.cost_micro(10, 0, Decimal("3"), None) == 30


def test_spend_and_margin_with_markup():
    assert pricing.spend_micro(800, Decimal("1.2")) == 960
    assert pricing.spend_micro(1, Decimal("1.5")) == 2  # half-up once
    assert pricing.spend_micro(None, Decimal("1.2")) is None
    assert pricing.spend_micro(800, None) is None
    assert pricing.margin_micro(960, 800) == 160
    assert pricing.margin_micro(960, None) is None
    assert pricing.markup_ratio(960, 800) == Decimal("1.2000")
    assert pricing.markup_ratio(960, 0) is None  # no divide by zero
    assert pricing.markup_ratio(960, None) is None


def test_markup_validation_rejects_free_and_absurd_prices():
    assert pricing.validate_markup("1.2") == Decimal("1.2000")
    with pytest.raises(AppError):
        pricing.validate_markup("0")
    with pytest.raises(AppError):
        pricing.validate_markup("-1")
    with pytest.raises(AppError):
        pricing.validate_markup("101")
    with pytest.raises(AppError):
        pricing.validate_cost("-0.01", "cost_input_per_1m")
    assert pricing.validate_cost(None, "cost_input_per_1m") is None


def _model(model_id: str, cost_in: str | None, cost_out: str | None, markup: str):
    return UpstreamModelORM(
        id=model_id,
        upstream_id="u",
        name=model_id,
        cost_input_per_1m=Decimal(cost_in) if cost_in else None,
        cost_output_per_1m=Decimal(cost_out) if cost_out else None,
        markup=Decimal(markup),
    )


def _target(public_id: str, model_id: str, weight: int):
    return ModelTargetORM(
        id="t-" + model_id, public_model_id=public_id, upstream_model_id=model_id, weight=weight
    )


def test_weighted_average_uses_member_weights():
    public = PublicModelORM(id="p1", name="flagship", routing_mode="weighted")
    models = {
        "m1": _model("m1", "2", "4", "1.5"),  # effective 3 / 6
        "m2": _model("m2", "4", "8", "1.5"),  # effective 6 / 12
    }
    targets = [_target("p1", "m1", 1), _target("p1", "m2", 3)]
    body = pricing.public_model_price(public, targets, models)
    assert body["available"] is True
    assert body["weight_basis"] == "weight"
    assert body["price_input_per_1m"] == "5.250000"  # (3*1 + 6*3) / 4
    assert body["price_output_per_1m"] == "10.500000"
    assert body["read_only"] is True


def test_failover_average_is_equal_weight_and_skips_unpriced_members():
    public = PublicModelORM(id="p1", name="flagship", routing_mode="failover")
    models = {
        "m1": _model("m1", "2", None, "1.5"),  # effective 3, no output price
        "m2": _model("m2", "4", "8", "1.5"),  # effective 6 / 12
        "m3": _model("m3", None, None, "1.5"),  # unpriced member is skipped
    }
    targets = [_target("p1", "m1", 0), _target("p1", "m2", 0), _target("p1", "m3", 0)]
    body = pricing.public_model_price(public, targets, models)
    assert body["weight_basis"] == "equal"
    assert body["priced_members"] == 2
    assert body["price_input_per_1m"] == "4.500000"  # (3 + 6) / 2
    assert body["price_output_per_1m"] == "12.000000"  # only m2 is priced on output


def test_zero_weights_and_all_unpriced_have_explicit_reasons():
    public = PublicModelORM(id="p1", name="flagship", routing_mode="weighted")
    models = {"m1": _model("m1", "2", "4", "1.5")}
    zero = pricing.public_model_price(public, [_target("p1", "m1", 0)], models)
    assert zero["available"] is False
    assert zero["reason"] == "weights_zero"
    all_unpriced = pricing.public_model_price(
        PublicModelORM(id="p2", name="x", routing_mode="failover"),
        [_target("p2", "m-missing", 1)],
        models,
    )
    assert all_unpriced["available"] is False
    assert all_unpriced["reason"] == "no_priced_members"
