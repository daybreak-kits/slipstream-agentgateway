"""SQL-pushdown parity: v1 in-memory log search vs the SQL path (P2-7/P2-8).

The reference below is a verbatim copy of the search_logs body shipped before the
change (full table load, Python filter/sort/slice). The endpoint must return the
same total/items/next_offset for every filter, keyword, sort and page combination.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select
from tests.conftest import _app_client, make_admin, new_session_token

from l04_repo.orm import (
    ApiKeyORM,
    ChargeEntryORM,
    CostEntryORM,
    GatewayUsageEventORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
    UserORM,
)
from l06_api.deps import SESSION_COOKIE
from l06_api.routers_ops import (
    _cache_ratio,
    _identity_of,
    _identity_tables,
    _log_item,
    _parse_log_query,
    _raw_of,
)

# Deterministic clock so from_ms/to_ms cases stay exact; the endpoint echoes it.
_T = 1_735_000_000_000
_SORT_KEYS = ("started_at", "duration_ms", "total_tokens", "cost_micro", "charge_micro")


def _browser(factory):
    admin_id = make_admin(factory, username="parity-owner", role="admin")
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client


def _seed(factory) -> None:
    """Reference data plus a mixed event matrix: raw_json shapes, money, ties."""
    with factory() as session:
        session.add(UpstreamModelORM(id="umdl_glm", upstream_id="ups_x", name="glm-5.3"))
        session.add(UpstreamModelORM(id="umdl_bge", upstream_id="ups_x", name="bge-m3"))
        session.add(UpstreamModelORM(id="umdl_qwen", upstream_id="ups_x", name="qwen-max"))
        session.add(PublicModelORM(id="pmdl_flagship", name="flagship"))
        session.add(PublicModelORM(id="pmdl_embed", name="embed-small"))
        session.add(
            ModelTargetORM(
                id="mt_glm",
                public_model_id="pmdl_flagship",
                upstream_model_id="umdl_glm",
                priority=1,
            )
        )
        session.add(
            ModelTargetORM(
                id="mt_qwen",
                public_model_id="pmdl_flagship",
                upstream_model_id="umdl_qwen",
                priority=2,
            )
        )
        for user_id, name in (("usr_alice", "alice"), ("usr_bob", "bob"), ("usr_dana", "dana")):
            session.add(UserORM(id=user_id, name=name, created_at_ms=_T))
        for key_id, user_id, prefix, suffix in (
            ("key_alice", "usr_alice", "sk-abcd", "WXYZ"),
            ("key_bob", "usr_bob", "sk-efgh", "QRST"),
            ("key_dana", "usr_dana", "sk-ijkl", "MNOP"),
        ):
            session.add(
                ApiKeyORM(
                    id=key_id,
                    user_id=user_id,
                    prefix=prefix,
                    key_hash="sha256:" + key_id,
                    key_enc="",
                    key_suffix=suffix,
                    status="active",
                    created_at_ms=_T,
                )
            )
        # is_stream None means "no explicit verdict": the endpoint falls back to
        # ttft>0; a stored True/False always wins (adapter verdict, ticket 05).
        events = [
            # event_id, offset, duration, ttft, status, public, upstream, provider, key,
            # input, output, total, cache_read, requested, correlation, error,
            # has_payload, is_stream, raw
            (
                "evt_stream", -9000, 1400, 400, 200, "flagship", "glm-5.3", "testv",
                "key_alice", 1000, 600, 1600, 250, "", "trace-stream", "", True, True,
                {"cost": 0.002},
            ),
            (
                "evt_error", -8000, 900, 0, 429, "flagship", "glm-5.3", "testv",
                "key_bob", 200, 120, 320, 0, "", "", "upstream rate limited",
                False, False, None,
            ),
            (
                "evt_embed", -7000, 50, 0, 200, "embed-small", "bge-m3", "testv",
                "key_alice", 800, 0, 800, 0, "", "", "", False, None,
                {"seed": True},
            ),
            (
                "evt_slow", -6000, 5000, 1200, 200, "flagship", "qwen-max", "testv",
                "key_dana", 3000, 2000, 5000, 1000, "", "", "", False, False, None,
            ),
            (
                "evt_500", -5000, 10, 0, 500, "flagship", "glm-5.3", "altv",
                "key_bob", 10, 0, 10, 0, "", "", "", False, True, None,
            ),
            # no verdict and no ttft: falls back to non-streaming
            ("evt_badjson", -4000, 0, 0, 200, "flagship", "glm-5.3", "testv",
             "key_dana", 0, 0, 0, 0, "", "", "", False, None, "not-json-at-all"),
            ("evt_emptyraw", -3500, 0, 0, 204, "flagship", "glm-5.3", "testv",
             "key_dana", 0, 0, 0, 0, "", "", "", False, None, ""),
            # no key row at all: identity is blank, the key token must not match
            ("evt_nokey", -3000, 30, 0, 200, "flagship", "glm-5.3", "testv",
             None, 5, 5, 10, 0, "", "", "True", False, None, None),
            # non-ASCII raw stored verbatim: LIKE prefilter cannot see the
            # keyword, the fallback window must still catch it
            ("evt_unicode", -2500, 20, 0, 200, "flagship", "glm-5.3", "testv",
             "key_alice", 7, 0, 7, 0, "", "", "", False, None, {"note": "中文关键词"}),
            # two events share started_at: non-started sorts must tie-break on id
            ("evt_tie_b", -1500, 70, 0, 200, "embed-small", "bge-m3", "testv",
             "key_bob", 40, 10, 50, 0, "", "", "1", False, None, None),
            ("evt_tie_a", -1500, 70, 0, 200, "embed-small", "bge-m3", "testv",
             "key_dana", 40, 10, 50, 0, "", "", "[1]", False, None, None),
            ("evt_mixed", -1000, 5, 0, 200, "Embed-Small", "bge-M3", "TESTV",
             "key_alice", 1, 1, 2, 0, "embed-client", "", "boom", False, False, None),
        ]
        for (
            event_id, offset, duration, ttft, status, public, upstream, provider, key,
            input_tokens, output_tokens, total_tokens, cache_read, requested,
            correlation, error, has_payload, is_stream, raw,
        ) in events:
            session.add(
                GatewayUsageEventORM(
                    event_id=event_id,
                    started_at_ms=_T + offset,
                    completed_at_ms=_T + offset + duration,
                    duration_ms=duration,
                    time_to_first_token_ms=ttft,
                    http_status=status,
                    requested_model=requested,
                    public_model=public,
                    upstream_model=upstream,
                    provider=provider,
                    api_key_id=key,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    total_tokens=total_tokens,
                    cache_read_tokens=cache_read,
                    cache_write_tokens=0,
                    error=error,
                    has_payload=has_payload,
                    is_stream=is_stream,
                    correlation_key=correlation,
                    raw_json=(raw if isinstance(raw, str) else json.dumps(raw)),
                )
            )
        money = [
            ("co_stream", "evt_stream", "co_stream", 800, "CNY", "ok"),
            ("ch_stream", "evt_stream", "ch_stream", 1000, "CNY", "ok"),
            ("ch_error", "evt_error", "ch_error", 400, "CNY", "ok"),
            ("co_embed", "evt_embed", "co_embed", 120, "CNY", "ok"),
            ("ch_embed", "evt_embed", "ch_embed", 150, "CNY", "ok"),
            ("co_slow", "evt_slow", "co_slow", None, "", "unpriced"),
            ("ch_slow", "evt_slow", "ch_slow", 0, "CNY", "free"),
            ("co_500", "evt_500", "co_500", 30, "USD", "ok"),
            ("ch_500", "evt_500", "ch_500", 45, "USD", "ok"),
            ("co_nokey", "evt_nokey", "co_nokey", 50, "CNY", "ok"),
            ("ch_nokey", "evt_nokey", "ch_nokey", 60, "CNY", "ok"),
            ("co_tie_b", "evt_tie_b", "co_tie_b", 5, "CNY", "ok"),
            ("co_tie_a", "evt_tie_a", "co_tie_a", 5, "CNY", "ok"),
            ("ch_tie_a", "evt_tie_a", "ch_tie_a", 9, "CNY", "ok"),
        ]
        for row_id, event_id, _id, amount, currency, status in money:
            if row_id.startswith("co_"):
                session.add(
                    CostEntryORM(
                        id=row_id,
                        gateway_event_id=event_id,
                        amount_micro=amount,
                        currency=currency,
                        status=status,
                        created_at_ms=_T,
                    )
                )
            else:
                session.add(
                    ChargeEntryORM(
                        id=row_id,
                        gateway_event_id=event_id,
                        amount_micro=amount,
                        currency=currency,
                        status=status,
                        created_at_ms=_T,
                    )
                )
        session.commit()


def _normalized_stream(row) -> bool:
    """Ticket 05 read rule: an adapter verdict wins, otherwise the TTFT fallback."""
    if row.is_stream is not None:
        return bool(row.is_stream)
    return (row.time_to_first_token_ms or 0) > 0


def _legacy_matches(row, parsed, *, identity, is_stream, cache_ratio, raw) -> bool:
    """The in-memory twin of the endpoint's filter, kept as the parity oracle."""
    user_id, user_name, api_key_label = identity
    model_text = f"{row.public_model or ''} {row.upstream_model or ''}".lower()
    upstream_text = f"{row.provider or ''} {row.upstream_model or ''}".lower()
    if any(value not in model_text for value in parsed.models):
        return False
    if any(value not in upstream_text for value in parsed.upstreams):
        return False
    user_text = f"{user_name} {user_id}".lower()
    if any(value not in user_text for value in parsed.users):
        return False
    key_text = f"{api_key_label} {row.api_key_id or ''} {user_id}".lower()
    if any(value not in key_text for value in parsed.keys):
        return False
    if parsed.statuses and not any(
        floor <= (row.http_status or 0) < ceiling for floor, ceiling in parsed.statuses
    ):
        return False
    if parsed.min_latency and (row.duration_ms or 0) <= parsed.min_latency:
        return False
    if parsed.max_latency and not 0 < (row.duration_ms or 0) < parsed.max_latency:
        return False
    if parsed.min_ttft and (row.time_to_first_token_ms or 0) <= parsed.min_ttft:
        return False
    if parsed.min_cache_ratio >= 0 and (
        cache_ratio is None or cache_ratio < parsed.min_cache_ratio
    ):
        return False
    if parsed.stream is not None and is_stream is not parsed.stream:
        return False
    if parsed.keywords:
        haystack = json.dumps(
            {
                "id": row.event_id,
                "models": [row.public_model, row.upstream_model, row.provider],
                "requested_model": row.requested_model,
                "correlation_key": row.correlation_key,
                "error": row.error,
                "identity": [user_name, api_key_label, row.api_key_id],
                "raw": raw,
            },
            ensure_ascii=False,
        ).lower()
        if any(keyword not in haystack for keyword in parsed.keywords):
            return False
    return True


def _legacy_search(
    session,
    *,
    query: str = "",
    from_ms: int = 0,
    to_ms: int = 0,
    sort: str = "started_at",
    order: str = "desc",
    has_error: bool | None = None,
    page_size: int = 25,
    offset: int = 0,
) -> dict:
    """The v1 search_logs body, kept as the parity oracle."""
    limit, off = page_size, offset
    parsed = _parse_log_query(query)
    rows = list(
        session.scalars(
            select(GatewayUsageEventORM).order_by(
                GatewayUsageEventORM.started_at_ms.desc(), GatewayUsageEventORM.event_id.desc()
            )
        ).all()
    )
    keys_by_id, users_by_id = _identity_tables(session)
    raws = {row.event_id: _raw_of(row) for row in rows}
    identities = {
        row.event_id: _identity_of(row.api_key_id, keys_by_id, users_by_id) for row in rows
    }
    streams = {row.event_id: _normalized_stream(row) for row in rows}
    ratios = {row.event_id: _cache_ratio(row) for row in rows}
    rows = [
        row
        for row in rows
        if _legacy_matches(
            row,
            parsed,
            identity=identities[row.event_id],
            is_stream=streams[row.event_id],
            cache_ratio=ratios[row.event_id],
            raw=raws[row.event_id],
        )
    ]
    if from_ms:
        rows = [r for r in rows if r.started_at_ms >= from_ms]
    if to_ms:
        rows = [r for r in rows if r.started_at_ms < to_ms]
    if has_error is not None:
        rows = [r for r in rows if bool(r.error) == has_error]
    charge_by_event = {
        row.gateway_event_id: row for row in session.scalars(select(ChargeEntryORM)).all()
    }
    cost_by_event = {
        row.gateway_event_id: row for row in session.scalars(select(CostEntryORM)).all()
    }
    reverse = order == "desc"

    def _cost_amount(row) -> int:
        entry = cost_by_event.get(row.event_id)
        return entry.amount_micro if entry is not None and entry.amount_micro is not None else -1

    def _charge_amount(row) -> int:
        entry = charge_by_event.get(row.event_id)
        return entry.amount_micro if entry is not None and entry.amount_micro is not None else -1

    if sort == "started_at":
        rows.sort(key=lambda r: (r.started_at_ms, r.event_id), reverse=reverse)
    elif sort == "duration_ms":
        rows.sort(key=lambda r: r.duration_ms or 0, reverse=reverse)
    elif sort == "total_tokens":
        rows.sort(key=lambda r: r.total_tokens or 0, reverse=reverse)
    elif sort == "cost_micro":
        rows.sort(key=_cost_amount, reverse=reverse)
    else:
        rows.sort(key=_charge_amount, reverse=reverse)
    total = len(rows)
    rows = rows[off : off + limit]
    umodel_ids_by_name = {
        row.name: row.id for row in session.scalars(select(UpstreamModelORM)).all()
    }
    target_priorities = {
        (t_row.public_model_id, t_row.upstream_model_id): t_row.priority
        for t_row in session.scalars(select(ModelTargetORM)).all()
    }
    public_by_name = {
        row.name: row.id for row in session.scalars(select(PublicModelORM)).all()
    }
    items = []
    for row in rows:
        public_id = public_by_name.get(row.public_model, "")
        umodel_id = umodel_ids_by_name.get(row.upstream_model, "")
        charge = charge_by_event.get(row.event_id)
        cost = cost_by_event.get(row.event_id)
        items.append(
            _log_item(
                row,
                identity=identities[row.event_id],
                upstream_model_id=umodel_id,
                target_priority=target_priorities.get((public_id, umodel_id))
                if public_id
                else None,
                cost_micro=cost.amount_micro if cost else None,
                charge_micro=charge.amount_micro if charge else None,
                currency=(charge.currency if charge else (cost.currency if cost else "")),
            )
        )
    next_offset = off + limit if off + limit < total else None
    return {"total": total, "items": items, "next_offset": next_offset}


_CASES = [
    {},
    {"query": "model:flagship"},
    {"query": "model:GLM"},
    {"query": "model:embed"},
    {"query": "model:glm-5.3"},
    {"query": "upstream:testv"},
    {"query": "upstream:BGE"},
    {"query": "user:alice"},
    {"query": "user:usr_"},
    {"query": "user:dan"},
    {"query": "key:WXYZ"},
    {"query": "key:sk-abcd...WXYZ"},
    {"query": "key:key_ali"},
    {"query": "status:200"},
    {"query": "status:4xx"},
    {"query": "status:200 status:500"},
    {"query": "latency>3000"},
    {"query": "latency<1000"},
    {"query": "ttft>500"},
    {"query": "cache>10"},
    {"query": "cache>0"},
    {"query": "stream:true"},
    {"query": "stream:false"},
    {"query": "user:alice status:200 stream:true"},
    {"query": "alice"},
    {"query": "ALICE"},
    {"query": "trace-stream"},
    {"query": "id"},
    {"query": "models"},
    {"query": "raw"},
    {"query": "error"},
    {"query": "中文"},
    {"query": "0.002"},
    {"query": "sk-abcd"},
    {"query": "seed"},
    {"query": "alice trace"},
    {"query": "user:alice bge"},
    *({"sort": sort, "order": order} for sort in _SORT_KEYS for order in ("asc", "desc")),
    {"sort": "duration_ms", "order": "asc", "offset": 5},
    {"sort": "total_tokens", "order": "desc", "offset": 3, "page_size": 25},
    {"offset": 20},
    {"offset": 200},
    {"from_ms": _T - 6000},
    {"to_ms": _T - 4000},
    {"from_ms": _T - 6000, "to_ms": _T - 2000},
    {"has_error": True},
    {"has_error": False, "sort": "duration_ms", "order": "asc"},
]

_CASE_IDS = [f"case-{index:02d}" for index in range(len(_CASES))]


@pytest.mark.parametrize("case", _CASES, ids=_CASE_IDS)
def test_sql_search_matches_v1(case, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed(factory)
    browser = _browser(factory)
    with factory() as session:
        expected = _legacy_search(session, **case)
    response = browser.get("/admin/logs", params={"page_size": 25, **case})
    assert response.status_code == 200, response.text
    assert response.json() == expected
