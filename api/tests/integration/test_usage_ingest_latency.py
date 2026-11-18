"""W1a: AG latency fields survive ingestion + api_keys.last_used_at batch update.

The ingest used to drop completed_at_ms / duration_ms / time_to_first_token_ms
(AG real-time events kept them at 0, breaking latency quantiles and the
latency>/ttft> log filters), and never refreshed the key's last-used stamp.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from tests.conftest import seed_channel

from l02_domain.models import UsageEvent
from l05_service.usage_ingest import ingest_usage_events


def _ag_event(
    event_id: str, started: int, *, duration: int = 1500, ttft: int = 300, key_id: str = "key_a"
) -> UsageEvent:
    """One AG request_logs shaped row with the full latency triple."""
    return UsageEvent(
        event_id=event_id,
        started_at_ms=started,
        completed_at_ms=started + duration,
        duration_ms=duration,
        time_to_first_token_ms=ttft,
        http_status=200,
        public_model="flagship",
        upstream_model="glm-5.3",
        provider="ups_test",
        api_key_id=key_id,
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
    )


def test_ingest_persists_the_three_latency_fields(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    seed_channel(engine_and_sessionmaker[0], factory)
    started = 1_800_000_000_000
    with factory() as session:
        added = ingest_usage_events(
            session,
            [_ag_event("evt_lat", started), _ag_event("evt_zero", started + 1, ttft=0)],
        )
        session.commit()
        assert added == 2
        row = session.execute(
            text(
                "SELECT completed_at_ms, duration_ms, time_to_first_token_ms "
                "FROM gateway_usage_events WHERE event_id = 'evt_lat'"
            )
        ).one()
        assert row == (started + 1500, 1500, 300)
        # A non-streaming row (ttft 0) still stores what AG reported, verbatim.
        row2 = session.execute(
            text(
                "SELECT completed_at_ms, duration_ms, time_to_first_token_ms "
                "FROM gateway_usage_events WHERE event_id = 'evt_zero'"
            )
        ).one()
        assert row2 == (started + 1 + 1500, 1500, 0)


def test_last_used_at_updated_for_ingested_keys(engine_and_sessionmaker):
    """The W1b column (api_keys.last_used_at_ms) advances with ingested usage."""
    _, factory = engine_and_sessionmaker
    seed = seed_channel(engine_and_sessionmaker[0], factory)
    first = 1_800_000_000_000
    later = first + 90_000
    key_id = seed["key_id"]
    with factory() as session:
        ingest_usage_events(session, [_ag_event("evt_u1", first, key_id=key_id)])
        session.commit()
        stamp = session.execute(
            text("SELECT last_used_at_ms FROM api_keys WHERE id = :k"), {"k": key_id}
        ).scalar()
        assert stamp == first

        # A later batch moves the stamp forward; the old event replays unchanged.
        ingest_usage_events(
            session,
            [
                _ag_event("evt_u2", later, key_id=key_id),
                _ag_event("evt_u1", first, key_id=key_id),
                _ag_event("evt_nokey", later + 1, duration=10, ttft=0),
            ],
        )
        session.commit()
        stamp = session.execute(
            text("SELECT last_used_at_ms FROM api_keys WHERE id = :k"), {"k": key_id}
        ).scalar()
        assert stamp == later


def test_ingest_skips_last_used_when_column_missing(engine_and_sessionmaker):
    """Databases created before W1b lack the column; ingestion must not crash."""
    _, factory = engine_and_sessionmaker
    seed_channel(engine_and_sessionmaker[0], factory)
    engine, _ = engine_and_sessionmaker
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE api_keys DROP COLUMN last_used_at_ms"))
    with factory() as session:
        added = ingest_usage_events(session, [_ag_event("evt_nocol", 1_800_000_000_000)])
        session.commit()
        assert added == 1


@pytest.mark.parametrize("event_id", ["evt_lat"])
def test_replay_is_idempotent(engine_and_sessionmaker, event_id):
    _, factory = engine_and_sessionmaker
    seed_channel(engine_and_sessionmaker[0], factory)
    with factory() as session:
        assert ingest_usage_events(session, [_ag_event(event_id, 1_800_000_000_000)]) == 1
        assert ingest_usage_events(session, [_ag_event(event_id, 1_800_000_000_000)]) == 0
        session.commit()
