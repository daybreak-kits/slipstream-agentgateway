"""ADR-004 availability: one evaluator, one rule-table write authority.

Fixed instants keep the periodic window tests deterministic; the integration
suite covers the same semantics through the HTTP API.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select
from tests.conftest import seed_channel

from l04_repo.orm import AvailabilityRuleORM, UpstreamModelORM
from l05_service.availability import (
    LEGACY_NOTE,
    AvailabilityState,
    create_rule,
    evaluate,
    migrate_legacy_cooldowns,
    release_model_cooldown,
    row_cooldown_rule_id,
    rule_deadline_ms,
    rule_is_active,
    rules_changed_since,
    set_model_cooldown,
    sync_all_cooldown_projections,
    sync_cooldown_projection,
)


def _at(day: int, hour: int, minute: int = 0, month: int = 3, year: int = 2026) -> int:
    return int(datetime(year, month, day, hour, minute, tzinfo=UTC).timestamp() * 1000)


def _periodic(
    recurrence: str,
    *,
    start: str,
    end: str,
    days: list[int] | None = None,
    days_of_month: list[int] | None = None,
    rule_id: str = "rule_periodic",
    scope: str = "upstream_model",
    scope_id: str = "umdl_test",
) -> AvailabilityRuleORM:
    window: dict[str, object] = {"start": start, "end": end}
    if days is not None:
        window["days"] = days
    if days_of_month is not None:
        window["days_of_month"] = days_of_month
    return AvailabilityRuleORM(
        id=rule_id,
        kind="cooldown",
        scope=scope,
        scope_id=scope_id,
        recurrence=recurrence,
        expires_at_ms=None,
        schedule_json=json.dumps({"windows": [window]}),
        note="",
        created_at_ms=0,
    )


@pytest.mark.parametrize(
    ("moment", "active"),
    [
        (_at(2, 1, 59), False),
        (_at(2, 2, 0), True),
        (_at(2, 3, 59), True),
        (_at(2, 4, 0), False),
    ],
)
def test_daily_window_is_half_open_and_reports_its_end(moment: int, active: bool) -> None:
    rule = _periodic("daily", start="02:00", end="04:00")
    assert rule_is_active(rule, moment) is active
    assert rule_deadline_ms(rule, moment) == (_at(2, 4, 0) if active else 0)


def test_weekly_window_uses_iso_weekdays() -> None:
    rule = _periodic("weekly", start="02:00", end="04:00", days=[1])  # Monday
    assert rule_is_active(rule, _at(2, 3, 0)) is True  # Monday
    assert rule_deadline_ms(rule, _at(2, 3, 0)) == _at(2, 4, 0)
    assert rule_is_active(rule, _at(3, 3, 0)) is False  # Tuesday


def test_weekly_window_started_yesterday_still_cools_after_midnight() -> None:
    rule = _periodic("weekly", start="23:00", end="01:00", days=[1])  # Monday 23:00
    tuesday_0030 = _at(3, 0, 30)
    assert rule_is_active(rule, tuesday_0030) is True
    assert rule_deadline_ms(rule, tuesday_0030) == _at(3, 1, 0)


def test_monthly_window_uses_days_of_month() -> None:
    rule = _periodic("monthly", start="09:00", end="10:00", days_of_month=[15])
    assert rule_is_active(rule, _at(15, 9, 30)) is True
    assert rule_deadline_ms(rule, _at(15, 9, 30)) == _at(15, 10, 0)
    assert rule_is_active(rule, _at(16, 9, 30)) is False


def test_cross_midnight_window_ends_on_the_current_day_after_midnight() -> None:
    rule = _periodic("daily", start="23:00", end="01:00")
    assert rule_deadline_ms(rule, _at(2, 23, 30)) == _at(3, 1, 0)
    assert rule_deadline_ms(rule, _at(3, 0, 30)) == _at(3, 1, 0)
    assert rule_is_active(rule, _at(3, 1, 0)) is False


def test_model_patch_cooldown_is_one_managed_rule_and_projection(
    engine_and_sessionmaker,
) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    from l01_core.timeutil import now_ms

    deadline = now_ms() + 3_600_000
    with factory() as session:
        set_model_cooldown(
            session,
            scope="upstream_model",
            scope_id=ids["upstream_model_id"],
            until_ms=deadline,
        )
        session.commit()
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        rule = session.get(
            AvailabilityRuleORM,
            row_cooldown_rule_id("upstream_model", ids["upstream_model_id"]),
        )
        assert row is not None and rule is not None
        assert (rule.kind, rule.recurrence, rule.expires_at_ms) == (
            "cooldown",
            "once",
            deadline,
        )
        assert row.cooldown_until_ms == deadline
        snapshot = evaluate(session)
        view = snapshot.upstream_model_view(row)
        assert view.state is AvailabilityState.COOLING
        assert view.cooldown_until_ms == deadline
        assert row.id in snapshot.excluded_upstream_model_ids

        release_model_cooldown(
            session, scope="upstream_model", scope_id=ids["upstream_model_id"]
        )
        session.commit()
        assert session.get(AvailabilityRuleORM, rule.id) is None
        assert row.cooldown_until_ms == 0
        assert evaluate(session).upstream_model_view(row).state is AvailabilityState.NORMAL


def test_periodic_rule_projects_window_end_into_the_legacy_column(
    engine_and_sessionmaker,
) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    fixed = _at(2, 12, 0)
    with factory() as session:
        create_rule(
            session,
            kind="cooldown",
            scope="upstream_model",
            scope_id=ids["upstream_model_id"],
            recurrence="daily",
            schedule_json='{"windows": [{"start": "00:00", "end": "00:00"}]}',
        )
        session.flush()
        assert sync_all_cooldown_projections(session, now_ms=fixed) == 1
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        assert row.cooldown_until_ms == _at(3, 0, 0)
        view = evaluate(session, fixed).upstream_model_view(row)
        assert view.state is AvailabilityState.COOLING
        assert view.cooldown_until_ms == _at(3, 0, 0)


def test_state_vocabulary_precedence_and_upstream_inheritance(
    engine_and_sessionmaker,
) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    assert [state.value for state in AvailabilityState] == ["normal", "cooling", "closed"]
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        row.enabled = False
        session.flush()
        assert evaluate(session).upstream_model_view(row).state is AvailabilityState.CLOSED

        row.enabled = True
        create_rule(
            session,
            kind="ban",
            scope="upstream_model",
            scope_id=row.id,
        )
        session.flush()
        snapshot = evaluate(session)
        assert snapshot.upstream_model_view(row).state is AvailabilityState.CLOSED
        assert "mt_test" in snapshot.blocked_target_ids

        # An upstream-scope measure also closes its models: API and render agree.
        create_rule(
            session,
            kind="ban",
            scope="upstream",
            scope_id=ids["upstream_id"],
        )
        session.flush()
        assert evaluate(session).upstream_model_view(row).state is AvailabilityState.CLOSED


def test_legacy_future_column_is_read_then_adopted_once(engine_and_sessionmaker) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    deadline = _at(2, 12, 0)
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        row.cooldown_until_ms = deadline
        session.commit()

        view = evaluate(session, _at(2, 11, 0)).upstream_model_view(row)
        assert view.state is AvailabilityState.COOLING
        assert view.cooldown_until_ms == deadline

        assert migrate_legacy_cooldowns(session, now_ms=_at(2, 11, 0)) == 1
        rule = session.get(
            AvailabilityRuleORM,
            row_cooldown_rule_id("upstream_model", ids["upstream_model_id"]),
        )
        assert rule is not None
        assert (rule.kind, rule.recurrence, rule.expires_at_ms, rule.note) == (
            "cooldown",
            "once",
            deadline,
            LEGACY_NOTE,
        )
        assert row.cooldown_until_ms == deadline
        assert migrate_legacy_cooldowns(session, now_ms=_at(2, 11, 0)) == 0


def test_expired_legacy_column_is_cleared(engine_and_sessionmaker) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    now = _at(2, 12, 0)
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        row.cooldown_until_ms = now - 1
        session.commit()
        assert migrate_legacy_cooldowns(session, now_ms=now) == 0
        assert row.cooldown_until_ms == 0
        assert session.scalar(select(func.count()).select_from(AvailabilityRuleORM)) == 0
        assert evaluate(session, now).upstream_model_view(row).state is AvailabilityState.NORMAL


def test_managed_rule_wins_over_a_stale_projection(engine_and_sessionmaker) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    from l01_core.timeutil import now_ms

    managed_deadline = now_ms() + 3_600_000
    stale_deadline = now_ms() + 7_200_000
    with factory() as session:
        set_model_cooldown(
            session,
            scope="upstream_model",
            scope_id=ids["upstream_model_id"],
            until_ms=managed_deadline,
        )
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        row.cooldown_until_ms = stale_deadline  # simulate an out-of-band stale cache
        session.flush()
        view = evaluate(session).upstream_model_view(row)
        assert view.state is AvailabilityState.COOLING
        assert view.cooldown_until_ms == managed_deadline
        sync_cooldown_projection(
            session, scope="upstream_model", scope_id=ids["upstream_model_id"]
        )
        assert row.cooldown_until_ms == managed_deadline


def test_rules_changed_since_covers_once_expiry_and_window_boundaries(
    engine_and_sessionmaker,
) -> None:
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    with factory() as session:
        session.add(
            AvailabilityRuleORM(
                id="rule_once",
                kind="cooldown",
                scope="upstream_model",
                scope_id="umdl_test",
                recurrence="once",
                expires_at_ms=_at(2, 10, 15),
                schedule_json=None,
                note="",
                created_at_ms=0,
            )
        )
        session.add(_periodic("daily", start="10:00", end="11:00", rule_id="rule_daily"))
        session.flush()
        changed = rules_changed_since(session, _at(2, 9, 59), _at(2, 10, 30))
        assert {rule.id for rule in changed} == {"rule_once", "rule_daily"}
        assert rules_changed_since(session, _at(2, 11, 30), _at(2, 12, 0)) == []
