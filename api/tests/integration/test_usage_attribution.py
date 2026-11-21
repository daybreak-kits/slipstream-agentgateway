"""Ticket 15: billing attribution strips the ADR-026 provider "#seq" suffix.

The renderer expands every upstream key row into its own AG provider, so a real
usage row's gen_ai_provider_name is "{upstream_id}#{seq}" - never the bare
upstream id. The billing resolver used to compare that raw string against the
upstream id, which never matched: two upstreams exposing the same model name
both attributed to whichever row came first in the table (the ledger
degenerated to the first same-named upstream).
"""

from __future__ import annotations

from decimal import Decimal

from tests.conftest import seed_channel

from l02_domain.models import UsageEvent
from l04_repo.orm import CostEntryORM, UpstreamModelORM, UpstreamORM
from l05_service import usage_ingest

NOW = 1_800_000_000_000
SECOND_UPSTREAM_ID = "ups_second"
SECOND_MODEL_ROW_ID = "umdl_second"


def _second_upstream_sharing_the_model_name(factory, seed: dict) -> None:
    """Second upstream, same upstream-model name, its own (more expensive) price row."""
    with factory() as session:
        session.add(
            UpstreamORM(
                id=SECOND_UPSTREAM_ID,
                name="testv-02",
                base_url="https://second.example/v1",
                api_style="openai_chat",
                api_key_enc="",
                created_at_ms=NOW,
            )
        )
        session.add(
            UpstreamModelORM(
                id=SECOND_MODEL_ROW_ID,
                upstream_id=SECOND_UPSTREAM_ID,
                name="glm-5.3",
                model_type="chat",
                created_at_ms=NOW,
                cost_input_per_1m=Decimal("5"),
                cost_output_per_1m=Decimal("20"),
                markup=Decimal("1.5"),
            )
        )
        first = session.get(UpstreamModelORM, seed["upstream_model_id"])
        first.cost_input_per_1m = Decimal("2.5")
        first.cost_output_per_1m = Decimal("10")
        first.markup = Decimal("1.2")
        session.commit()


def _event(event_id: str, seed: dict, provider: str) -> UsageEvent:
    return UsageEvent(
        event_id=event_id,
        started_at_ms=NOW,
        http_status=200,
        public_model="flagship",
        upstream_model="glm-5.3",
        provider=provider,
        api_key_id=seed["key_id"],
        input_tokens=1000,
        output_tokens=2000,
        total_tokens=3000,
    )


def _billed_costs(engine_and_sessionmaker) -> dict[str, CostEntryORM]:
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    _second_upstream_sharing_the_model_name(factory, seed)
    events = [
        _event("evt_first_key", seed, f"{seed['upstream_id']}#1"),
        _event("evt_second_key", seed, f"{SECOND_UPSTREAM_ID}#3"),
        _event("evt_second_no_suffix", seed, SECOND_UPSTREAM_ID),
        _event("evt_unknown_provider", seed, "青岚云"),
    ]
    with factory() as session:
        assert usage_ingest.ingest_usage_events(session, events) == len(events)
        usage_ingest.process_billing(session)
        session.commit()
        return {row.gateway_event_id: row for row in session.query(CostEntryORM).all()}


def test_key_expanded_provider_selects_its_own_upstream_model_row(
    engine_and_sessionmaker,
) -> None:
    costs = _billed_costs(engine_and_sessionmaker)

    # 1000 x 2.5 + 2000 x 10 = 22_500 micro (the first channel's row) vs
    # 1000 x 5 + 2000 x 20 = 45_000 micro (the second's): the amount proves
    # which model row priced the event.
    first = costs["evt_first_key"]
    assert first.upstream_model_id == "umdl_test"
    assert first.amount_micro == 22_500

    second = costs["evt_second_key"]
    assert second.upstream_model_id == SECOND_MODEL_ROW_ID
    assert second.amount_micro == 45_000

    # Backward compatibility: a pre-ADR-026 row carried the bare upstream id.
    legacy = costs["evt_second_no_suffix"]
    assert legacy.upstream_model_id == SECOND_MODEL_ROW_ID
    assert legacy.amount_micro == 45_000


def test_unmatched_provider_keeps_the_documented_first_match_fallback(
    engine_and_sessionmaker,
) -> None:
    """A display-name/unrelated provider still falls back to the first enabled
    same-named row (documented v1 approximation, unchanged by the strip)."""
    fallback = _billed_costs(engine_and_sessionmaker)["evt_unknown_provider"]
    assert fallback.upstream_model_id == "umdl_test"
    assert fallback.amount_micro == 22_500
