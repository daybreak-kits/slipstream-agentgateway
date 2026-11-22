"""Neutral facts read from a normalized usage row.

These helpers sit between the repository rows and both the log query matcher
and the HTTP item assembly. They contain no SQL pushdown and no query syntax;
the other consumers (item mapping, detail drawer, parity tests) read the same
facts without re-deriving them.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from l04_repo.orm import ApiKeyORM, GatewayUsageEventORM, UserORM
from l05_service import client_keys


def raw_of(payload: str | None) -> dict:
    """Parsed raw_json (the collected wire row); {} when absent or malformed.

    Diagnostic attachment only (ADR-029): keyword search rides it, but every
    product fact below is a neutral column the adapter normalized at ingest
    time; the system API never re-derives facts from wire attributes.
    """
    try:
        value = json.loads(payload or "{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def stream_verdict(row: GatewayUsageEventORM) -> bool:
    """Adapter verdict wins; without one, a TTFT marks the stream (neutral rule)."""
    if row.is_stream is not None:
        return bool(row.is_stream)
    return (row.time_to_first_token_ms or 0) > 0


def cache_ratio(row: GatewayUsageEventORM) -> float | None:
    """Cache hit ratio in percent, using the ledger's containment rule.

    Input tokens normally already contain the cached ones; only when a vendor
    reports them in parallel (cached > input) is the denominator the sum, so the
    number matches the billing ledger instead of double-counting the cache.
    """
    cached = row.cache_read_tokens or 0
    if cached <= 0:
        return None
    prompt = row.input_tokens or 0
    denominator = prompt if prompt >= cached else prompt + cached
    if denominator <= 0:
        return None
    return round(cached * 100.0 / denominator, 1)


def identity_tables(session: Session) -> tuple[dict[str, ApiKeyORM], dict[str, UserORM]]:
    keys = {row.id: row for row in session.scalars(select(ApiKeyORM)).all()}
    users = {row.id: row for row in session.scalars(select(UserORM)).all()}
    return keys, users


def identity_of(
    event_key_id: str | None,
    keys: dict[str, ApiKeyORM],
    users: dict[str, UserORM],
) -> tuple[str, str, str]:
    """(user_id, user_name, masked key) for one event; blanks when the key is gone."""
    key = keys.get(event_key_id or "")
    if key is None:
        return "", "", ""
    user = users.get(key.user_id)
    return (
        key.user_id,
        user.name if user is not None else "",
        client_keys.mask_of(key.prefix, key.key_suffix),
    )
