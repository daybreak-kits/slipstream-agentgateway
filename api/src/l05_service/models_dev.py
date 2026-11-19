"""models.dev snapshot fetch / match / adopt (W4-H).

One service, three concerns:

1. **fetch** ``https://models.dev/api.json`` — httpx with a hard timeout, a
   response-size cap and a small retry budget; any failure raises
   ``ModelsDevError`` and callers keep the previous snapshot (warning logged).
2. **refresh + match** — a successful fetch replaces ``model_dev_snapshots``
   wholesale (it IS a snapshot, not history). Upstream models are matched by
   NAME only: exact case-sensitive first, else a UNIQUE case-insensitive hit;
   no fuzzy guessing, no match means nothing is filled. Several providers
   mirror the same exact model id (aggregators): those rows merge in provider
   order — fill-blank semantics keep a mirror pick from overwriting better
   data, and the first provider wins deterministically.
3. **adopt** — fill ONLY blank keys of an upstream model: ``0`` / ``False`` /
   default single-modality list / NULL cost count as blank (0 = 未声明, old
   console semantics); a value the user typed is never overwritten. models.dev
   quotes USD per 1M tokens while the upstream model cost book is CNY per 1M
   (orm.py), so cost adoption converts through the latest fx_snapshots USD
   rate and reports ``skipped-no-fx`` when no rate exists. Per-key results use
   filled / skipped-manual / no-match (+ the two skip variants) so the console
   can toast exactly what happened.

The daily job (l07_jobs.models_dev_sync) runs the same adopt pass; the console
buttons hit the /admin/upstream-models adopt endpoints which share this
module. Tests inject a fake ``fetch`` callable — no network anywhere.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.settings import Settings, get_settings
from l01_core.timeutil import now_ms
from l04_repo.orm import (
    FxSnapshotORM,
    ModelDevSnapshotORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
)
from l05_service.model_params import (
    INPUT_TYPES,
    MAX_TOKEN_LIMIT,
    OUTPUT_TYPES,
    canonical_parameters,
    decode_parameters,
)
from l05_service.pricing import MICRO, validate_cost

LOGGER = logging.getLogger("slipstream.modelsdev")

MODELS_DEV_URL = "https://models.dev/api.json"
#: Guards against a hostile/broken mirror: api.json is ~7 MB today; 64 MB is
#: generous headroom while still bounding memory.
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
FETCH_TIMEOUT_SECONDS = 30.0
#: One immediate try plus two bounded retries; a daily/manual operation, not a
#: hot path — backoff keeps a hiccuping mirror from being hammered.
FETCH_RETRIES = 2
FETCH_BACKOFF_SECONDS = 1.5

#: adopt result statuses (returned per key, verbatim in the API contract).
FILLED = "filled"
SKIPPED_MANUAL = "skipped-manual"
SKIPPED_NO_FX = "skipped-no-fx"
NO_MATCH = "no-match"
NOTHING_TO_FILL = "nothing-to-fill"

#: models.dev modality strings -> this repo's vocabulary; unknowns are dropped.
_INPUT_MODALITY_MAP = {"pdf": "file", "document": "file"}
_OUTPUT_MODALITY_MAP: dict[str, str] = {}

_PARAM_RESULT_PREFIX = "parameters."


class ModelsDevError(AppError):
    """Fetch/parse failure of the models.dev snapshot (external boundary)."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(ErrorCode.INTERNAL_ERROR, message, details=details, status_code=502)


# --------------------------------------------------------------------- fetch


def fetch_snapshot(
    url: str | None = None,
    *,
    timeout: float = FETCH_TIMEOUT_SECONDS,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any]:
    """GET the api.json payload with timeout / size cap / retries (sync httpx).

    Raises ModelsDevError on network failure, oversize or non-JSON body; the
    caller decides the degradation (keep the stored snapshot). ``transport`` is
    an httpx injection point for offline tests (real callers never pass it).
    """
    resolved_url = url or get_settings().models_dev_url
    last_error: Exception | None = None
    for attempt in range(1 + FETCH_RETRIES):
        if attempt:
            time.sleep(FETCH_BACKOFF_SECONDS * attempt)
        try:
            with httpx.Client(
                timeout=timeout, follow_redirects=True, transport=transport
            ) as client:
                with client.stream("GET", resolved_url) as response:
                    response.raise_for_status()
                    declared = response.headers.get("content-length")
                    if declared and int(declared) > MAX_RESPONSE_BYTES:
                        raise ModelsDevError(
                            "models.dev 响应超过体积上限",
                            details={"content_length": int(declared)},
                        )
                    chunks: list[bytes] = []
                    received = 0
                    for chunk in response.iter_bytes():
                        received += len(chunk)
                        if received > MAX_RESPONSE_BYTES:
                            raise ModelsDevError(
                                "models.dev 响应超过体积上限",
                                details={"received_bytes": received},
                            )
                        chunks.append(chunk)
            return _parse_snapshot(b"".join(chunks))
        except (httpx.HTTPError, OSError, ValueError) as exc:
            # ModelsDevError (oversize) is an AppError and is NOT retried; this
            # arm only covers the transport / HTTP / header layer.
            last_error = exc
            LOGGER.warning("models.dev fetch attempt %s failed: %s", attempt + 1, exc)
    raise ModelsDevError(
        "models.dev 拉取失败（已重试）",
        details={"url": resolved_url, "last_error": str(last_error)},
    )


def _parse_snapshot(raw: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ModelsDevError(
            "models.dev 响应不是合法 JSON", details={"error": str(exc)}
        ) from exc
    if not isinstance(payload, dict):
        raise ModelsDevError("models.dev 响应形状异常（顶层应为对象）")
    return payload


# ------------------------------------------------------------------- refresh


def refresh_snapshot(
    session: Session, raw: dict[str, Any], *, fetched_at_ms: int | None = None
) -> dict[str, int]:
    """Replace the snapshot table with the fetched payload (caller commits).

    Returns {providers, models, fetched_at_ms}. Providers without a dict
    ``models`` block are skipped; rows are stored as received (minus cost,
    which lives in pricing_json) so a later adopt can recompute without
    refetching.
    """
    fetched_at = fetched_at_ms if fetched_at_ms is not None else now_ms()
    rows: list[ModelDevSnapshotORM] = []
    for provider_id, provider in sorted(raw.items()):
        if not isinstance(provider, dict):
            continue
        models = provider.get("models")
        if not isinstance(models, dict):
            continue
        for model_id, model in sorted(models.items()):
            if not isinstance(model, dict):
                continue
            body = {key: value for key, value in model.items() if key != "cost"}
            rows.append(
                ModelDevSnapshotORM(
                    provider=str(provider_id),
                    model=str(model_id),
                    params_json=json.dumps(body, ensure_ascii=False, sort_keys=True),
                    pricing_json=json.dumps(
                        model.get("cost") or {}, ensure_ascii=False, sort_keys=True
                    ),
                    fetched_at_ms=fetched_at,
                )
            )
    # Snapshot semantics: a successful fetch makes the table exactly reflect it.
    session.execute(delete(ModelDevSnapshotORM))
    session.add_all(rows)
    return {
        "providers": len({row.provider for row in rows}),
        "models": len(rows),
        "fetched_at_ms": fetched_at,
    }


def _row_richness(row: ModelDevSnapshotORM) -> int:
    """How much the snapshot row knows about THIS model (fields stored as received).

    Vendor rows carry capability flags + modalities + limits + costs; aggregator
    mirrors of the same exact id are usually bare stubs. Merging richest-first
    keeps the authoritative value winning the fill instead of whoever sorts
    first alphabetically.
    """
    return len(_params_of(row)) + len(_cost_of(row))


def _match_from_rows(
    rows: list[ModelDevSnapshotORM], name: str
) -> tuple[bool, list[ModelDevSnapshotORM]]:
    """Exact-first, unique-case-insensitive-second name match; never fuzzy.

    Exact hits from several providers (aggregator mirrors) return in merge
    order: richest row first, provider id as the deterministic tiebreak.
    """
    exact = [row for row in rows if row.model == name]
    if exact:
        exact.sort(key=lambda row: (-_row_richness(row), row.provider))
        return True, exact
    lowered = [row for row in rows if row.model.lower() == name.lower()]
    if len(lowered) == 1:
        return True, lowered
    return False, []


def match_snapshots(
    session: Session, name: str
) -> tuple[bool, list[ModelDevSnapshotORM]]:
    """Single-name entry point (loads the table once per call)."""
    rows = list(
        session.scalars(
            select(ModelDevSnapshotORM).order_by(
                ModelDevSnapshotORM.provider, ModelDevSnapshotORM.model
            )
        ).all()
    )
    return _match_from_rows(rows, name)


# --------------------------------------------------------------------- adopt


def _usd_rate_micro(session: Session) -> int | None:
    """Latest fx_snapshots USD rate (micro-CNY per 1 USD); None when unset."""
    row = session.scalars(
        select(FxSnapshotORM)
        .where(FxSnapshotORM.currency == "USD")
        .order_by(FxSnapshotORM.as_of_ms.desc())
    ).first()
    return row.rate_micro if row else None


def _params_of(row: ModelDevSnapshotORM) -> dict[str, Any]:
    try:
        parsed = json.loads(row.params_json)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _cost_of(row: ModelDevSnapshotORM) -> dict[str, Any]:
    try:
        parsed = json.loads(row.pricing_json)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _mapped_modalities(
    raw: object, allowed: tuple[str, ...], extra: dict[str, str]
) -> list[str]:
    """models.dev modality list -> this repo's vocabulary, order kept, dupes dropped."""
    if not isinstance(raw, list):
        return []
    mapped: list[str] = []
    for item in raw:
        value = extra.get(str(item), str(item))
        if value in allowed and value not in mapped:
            mapped.append(value)
    return mapped


def _positive_int(raw: object) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int):
        return 0
    return raw if 0 < raw <= MAX_TOKEN_LIMIT else 0


#: A parameter key is blank (= 未声明, adoptable) exactly when its current value
#: equals the undeclared default: 0 for limits, False for flags, the mandated
#: single-entry list for modalities. reasoning_level has no models.dev
#: equivalent, so it is never adoptable.
_BLANK_DEFAULTS = {
    "max_input_tokens": 0,
    "max_output_tokens": 0,
    "reasoning_level": "",
    "input_types": ["text"],
    "output_types": ["text"],
    "tool_call": False,
    "reasoning": False,
    "attachment": False,
    "structured_output": False,
}

_BOOL_PARAM_KEYS = ("tool_call", "reasoning", "attachment", "structured_output")


def _adopt_from_snapshots(
    row: UpstreamModelORM,
    snapshots: list[ModelDevSnapshotORM],
    *,
    fx_rate_micro: int | None,
) -> dict[str, str]:
    """Fill blank keys from the (ordered) snapshot rows; returns per-key status.

    First provider wins per key; a key stays reported as skipped-manual only
    while no snapshot could fill it.
    """
    results: dict[str, str] = {}
    params = decode_parameters(row.parameters_json)

    def _offer(key: str, status: str) -> None:
        if key not in results or results[key] == SKIPPED_MANUAL:
            results[key] = status

    for snapshot in snapshots:
        source = _params_of(snapshot)
        limit = source.get("limit") if isinstance(source.get("limit"), dict) else {}
        modalities = (
            source.get("modalities") if isinstance(source.get("modalities"), dict) else {}
        )
        for key in ("max_input_tokens", "max_output_tokens"):
            if params[key] != _BLANK_DEFAULTS[key]:
                _offer(_PARAM_RESULT_PREFIX + key, SKIPPED_MANUAL)
                continue
            value = _positive_int(
                limit.get("context" if key == "max_input_tokens" else "output")
            )
            if value > 0:
                params[key] = value
                _offer(_PARAM_RESULT_PREFIX + key, FILLED)
            else:
                _offer(_PARAM_RESULT_PREFIX + key, SKIPPED_MANUAL)
        for key, raw_field, allowed, extra in (
            ("input_types", "input", INPUT_TYPES, _INPUT_MODALITY_MAP),
            ("output_types", "output", OUTPUT_TYPES, _OUTPUT_MODALITY_MAP),
        ):
            if params[key] != _BLANK_DEFAULTS[key]:
                _offer(_PARAM_RESULT_PREFIX + key, SKIPPED_MANUAL)
                continue
            mapped = _mapped_modalities(modalities.get(raw_field), allowed, extra)
            if mapped:
                params[key] = mapped
                _offer(_PARAM_RESULT_PREFIX + key, FILLED)
            else:
                _offer(_PARAM_RESULT_PREFIX + key, SKIPPED_MANUAL)
        for key in _BOOL_PARAM_KEYS:
            if params[key] is not _BLANK_DEFAULTS[key]:
                _offer(_PARAM_RESULT_PREFIX + key, SKIPPED_MANUAL)
                continue
            if source.get(key) is True:
                params[key] = True
                _offer(_PARAM_RESULT_PREFIX + key, FILLED)
            else:
                _offer(_PARAM_RESULT_PREFIX + key, SKIPPED_MANUAL)
        # Costs (USD per 1M -> CNY per 1M via the latest fx rate); only a NULL
        # cost is blank — an explicit 0 price is a deliberate manual value.
        cost = _cost_of(snapshot)
        for key, usd_key in (
            ("cost_input_per_1m", "input"),
            ("cost_output_per_1m", "output"),
        ):
            if key in results:
                continue
            if getattr(row, key) is not None:
                results[key] = SKIPPED_MANUAL
                continue
            usd = cost.get(usd_key)
            if isinstance(usd, bool) or not isinstance(usd, (int, float)):
                _offer(key, SKIPPED_MANUAL)
                continue
            if fx_rate_micro is None:
                _offer(key, SKIPPED_NO_FX)
                continue
            converted = (Decimal(str(usd)) * fx_rate_micro / MICRO).quantize(
                Decimal("0.000001")
            )
            setattr(row, key, validate_cost(converted, key))
            _offer(key, FILLED)

    if any(
        status == FILLED
        for key, status in results.items()
        if key.startswith(_PARAM_RESULT_PREFIX)
    ):
        row.parameters_json = canonical_parameters(params)
        row.params_source = "models.dev"
    return results


def _refresh_best_effort(
    session: Session,
    *,
    fetch: Callable[[], dict[str, Any]] | None,
    settings: Settings,
) -> tuple[bool, dict[str, int]]:
    """Try one live refresh; on failure keep the stored snapshot (warning)."""
    if fetch is None:
        url = settings.models_dev_url
        timeout = settings.models_dev_timeout_seconds
        fetch = lambda: fetch_snapshot(url, timeout=timeout)  # noqa: E731
    try:
        counts = refresh_snapshot(session, fetch())
        session.flush()
        return True, counts
    except ModelsDevError as exc:
        LOGGER.warning("models.dev 刷新失败，改用库内快照兑入: %s", exc.message)
        return False, {}


def _adopt_item(
    row: UpstreamModelORM,
    *,
    rows: list[ModelDevSnapshotORM],
    fx_rate_micro: int | None,
    refreshed: bool,
) -> dict[str, Any]:
    matched, snapshots = _match_from_rows(rows, row.name)
    if not matched:
        return {
            "id": row.id,
            "name": row.name,
            "matched": False,
            "status": NO_MATCH,
            "results": {},
            "filled": [],
        }
    results = _adopt_from_snapshots(row, snapshots, fx_rate_micro=fx_rate_micro)
    filled = sorted(key for key, status in results.items() if status == FILLED)
    return {
        "id": row.id,
        "name": row.name,
        "matched": True,
        "provider": snapshots[0].provider,
        "model": snapshots[0].model,
        "refreshed": refreshed,
        "status": FILLED if filled else NOTHING_TO_FILL,
        "results": results,
        "filled": filled,
        "params_source": row.params_source,
    }


def adopt_model(
    session: Session,
    row: UpstreamModelORM,
    *,
    fetch: Callable[[], dict[str, Any]] | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Refresh the snapshot (best effort) then fill one row's blank keys.

    Network failure keeps the stored snapshot (ticket: 失败保留旧快照); with no
    snapshot at all the row is reported ``no-match`` and nothing is written.
    """
    resolved = settings or get_settings()
    refreshed, _counts = _refresh_best_effort(session, fetch=fetch, settings=resolved)
    rows = list(
        session.scalars(
            select(ModelDevSnapshotORM).order_by(
                ModelDevSnapshotORM.provider, ModelDevSnapshotORM.model
            )
        ).all()
    )
    return _adopt_item(row, rows=rows, fx_rate_micro=_usd_rate_micro(session), refreshed=refreshed)


def adopt_all(
    session: Session,
    *,
    fetch: Callable[[], dict[str, Any]] | None = None,
    settings: Settings | None = None,
    actor: str = "",
) -> dict[str, Any]:
    """One adopt pass over every upstream model (batch endpoint / daily job)."""
    resolved = settings or get_settings()
    refreshed, counts = _refresh_best_effort(session, fetch=fetch, settings=resolved)
    rows_snapshot = list(
        session.scalars(
            select(ModelDevSnapshotORM).order_by(
                ModelDevSnapshotORM.provider, ModelDevSnapshotORM.model
            )
        ).all()
    )
    fx_rate_micro = _usd_rate_micro(session)
    items: list[dict[str, Any]] = []
    for row in session.scalars(select(UpstreamModelORM)).all():
        items.append(
            _adopt_item(
                row, rows=rows_snapshot, fx_rate_micro=fx_rate_micro, refreshed=refreshed
            )
        )
    return {
        "refreshed": refreshed,
        "snapshot": counts,
        "total": len(items),
        "matched": sum(1 for item in items if item["matched"]),
        "filled_models": sum(1 for item in items if item["status"] == FILLED),
        "filled_keys": sum(len(item["filled"]) for item in items),
        "no_match": sum(1 for item in items if not item["matched"]),
        "items": items,
    }


# ------------------------------------------------------------- user exposure


def _merge_member_parameters(base: dict[str, Any], incoming: dict[str, Any]) -> None:
    """Fill base's blank keys from a member (same 只填空 semantics, no source)."""
    if base["max_input_tokens"] == 0 and incoming["max_input_tokens"] > 0:
        base["max_input_tokens"] = incoming["max_input_tokens"]
    if base["max_output_tokens"] == 0 and incoming["max_output_tokens"] > 0:
        base["max_output_tokens"] = incoming["max_output_tokens"]
    for key in ("input_types", "output_types"):
        if base[key] == _BLANK_DEFAULTS[key] and incoming[key] != _BLANK_DEFAULTS[key]:
            base[key] = list(incoming[key])
    for key in _BOOL_PARAM_KEYS:
        if base[key] is False and incoming[key] is True:
            base[key] = True
    if base["reasoning_level"] == "" and incoming["reasoning_level"]:
        base["reasoning_level"] = incoming["reasoning_level"]


def user_model_parameters(session: Session) -> list[dict[str, Any]]:
    """Enabled public models -> merged parameter block for GET /admin/my/models.

    Members are walked in priority order; the first enabled member seeds the
    block and later members fill its blank keys (same 只填空 semantics, no
    source tracking). No cost/markup key is ever included: this response feeds
    the playground and the 我的 page, which must not surface money.
    """
    public_rows = list(
        session.scalars(
            select(PublicModelORM)
            .where(PublicModelORM.enabled)
            .order_by(PublicModelORM.name)
        ).all()
    )
    items: list[dict[str, Any]] = []
    for public in public_rows:
        targets = list(
            session.scalars(
                select(ModelTargetORM)
                .where(
                    ModelTargetORM.public_model_id == public.id,
                    ModelTargetORM.enabled,
                )
                .order_by(ModelTargetORM.priority, ModelTargetORM.id)
            ).all()
        )
        merged: dict[str, Any] | None = None
        sources: list[str] = []
        model_type = ""
        for target in targets:
            member = session.get(UpstreamModelORM, target.upstream_model_id)
            if member is None or not member.enabled:
                continue
            decoded = decode_parameters(member.parameters_json)
            if merged is None:
                merged = decoded
                model_type = member.model_type
            else:
                _merge_member_parameters(merged, decoded)
            sources.append(member.name)
        if merged is None:
            continue
        items.append(
            {
                "name": public.name,
                "model_type": model_type,
                "parameters": merged,
                "sources": sources,
            }
        )
    return items
