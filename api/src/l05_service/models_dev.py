"""models.dev snapshot fetch / match / adopt (W4-H, W9 adoption fixes).

One service, three concerns:

1. **fetch** ``https://models.dev/api.json`` — exactly ONE httpx GET with a
   hard 60-second timeout and a response-size cap; ZERO automatic retries.
   Any failure raises ``ModelsDevError`` and callers keep the previous
   snapshot (warning logged). A retry is a human decision (click again), never
   a silent loop: models.dev is a slow external boundary and the console/job
   already degrade to the stored snapshot.
2. **refresh + match** — a successful fetch replaces ``model_dev_snapshots``
   wholesale (it IS a snapshot, not history). Upstream models are matched by
   NAME: exact case-sensitive first, then a UNIQUE case-insensitive hit, then
   the vendor-prefix form is stripped (``minimaxai/minimax-m3.1-flash`` ->
   ``minimax-m3.1-flash``) and the basename is tried exact /
   case-insensitive. Several providers mirror the same model id
   (aggregators): the matched duplicate group MERGES — numeric limits take the
   maximum, modalities and reasoning levels the union, capability flags OR —
   so a bare mirror can never shrink the authoritative row's capabilities.
3. **adopt** — fill ONLY blank keys of an upstream model: ``0`` / ``False`` /
   default single-modality list / empty reasoning declaration / NULL cost
   count as blank (0 = 未声明, old console semantics); a value the user typed
   is never overwritten. models.dev quotes USD per 1M tokens and the cost book
   now also stores USD (the system default currency), so cost adoption writes
   the price through UNCHANGED — no fx_snapshots USD->CNY conversion (the
   legacy ``skipped-no-fx`` status stays defined for the API/web contract but
   is no longer emitted). When duplicate providers disagree on price, the row
   whose provider matches the upstream's provider clue wins and the group
   maximum is the conservative fallback — prices are never averaged.
   ``reasoning_options`` of type ``effort`` feed ``reasoning_levels`` /
   ``default_reasoning_level``; ``toggle`` / ``budget_tokens`` do not name
   discrete levels and deliberately fill nothing (documented safe mapping).
   Per-key results use filled / skipped-manual / no-match so the console can
   toast exactly what happened.

The daily job (l07_jobs.models_dev_sync) runs the same adopt pass; the console
buttons hit the /admin/upstream-models adopt endpoints which share this
module. Tests inject a fake ``fetch`` callable — no network anywhere.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.settings import Settings, get_settings
from l01_core.timeutil import now_ms
from l04_repo.orm import (
    ModelDevSnapshotORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
    UpstreamORM,
)
from l05_service.model_params import (
    INPUT_TYPES,
    MAX_TOKEN_LIMIT,
    OUTPUT_TYPES,
    REASONING_LEVELS,
    canonical_parameters,
    decode_parameters,
)
from l05_service.pricing import validate_cost

LOGGER = logging.getLogger("slipstream.modelsdev")

MODELS_DEV_URL = "https://models.dev/api.json"
#: Guards against a hostile/broken mirror: api.json is ~7 MB today; 64 MB is
#: generous headroom while still bounding memory.
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
#: The fetch contract is ONE request with a hard 60-second timeout. There is no
#: retry constant on purpose: retrying belongs to the human clicking again, not
#: to a background request loop (the daily job already degrades to the stored
#: snapshot and only retries on the next calendar pass).
FETCH_TIMEOUT_SECONDS = 60.0

#: adopt result statuses (returned per key, verbatim in the API contract).
FILLED = "filled"
SKIPPED_MANUAL = "skipped-manual"
#: Legacy: models.dev USD prices are now stored as USD directly (no fx
#: conversion), so adopt no longer emits this status. Kept defined because the
#: API contract / web console still know the value and a future currency knob
#: may bring it back.
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
    """GET the api.json payload ONCE with a hard timeout / size cap (sync httpx).

    Exactly one HTTP request is issued: there are NO automatic retries. Any
    failure raises ``ModelsDevError`` immediately and the caller decides the
    degradation (keep the stored snapshot, show the error to the admin); a
    retry means the user clicks again. ``transport`` is an httpx injection
    point for offline tests (real callers never pass it).
    """
    resolved_url = url or get_settings().models_dev_url
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
        # ModelsDevError (oversize / non-JSON) is an AppError and is NOT
        # translated: this arm only covers the transport / HTTP / header layer.
        LOGGER.warning("models.dev 拉取失败（单次请求，不重试）: %s", exc)
        raise ModelsDevError(
            "models.dev 拉取失败",
            details={"url": resolved_url, "error": str(exc)},
        ) from exc


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


def snapshot_status(session: Session) -> dict[str, Any]:
    """Summary of the stored snapshot for the console「上次同步」line.

    Reads only the snapshot table (no fetch): models/providers counts and the
    newest fetched_at_ms (0 when the table is empty because nothing ever synced).
    """
    models, providers, fetched_at_ms = session.execute(
        select(
            func.count(ModelDevSnapshotORM.model),
            func.count(func.distinct(ModelDevSnapshotORM.provider)),
            func.max(ModelDevSnapshotORM.fetched_at_ms),
        )
    ).one()
    return {
        "models": int(models or 0),
        "providers": int(providers or 0),
        "fetched_at_ms": int(fetched_at_ms or 0),
    }


def _row_richness(row: ModelDevSnapshotORM) -> int:
    """How much the snapshot row knows about THIS model (fields stored as received).

    Vendor rows carry capability flags + modalities + limits + costs; aggregator
    mirrors of the same exact id are usually bare stubs. Merging richest-first
    keeps the authoritative value winning the fill instead of whoever sorts
    first alphabetically.
    """
    return len(_params_of(row)) + len(_cost_of(row))


def _sorted_group(rows: list[ModelDevSnapshotORM]) -> list[ModelDevSnapshotORM]:
    """Deterministic merge order: richest row first, provider id as tiebreak."""
    return sorted(rows, key=lambda row: (-_row_richness(row), row.provider, row.model))


#: Normalized provider strings shorter than this only match EXACTLY; containment
#: is reserved for real vendor names so e.g. "ai" cannot swallow every provider.
_MIN_PROVIDER_HINT = 3


def _vendor_basename(name: str) -> str:
    """Strip the optional vendor prefix: "minimaxai/minimax-m3.1-flash" -> the id."""
    return name.rsplit("/", 1)[-1].strip()


def _vendor_prefix(name: str) -> str:
    """Vendor part of "minimaxai/minimax-m3.1-flash"; empty without a slash."""
    head, sep, _tail = name.rpartition("/")
    return head.strip() if sep else ""


def _normalize_provider(value: str) -> str:
    """Provider comparison key: lowercase alphanumerics only."""
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _provider_hints(session: Session, row: UpstreamModelORM) -> tuple[str, ...]:
    """Clues identifying which models.dev provider publishes this upstream model.

    Sources: the upstream flag/alias (an upstream named nvidia should prefer
    models.dev's nvidia row) and the model's vendor prefix (minimaxai/... ->
    provider minimax). Normalized containment is allowed because mirrors
    abbreviate vendor names; short strings must match exactly.
    """
    candidates: list[str] = []
    upstream = session.get(UpstreamORM, row.upstream_id)
    if upstream is not None:
        candidates.extend(part for part in (upstream.name, upstream.alias) if part)
    candidates.append(_vendor_prefix(row.name))
    hints: list[str] = []
    for candidate in candidates:
        normalized = _normalize_provider(candidate)
        if normalized and normalized not in hints:
            hints.append(normalized)
    return tuple(hints)


def _provider_matches(provider: str, hints: tuple[str, ...]) -> bool:
    """True when a models.dev provider id plausibly is the upstream's provider."""
    normalized = _normalize_provider(provider)
    if not normalized:
        return False
    for hint in hints:
        if normalized == hint:
            return True
        if len(normalized) >= _MIN_PROVIDER_HINT and len(hint) >= _MIN_PROVIDER_HINT:
            if normalized in hint or hint in normalized:
                return True
    return False


def _order_group(
    rows: list[ModelDevSnapshotORM],
    provider_hints: tuple[str, ...] = (),
) -> list[ModelDevSnapshotORM]:
    """Merge order: provider-matching row first, then richest, then provider id."""
    if not provider_hints:
        return _sorted_group(rows)
    return sorted(
        rows,
        key=lambda row: (
            0 if _provider_matches(row.provider, provider_hints) else 1,
            -_row_richness(row),
            row.provider,
            row.model,
        ),
    )


def _match_from_rows(
    rows: list[ModelDevSnapshotORM], name: str
) -> tuple[bool, list[ModelDevSnapshotORM]]:
    """Exact-first, unique-case-insensitive-second name match; never fuzzy.

    W9 adds a vendor-prefix aware third phase: upstream names may arrive as
    vendor/model while models.dev publishes the bare model id. Matching never
    guesses substrings; a duplicate group (the same model published by many
    providers) is returned whole so adopt can merge it deterministically.
    """
    exact = [row for row in rows if row.model == name]
    if exact:
        return True, _sorted_group(exact)
    lowered = [row for row in rows if row.model.lower() == name.lower()]
    if len(lowered) == 1:
        return True, lowered
    if lowered:
        # Case-insensitive but several mirrors -> the existing no-guessing rule
        # still applies to the full-name phase (exact match is the way in).
        return False, []
    basename = _vendor_basename(name)
    if not basename or basename == name:
        return False, []
    exact_base = [
        row
        for row in rows
        if row.model == basename or _vendor_basename(row.model) == basename
    ]
    if exact_base:
        return True, _sorted_group(exact_base)
    lowered_base = [
        row
        for row in rows
        if row.model.lower() == basename.lower()
        or _vendor_basename(row.model).lower() == basename.lower()
    ]
    if lowered_base:
        return True, _sorted_group(lowered_base)
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


#: models.dev reasoning_options entries of type "effort" name explicit effort
#: levels. "toggle" (on/off) and "budget_tokens" (a token budget) do not name a
#: discrete level, so they deliberately fill nothing — inventing low/medium/high
#: for them would fabricate capabilities models.dev never declared. This is the
#: documented safe mapping for the two other option types.
_EFFORT_OPTION_TYPE = "effort"

#: A parameter key is blank (= 未声明, adoptable) exactly when its current value
#: equals the undeclared default: 0 for limits, False for flags, the mandated
#: single-entry list for modalities, [] / "" for the reasoning declaration.
#: reasoning_level (singular) has no models.dev equivalent, so it is never
#: adoptable; reasoning_levels / default_reasoning_level are adoptable from
#: models.dev effort options only (see _merge_reasoning_levels).
_BLANK_DEFAULTS = {
    "max_input_tokens": 0,
    "max_output_tokens": 0,
    "reasoning_level": "",
    "reasoning_levels": [],
    "default_reasoning_level": "",
    "input_types": ["text"],
    "output_types": ["text"],
    "tool_call": False,
    "reasoning": False,
    "attachment": False,
    "structured_output": False,
}

_BOOL_PARAM_KEYS = ("tool_call", "reasoning", "attachment", "structured_output")


def _merge_limits(snapshots: list[ModelDevSnapshotORM]) -> tuple[int, int]:
    """(max input, max output) over the duplicate group; 0 = undeclared.

    Both models.dev's nested limit.context / limit.output and the flat
    max_input_tokens / max_output_tokens spelling some mirrors use are read;
    duplicates merge by MAX so a bare mirror can never shrink a limit.
    """
    max_input = 0
    max_output = 0
    for snapshot in snapshots:
        source = _params_of(snapshot)
        limit = source.get("limit") if isinstance(source.get("limit"), dict) else {}
        max_input = max(
            max_input,
            _positive_int(limit.get("context")),
            _positive_int(source.get("max_input_tokens")),
        )
        max_output = max(
            max_output,
            _positive_int(limit.get("output")),
            _positive_int(source.get("max_output_tokens")),
        )
    return max_input, max_output


def _merge_modalities(
    snapshots: list[ModelDevSnapshotORM],
    raw_field: str,
    allowed: tuple[str, ...],
    extra: dict[str, str],
) -> list[str]:
    """Union of the duplicate group's modalities, order kept, dupes dropped."""
    merged: list[str] = []
    for snapshot in snapshots:
        source = _params_of(snapshot)
        modalities = (
            source.get("modalities") if isinstance(source.get("modalities"), dict) else {}
        )
        for value in _mapped_modalities(modalities.get(raw_field), allowed, extra):
            if value not in merged:
                merged.append(value)
    return merged


def _merge_flags(snapshots: list[ModelDevSnapshotORM]) -> dict[str, bool]:
    """Capability flags OR-ed over the duplicate group (True is authoritative)."""
    return {
        key: any(_params_of(snapshot).get(key) is True for snapshot in snapshots)
        for key in _BOOL_PARAM_KEYS
    }


def _merge_reasoning_levels(snapshots: list[ModelDevSnapshotORM]) -> list[str]:
    """Union of models.dev effort values mapped onto our reasoning levels.

    Only effort values that exist in REASONING_LEVELS are accepted. When the
    group exposes at least one effort, "default" (= 不传) is declared as well:
    it is always a legal choice and the safe stand-in for the provider default
    that models.dev does not spell out. Order follows REASONING_LEVELS.
    """
    found: set[str] = set()
    for snapshot in snapshots:
        options = _params_of(snapshot).get("reasoning_options")
        if not isinstance(options, list):
            continue
        for option in options:
            if not isinstance(option, dict) or option.get("type") != _EFFORT_OPTION_TYPE:
                continue
            values = option.get("values")
            if not isinstance(values, list):
                continue
            for value in values:
                if isinstance(value, str) and value in REASONING_LEVELS:
                    found.add(value)
    if not found:
        return []
    return [level for level in REASONING_LEVELS if level == "default" or level in found]


def _usd_number(raw: object) -> int | float | None:
    """models.dev cost number (USD per 1M tokens); bools/negatives rejected."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return raw if raw >= 0 else None


def _usd_price(
    snapshots: list[ModelDevSnapshotORM],
    key: str,
    provider_hints: tuple[str, ...],
) -> int | float | None:
    """Pick one USD price for a cost bucket across the duplicate group.

    The row whose provider matches the upstream's provider clue wins (its own
    quote is authoritative). Without such a row — or when it does not price the
    bucket — the group MAXIMUM is the conservative fallback. Prices are never
    averaged, so a cheap aggregator mirror cannot silently dilute the cost book.
    """
    for snapshot in snapshots:
        if not _provider_matches(snapshot.provider, provider_hints):
            continue
        price = _usd_number(_cost_of(snapshot).get(key))
        if price is not None:
            return price
        break
    prices = [
        price
        for snapshot in snapshots
        if (price := _usd_number(_cost_of(snapshot).get(key))) is not None
    ]
    return max(prices) if prices else None


def _adopt_from_snapshots(
    row: UpstreamModelORM,
    snapshots: list[ModelDevSnapshotORM],
    *,
    provider_hints: tuple[str, ...] = (),
) -> dict[str, str]:
    """Fill blank keys from the merged duplicate group; returns per-key status.

    The group is reordered provider-preferred first, then every value is merged
    across ALL its rows: limits by max, modalities / reasoning levels by union,
    flags by OR, prices provider-first with a max fallback. Fill-blank semantics
    stay: a value the user typed is never overwritten.
    """
    results: dict[str, str] = {}
    params = decode_parameters(row.parameters_json)
    group = _order_group(snapshots, provider_hints)

    def _record(key: str, filled: bool) -> None:
        results[_PARAM_RESULT_PREFIX + key] = FILLED if filled else SKIPPED_MANUAL

    max_input, max_output = _merge_limits(group)
    for key, merged in (
        ("max_input_tokens", max_input),
        ("max_output_tokens", max_output),
    ):
        if params[key] != _BLANK_DEFAULTS[key]:
            _record(key, False)
        elif merged > 0:
            params[key] = merged
            _record(key, True)
        else:
            _record(key, False)

    for key, raw_field, allowed, extra in (
        ("input_types", "input", INPUT_TYPES, _INPUT_MODALITY_MAP),
        ("output_types", "output", OUTPUT_TYPES, _OUTPUT_MODALITY_MAP),
    ):
        if params[key] != _BLANK_DEFAULTS[key]:
            _record(key, False)
            continue
        merged_modalities = _merge_modalities(group, raw_field, allowed, extra)
        if merged_modalities:
            params[key] = merged_modalities
            _record(key, True)
        else:
            _record(key, False)

    flags = _merge_flags(group)
    for key in _BOOL_PARAM_KEYS:
        if params[key] is not _BLANK_DEFAULTS[key]:
            _record(key, False)
        elif flags[key]:
            params[key] = True
            _record(key, True)
        else:
            _record(key, False)

    # reasoning_levels / default_reasoning_level: effort values only. "default"
    # (不传) is included whenever efforts exist and becomes the declared default,
    # matching the old console where "default" was always an offered level.
    effort_levels = _merge_reasoning_levels(group)
    if params["reasoning_levels"] != _BLANK_DEFAULTS["reasoning_levels"]:
        results[_PARAM_RESULT_PREFIX + "reasoning_levels"] = SKIPPED_MANUAL
    elif effort_levels:
        params["reasoning_levels"] = effort_levels
        results[_PARAM_RESULT_PREFIX + "reasoning_levels"] = FILLED
    else:
        results[_PARAM_RESULT_PREFIX + "reasoning_levels"] = SKIPPED_MANUAL
    if params["default_reasoning_level"] != _BLANK_DEFAULTS["default_reasoning_level"]:
        results[_PARAM_RESULT_PREFIX + "default_reasoning_level"] = SKIPPED_MANUAL
    elif "default" in params["reasoning_levels"]:
        params["default_reasoning_level"] = "default"
        results[_PARAM_RESULT_PREFIX + "default_reasoning_level"] = FILLED
    else:
        results[_PARAM_RESULT_PREFIX + "default_reasoning_level"] = SKIPPED_MANUAL

    # Costs: stored as USD per 1M tokens DIRECTLY (the system default currency);
    # no fx_snapshots conversion. Only a NULL cost is blank — an explicit 0
    # price is a deliberate manual value.
    for key, usd_key in (
        ("cost_input_per_1m", "input"),
        ("cost_output_per_1m", "output"),
    ):
        if getattr(row, key) is not None:
            results[key] = SKIPPED_MANUAL
            continue
        usd = _usd_price(group, usd_key, provider_hints)
        if usd is None:
            results[key] = SKIPPED_MANUAL
            continue
        setattr(row, key, validate_cost(Decimal(str(usd)), key))
        results[key] = FILLED

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
    """Try ONE live refresh (single request, no retry); on failure keep snapshot."""
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
    refreshed: bool,
    provider_hints: tuple[str, ...] = (),
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
    results = _adopt_from_snapshots(row, snapshots, provider_hints=provider_hints)
    filled = sorted(key for key, status in results.items() if status == FILLED)
    chosen = _order_group(snapshots, provider_hints)[0]
    return {
        "id": row.id,
        "name": row.name,
        "matched": True,
        "provider": chosen.provider,
        "model": chosen.model,
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
    return _adopt_item(
        row,
        rows=rows,
        refreshed=refreshed,
        provider_hints=_provider_hints(session, row),
    )


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
    items: list[dict[str, Any]] = []
    for row in session.scalars(select(UpstreamModelORM)).all():
        items.append(
            _adopt_item(
                row,
                rows=rows_snapshot,
                refreshed=refreshed,
                provider_hints=_provider_hints(session, row),
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
    if base["reasoning_levels"] == [] and incoming["reasoning_levels"]:
        base["reasoning_levels"] = list(incoming["reasoning_levels"])
    if base["default_reasoning_level"] == "" and incoming["default_reasoning_level"]:
        base["default_reasoning_level"] = incoming["default_reasoning_level"]


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
