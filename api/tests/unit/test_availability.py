"""ADR-004 availability: one evaluator, one rule-table write authority.

Fixed instants keep the periodic window tests deterministic; the integration
suite covers the same semantics through the HTTP API.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from tests.conftest import seed_channel

from l01_core.timeutil import now_ms
from l04_repo.orm import (
    AvailabilityRuleORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
)
from l05_service.availability import (
    LEGACY_NOTE,
    AvailabilityState,
    create_rule,
    enable_model_availability,
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
    update_rule,
)


def _at(day: int, hour: int, minute: int = 0, month: int = 3, year: int = 2026) -> int:
    return int(datetime(year, month, day, hour, minute, tzinfo=UTC).timestamp() * 1000)


@pytest.fixture(autouse=True)
def _pin_operations_timezone_to_utc(engine_and_sessionmaker):
    """Fixed UTC instants keep their meaning: pin the operations timezone to
    UTC for the session-based evaluator (which reads app_settings). The P1-6
    timezone test overrides the row to Asia/Shanghai inside its own body."""
    _, factory = engine_and_sessionmaker
    from l01_core.timeutil import now_ms as _now
    from l04_repo.repository import put_setting

    with factory() as session:
        put_setting(session, "timezone", '"UTC"', _now())
        session.commit()


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


def test_recurring_windows_use_the_operations_timezone(engine_and_sessionmaker) -> None:
    """P1-6: 02:00-04:00 means local (operations) time, not UTC.

    With the timezone row set to Asia/Shanghai, 02:00-04:00 Shanghai is
    18:00-20:00 UTC the day before; a fixed UTC instant inside that span is
    active through the session-based evaluator (which reads app_settings).
    """
    from tests.conftest import seed_channel

    from l01_core.timeutil import now_ms as _now
    from l04_repo.repository import put_setting

    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    with factory() as session:
        put_setting(session, "timezone", '"Asia/Shanghai"', _now())
        session.add(_periodic("daily", start="02:00", end="04:00", rule_id="rule_sh"))
        session.commit()

        # 2026-03-02 18:30 UTC == 2026-03-03 02:30 Asia/Shanghai (inside window).
        inside = evaluate(session, now_ms=_at(2, 18, 30))
        assert inside.excluded_upstream_model_ids == frozenset({"umdl_test"})
        model = session.get(UpstreamModelORM, "umdl_test")
        assert inside.upstream_model_view(model).cooldown_until_ms == _at(2, 20, 0)

        # 15:00 UTC == 23:00 Shanghai: outside, though it would be inside a
        # 02:00-04:00 UTC window. Same UTC instant, different local reading.
        outside = evaluate(session, now_ms=_at(2, 15, 0))
        assert outside.excluded_upstream_model_ids == frozenset()


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


# ---------------------------------------------------------------- window skips
# GLOSSARY §3 (2026-11-19 ruling): 启用 inside a periodic window skips THAT
# window only; the rule stays and later windows cool again.


@pytest.fixture
def frozen_service_clock(monkeypatch):
    """期限投影（create_rule/sync_cooldown_projection）默认用真实时钟；本组用例
    在固定的 2026-03-02 时刻上推演，若真实时钟恰落在 02:00-04:00 窗口内
    （UTC），投影会写入"今天 04:00"而在注入时刻被误读为遗留冷却——把服务时钟
    冻结在用例自己的窗口内，行为与运行墙钟无关（此前 UTC 白天跑绿、窗口内跑红）。"""
    import l05_service.availability as availability_module

    monkeypatch.setattr(availability_module, "utc_now_ms", lambda: _at(2, 3, 0))


def _daily_rule(session, scope_id: str) -> AvailabilityRuleORM:
    create_rule(
        session,
        kind="cooldown",
        scope="upstream_model",
        scope_id=scope_id,
        recurrence="daily",
        schedule_json='{"windows": [{"start": "02:00", "end": "04:00"}]}',
    )
    return session.scalars(
        select(AvailabilityRuleORM).where(
            AvailabilityRuleORM.scope_id == scope_id,
            AvailabilityRuleORM.recurrence == "daily",
        )
    ).one()


def _enable(session, scope_id: str, moment: int) -> dict | None:
    """Mirror the router: enabled=True first, then the availability write."""
    return enable_model_availability(
        session, scope="upstream_model", scope_id=scope_id, now_ms=moment
    )


def test_enable_inside_window_skips_only_the_current_window(
    engine_and_sessionmaker,
    frozen_service_clock,
) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        row.enabled = False
        rule = _daily_rule(session, row.id)
        session.flush()

        info = _enable(session, row.id, _at(2, 3, 0))
        assert info is not None
        assert info["rule_ids"] == [rule.id]
        assert info["skip_until_ms"] == _at(2, 4, 0)
        assert info["message"] == "本次启用仅跳过当前窗口，后续窗口照常"

        row.enabled = True
        session.flush()
        view = evaluate(session, _at(2, 3, 30)).upstream_model_view(row)
        assert view.state is AvailabilityState.NORMAL
        assert view.window_skip_until_ms == _at(2, 4, 0)

        # The rule itself is untouched and cools again in the next window.
        assert rule.recurrence == "daily"
        assert rule.skip_until_ms == _at(2, 4, 0)
        assert rule.skip_set_at_ms == _at(2, 3, 0)
        later = evaluate(session, _at(3, 3, 0)).upstream_model_view(row)
        assert later.state is AvailabilityState.COOLING
        assert later.cooldown_until_ms == _at(3, 4, 0)
        assert later.window_skip_until_ms == 0


def test_enable_outside_window_clears_closed_without_skip(
    engine_and_sessionmaker,
    frozen_service_clock,
) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        row.enabled = False
        _daily_rule(session, row.id)
        session.flush()

        assert _enable(session, row.id, _at(2, 5, 0)) is None
        rule = session.scalars(
            select(AvailabilityRuleORM).where(AvailabilityRuleORM.scope_id == row.id)
        ).one()
        assert (rule.skip_until_ms, rule.skip_set_at_ms) == (0, 0)
        row.enabled = True
        session.flush()
        view = evaluate(session, _at(2, 5, 30)).upstream_model_view(row)
        assert view.state is AvailabilityState.NORMAL
        assert view.window_skip_until_ms == 0


def test_enable_releases_managed_cooldown_and_skips_window(
    engine_and_sessionmaker,
    frozen_service_clock,
) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    from l01_core.timeutil import now_ms

    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        set_model_cooldown(
            session, scope="upstream_model", scope_id=row.id, until_ms=now_ms() + 3_600_000
        )
        rule = _daily_rule(session, row.id)
        session.flush()

        info = _enable(session, row.id, _at(2, 3, 0))
        assert info is not None and info["rule_ids"] == [rule.id]
        # 启用 keeps its old reset semantics for the managed once-cooldown...
        managed = session.get(
            AvailabilityRuleORM, row_cooldown_rule_id("upstream_model", row.id)
        )
        assert managed is None
        # ...while only the periodic window gets the one-shot exception.
        view = evaluate(session, _at(2, 3, 30)).upstream_model_view(row)
        assert view.state is AvailabilityState.NORMAL


def test_release_clears_the_window_skip(engine_and_sessionmaker, frozen_service_clock) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        _daily_rule(session, row.id)
        session.flush()
        assert _enable(session, row.id, _at(2, 3, 0)) is not None
        view = evaluate(session, _at(2, 3, 30)).upstream_model_view(row)
        assert view.state is AvailabilityState.NORMAL

        release_model_cooldown(session, scope="upstream_model", scope_id=row.id)
        rule = session.scalars(
            select(AvailabilityRuleORM).where(AvailabilityRuleORM.scope_id == row.id)
        ).one()
        assert (rule.skip_until_ms, rule.skip_set_at_ms) == (0, 0)
        view = evaluate(session, _at(2, 3, 30)).upstream_model_view(row)
        assert view.state is AvailabilityState.COOLING
        assert view.cooldown_until_ms == _at(2, 4, 0)
        assert view.window_skip_until_ms == 0


def test_reapplying_the_rule_clears_the_window_skip(
    engine_and_sessionmaker, frozen_service_clock
) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        rule = _daily_rule(session, row.id)
        session.flush()
        assert _enable(session, row.id, _at(2, 3, 0)) is not None

        update_rule(
            session,
            rule.id,
            {"schedule_json": '{"windows": [{"start": "02:00", "end": "05:00"}]}'},
        )
        assert (rule.skip_until_ms, rule.skip_set_at_ms) == (0, 0)
        view = evaluate(session, _at(2, 3, 30)).upstream_model_view(row)
        assert view.state is AvailabilityState.COOLING
        assert view.cooldown_until_ms == _at(2, 5, 0)


def test_closed_row_and_ban_still_win_over_a_window_skip(
    engine_and_sessionmaker,
) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        _daily_rule(session, row.id)
        session.flush()
        assert _enable(session, row.id, _at(2, 3, 0)) is not None

        row.enabled = False
        session.flush()
        assert (
            evaluate(session, _at(2, 3, 30)).upstream_model_view(row).state
            is AvailabilityState.CLOSED
        )

        # Bans are human decisions: an enable releases cooldowns but never a ban.
        row.enabled = True
        create_rule(session, kind="ban", scope="upstream_model", scope_id=row.id)
        session.flush()
        assert (
            evaluate(session, _at(2, 3, 30)).upstream_model_view(row).state
            is AvailabilityState.CLOSED
        )


def test_projection_ignores_the_skipped_window(engine_and_sessionmaker) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        _daily_rule(session, row.id)
        session.flush()
        assert _enable(session, row.id, _at(2, 3, 0)) is not None

        sync_all_cooldown_projections(session, now_ms=_at(2, 3, 30))
        assert row.cooldown_until_ms == 0
        sync_all_cooldown_projections(session, now_ms=_at(3, 3, 0))
        assert row.cooldown_until_ms == _at(3, 4, 0)


def test_rules_changed_since_detects_window_skip_creation(
    engine_and_sessionmaker,
) -> None:
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        rule = _daily_rule(session, row.id)
        session.flush()
        assert _enable(session, row.id, _at(2, 3, 0)) is not None

        changed = rules_changed_since(session, _at(2, 2, 59), _at(2, 3, 0))
        assert {item.id for item in changed} == {rule.id}
        # The next poll sees no further change (the skip stays anchored).
        assert rules_changed_since(session, _at(2, 3, 1), _at(2, 3, 30)) == []


def test_skipped_window_returns_the_target_to_the_rendered_ir(
    engine_and_sessionmaker,
) -> None:
    """evaluate -> IR: while cooling the target leaves the config; a window
    skip must bring it back without touching render.py.

    build_render_plan stamps with the real wall clock, so the window is built
    around ``now`` (cross-midnight edges are exercised by the fixed-clock tests
    above); the enable then runs on the same real clock.
    """
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        row = session.get(UpstreamModelORM, ids["upstream_model_id"])
        spare = UpstreamModelORM(
            id="umdl_spare",
            upstream_id=ids["upstream_id"],
            name="spare-model",
            model_type="chat",
            created_at_ms=0,
        )
        session.add(spare)
        session.add(
            PublicModelORM(id="pmdl_spare", name="spare-pm", created_at_ms=0)
        )
        session.add(
            ModelTargetORM(
                id="mt_spare",
                public_model_id="pmdl_spare",
                upstream_model_id=spare.id,
                priority=1,
                created_at_ms=0,
            )
        )
        moment = datetime.fromtimestamp(now_ms() / 1000, tz=UTC)
        start = moment - timedelta(minutes=2)
        end = moment + timedelta(minutes=30)
        windows = [
            {
                "start": f"{start.hour:02d}:{start.minute:02d}",
                "end": f"{end.hour:02d}:{end.minute:02d}",
            }
        ]
        create_rule(
            session,
            kind="cooldown",
            scope="upstream_model",
            scope_id=row.id,
            recurrence="daily",
            schedule_json=json.dumps({"windows": windows}),
        )
        session.flush()

        from l05_service.rendering import build_render_plan

        ir, _keys = build_render_plan(session, revision="rev_skip_cooling")
        assert {model.name for model in ir.public_models} == {"spare-pm"}

        info = enable_model_availability(
            session, scope="upstream_model", scope_id=row.id
        )
        assert info is not None and info["skip_until_ms"] > now_ms()
        ir, _keys = build_render_plan(session, revision="rev_skip_ok")
        assert {model.name for model in ir.public_models} == {"flagship", "spare-pm"}
