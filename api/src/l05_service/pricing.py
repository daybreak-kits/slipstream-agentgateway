"""Model-level pricing engine (phase2 ticket 05).

One truth source per upstream model: a cost book (CNY per 1M tokens) plus ONE markup.
Money is Decimal end to end and rounded HALF_UP exactly once per request, at the micro
boundary. A missing unit price is "unpriced" (None), never a silent zero.

The public-model price is derived and read-only: weighted average of the members'
effective unit prices (cost x own markup). "weighted" routing uses member weight;
failover / conditional use equal weights. No price is ever stored on a public model.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.timeutil import now_ms
from l04_repo.orm import ModelTargetORM, PublicModelORM, UpstreamModelORM

MICRO = Decimal("1000000")  # 1 CNY == 1_000_000 micro
PER_MILLION = Decimal("1000000")  # unit prices are quoted per 1M tokens
ONE = Decimal("1")
MAX_MARKUP = Decimal("100")  # a 100x ceiling keeps typo pricing out of production
_MICRO_QUANTUM = Decimal("1")
_PRICE_QUANTUM = Decimal("0.000001")
_MARKUP_QUANTUM = Decimal("0.0001")


def _decimal(value: object) -> Decimal | None:
    """Best-effort Decimal conversion; None for empty / invalid values."""
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _money(micro: Decimal) -> int:
    """Round a micro amount HALF_UP to the integer micro boundary."""
    return int(micro.quantize(_MICRO_QUANTUM, rounding=ROUND_HALF_UP))


def decimal_text(value: Decimal | None, quantum: Decimal = _PRICE_QUANTUM) -> str | None:
    """Stable string form for JSON (Decimal is not JSON-serialisable by default)."""
    if value is None:
        return None
    return format(value.quantize(quantum, rounding=ROUND_HALF_UP), "f")


def markup_text(value: Decimal | None) -> str:
    """Markup for JSON: four decimals, default 1.0000 when never configured."""
    return decimal_text(value if value is not None else ONE, _MARKUP_QUANTUM) or "1.0000"


def validate_cost(value: object, field: str) -> Decimal | None:
    """Validate one cost price: None clears it, otherwise a non-negative Decimal."""
    parsed = _decimal(value)
    if parsed is None:
        if value in (None, ""):
            return None
        raise AppError(ErrorCode.VALIDATION_ERROR, field + " 必须是数字")
    if parsed < 0:
        raise AppError(ErrorCode.VALIDATION_ERROR, field + " 不能为负数")
    return parsed.quantize(_PRICE_QUANTUM, rounding=ROUND_HALF_UP)


def validate_markup(value: object) -> Decimal:
    """Validate a markup: must be > 0 (no free rides) and <= 100."""
    parsed = _decimal(value)
    if parsed is None:
        raise AppError(ErrorCode.VALIDATION_ERROR, "markup 必须是数字")
    if parsed <= 0:
        raise AppError(ErrorCode.VALIDATION_ERROR, "markup 必须大于 0（花费 = 成本 × 倍率）")
    if parsed > MAX_MARKUP:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"markup 不能超过 {MAX_MARKUP}",
            details={"markup": decimal_text(parsed)},
        )
    return parsed.quantize(_MARKUP_QUANTUM, rounding=ROUND_HALF_UP)


def cost_micro(
    input_tokens: int,
    output_tokens: int,
    cost_input_per_1m: Decimal | None,
    cost_output_per_1m: Decimal | None,
) -> int | None:
    """Exact request cost in micro; None when a token bucket has no configured price.

    Zero-token buckets never require a price (a text-only request has no output
    price dependency), and a fully unpriced model is None rather than 0.
    """
    input_tokens = max(int(input_tokens or 0), 0)
    output_tokens = max(int(output_tokens or 0), 0)
    if cost_input_per_1m is None and cost_output_per_1m is None:
        return None
    if input_tokens > 0 and cost_input_per_1m is None:
        return None
    if output_tokens > 0 and cost_output_per_1m is None:
        return None
    # price is CNY per 1M tokens; micro = tokens x price (the two 1M factors cancel),
    # so one HALF_UP rounding at the micro boundary is exact for this unit system.
    numerator = Decimal(0)
    if cost_input_per_1m is not None:
        numerator += Decimal(input_tokens) * cost_input_per_1m
    if cost_output_per_1m is not None:
        numerator += Decimal(output_tokens) * cost_output_per_1m
    return _money(numerator)


def spend_micro(cost_amount_micro: int | None, markup: Decimal | None) -> int | None:
    """花费 = 成本 × 倍率 (rounded once); None stays unpriced."""
    if cost_amount_micro is None or markup is None:
        return None
    return _money(Decimal(cost_amount_micro) * markup)


def margin_micro(spend: int | None, cost: int | None) -> int | None:
    """毛利 = 花费 - 成本; either side missing means unknown (None)."""
    if spend is None or cost is None:
        return None
    return spend - cost


def markup_ratio(spend: int | None, cost: int | None) -> Decimal | None:
    """Effective markup = 花费 / 成本; None when cost is unknown or zero (no divide by 0)."""
    if spend is None or cost is None or cost == 0:
        return None
    return (Decimal(spend) / Decimal(cost)).quantize(_MARKUP_QUANTUM, rounding=ROUND_HALF_UP)


def unit_prices(model: UpstreamModelORM) -> tuple[Decimal | None, Decimal | None]:
    """(input, output) effective unit prices = cost x markup for one upstream model."""
    markup = _decimal(getattr(model, "markup", None)) or ONE
    cost_input = _decimal(getattr(model, "cost_input_per_1m", None))
    cost_output = _decimal(getattr(model, "cost_output_per_1m", None))
    return (
        cost_input * markup if cost_input is not None else None,
        cost_output * markup if cost_output is not None else None,
    )


def _weight(context: str, target: ModelTargetORM) -> Decimal:
    """Member weight: routing mode decides; weighted uses the stored weight."""
    if context == "weighted":
        return Decimal(max(int(target.weight or 0), 0))
    return ONE


def public_model_price(
    model: PublicModelORM,
    targets: list[ModelTargetORM],
    models: dict[str, UpstreamModelORM],
) -> dict:
    """Derived, read-only price for one public model (weighted average of members)."""
    context = model.routing_mode
    input_numer = Decimal(0)
    output_numer = Decimal(0)
    input_weight = Decimal(0)
    output_weight = Decimal(0)
    priced_members = 0
    for target in targets:
        member = models.get(target.upstream_model_id)
        if member is None:
            continue
        weight = _weight(context, target)
        price_input, price_output = unit_prices(member)
        counted = False
        if price_input is not None:
            input_numer += price_input * weight
            input_weight += weight
            counted = True
        if price_output is not None:
            output_numer += price_output * weight
            output_weight += weight
            counted = True
        if counted:
            priced_members += 1
    reason = ""
    if context == "weighted" and targets and input_weight == 0 and output_weight == 0:
        reason = "weights_zero"
    elif priced_members == 0:
        reason = "no_priced_members"
    available = priced_members > 0 and not reason
    price_input = input_numer / input_weight if input_weight > 0 else None
    price_output = output_numer / output_weight if output_weight > 0 else None
    return {
        "public_model_id": model.id,
        "name": model.name,
        "routing_mode": context,
        "currency": "CNY",
        "price_input_per_1m": decimal_text(price_input),
        "price_output_per_1m": decimal_text(price_output),
        "priced_members": priced_members,
        "total_members": len(targets),
        "weight_basis": "weight" if context == "weighted" else "equal",
        "available": available,
        "reason": reason,
        "read_only": True,
    }


def public_model_price_rows(session: Session) -> list[dict]:
    """All public models with their derived price; public models are never priced in a book."""
    models = {row.id: row for row in session.scalars(select(UpstreamModelORM)).all()}
    grouped: dict[str, list[ModelTargetORM]] = {}
    for target in session.scalars(select(ModelTargetORM)).all():
        grouped.setdefault(target.public_model_id, []).append(target)
    output = []
    for public in session.scalars(
        select(PublicModelORM).order_by(PublicModelORM.created_at_ms, PublicModelORM.id)
    ).all():
        output.append(public_model_price(public, grouped.get(public.id, []), models))
    return output


# ------------------------------------------------------- ADR-020 price JSON export/import

PRICE_EXPORT_SCHEMA_VERSION = 1
#: v1 scope note carried in every export payload and doc: cache prices stay on the
#: legacy versioned book (/admin/prices/upstream) and are not part of this file.
CACHE_PRICES_SCOPE = "not_included_v1"


def export_model_prices(session: Session) -> dict:
    """Current effective prices for every upstream model (ADR-020 authority).

    Model rows are the one truth source, so the export covers exactly the three
    editable fields (cost in / out per 1M + markup) plus the locators. Decimals
    travel as strings in the same wire form as the model list endpoint, and
    unpriced costs export as null - re-importing an unedited export is a no-op.
    """
    rows = session.scalars(
        select(UpstreamModelORM).order_by(
            UpstreamModelORM.upstream_id, UpstreamModelORM.name, UpstreamModelORM.id
        )
    ).all()
    return {
        "schema_version": PRICE_EXPORT_SCHEMA_VERSION,
        "exported_at_ms": now_ms(),
        "meta": {"cache_prices": CACHE_PRICES_SCOPE},
        "upstream_models": [
            {
                "id": row.id,
                "name": row.name,
                "model_type": row.model_type,
                "cost_input_per_1m": decimal_text(row.cost_input_per_1m),
                "cost_output_per_1m": decimal_text(row.cost_output_per_1m),
                "markup": markup_text(row.markup),
            }
            for row in rows
        ],
    }


def _locate_import_target(
    models: dict[str, UpstreamModelORM],
    by_name: dict[str, list[UpstreamModelORM]],
    model_id: str,
    name: str,
) -> UpstreamModelORM | None:
    """Resolve one import row to an existing model row; None means "report an error".

    id wins when present (an unknown id is an error, not a fallback: a silent
    name fallback could price the wrong row); name is only used when id is
    absent, and an ambiguous name is an error (names are not unique upstream).
    """
    if model_id:
        if model_id not in models:
            raise LookupError(f"未知上游模型 id: {model_id}")
        return models[model_id]
    if name:
        matches = by_name.get(name, [])
        if len(matches) > 1:
            raise LookupError(
                f"模型名重名歧义: {name}（{len(matches)} 条同名模型，请改用 id 定位）"
            )
        if not matches:
            raise LookupError(f"未知上游模型: {name}")
        return matches[0]
    raise LookupError("缺少 id 或 name，无法定位上游模型")


def import_model_prices(session: Session, rows: list[dict]) -> dict:
    """Validate the whole batch, then update model rows in one transaction.

    Every row must resolve to an existing upstream_model (id first, then name);
    provided prices must pass validate_cost / validate_markup (same bounds as
    the single-row editor). Blank price fields (missing / null / "") leave that
    field untouched - the console batch editor sends blanks for columns it does
    not edit. Unknown models, out-of-range values and duplicate entries fail
    the WHOLE import with per-line errors before any row is written; the
    caller commits only on success, so a rejected batch changes nothing.
    """
    models = {row.id: row for row in session.scalars(select(UpstreamModelORM)).all()}
    by_name: dict[str, list[UpstreamModelORM]] = {}
    for row in models.values():
        by_name.setdefault(row.name, []).append(row)

    errors: list[dict] = []
    updates: list[tuple[UpstreamModelORM, dict[str, Decimal]]] = []
    claimed: set[str] = set()
    for index, item in enumerate(rows):
        model_id = str(item.get("id") or "").strip()
        name = str(item.get("name") or "").strip()
        where = {"index": index, "id": model_id or None, "name": name or None}
        try:
            target = _locate_import_target(models, by_name, model_id, name)
        except LookupError as exc:
            errors.append({**where, "message": str(exc)})
            continue
        if target.id in claimed:
            errors.append(
                {
                    **where,
                    "message": f"重复条目：模型 {target.id}（{target.name}）在本批中出现多次",
                }
            )
            continue
        problems: list[str] = []
        patch: dict[str, Decimal] = {}
        for field in ("cost_input_per_1m", "cost_output_per_1m", "markup"):
            value = item.get(field)
            if value is None:  # blank = untouched (validator normalized "" to None)
                continue
            try:
                if field == "markup":
                    patch[field] = validate_markup(value)
                else:
                    patch[field] = validate_cost(value, field)
            except AppError as exc:
                problems.append(exc.message)
        if problems:
            errors.append({**where, "message": "；".join(problems)})
            continue
        claimed.add(target.id)
        updates.append((target, patch))

    if errors:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"价目导入校验失败，全部未生效（{len(errors)} 行有误）",
            details={"errors": errors},
        )

    changed = 0
    skipped = 0
    for target, patch in updates:
        if not patch:  # locator-only row: nothing to write
            skipped += 1
            continue
        for field, value in patch.items():
            setattr(target, field, value)
        changed += 1
    return {"changed": changed, "missing": [], "skipped": skipped}
