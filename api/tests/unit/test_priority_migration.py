"""Ticket 08: legacy "bigger wins" priorities are flipped to v2 per model, once.

The migration must be explicit (legacy -> v2), per public model (the scale is
per-model), failover-only (weight/conditional have no ordering), and idempotent
(the priority_semantics marker wins over any later default run).
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from l04_repo.base import init_db
from l04_repo.orm import AppSettingORM, ModelTargetORM, PublicModelORM
from l04_repo.repository import get_setting
from l05_service.priority_migration import (
    SEMANTICS_KEY,
    SEMANTICS_LEGACY,
    SEMANTICS_V2,
    apply_priority_migration,
    plan_priority_migration,
    stored_semantics,
)


def _factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    init_db(engine)
    return sessionmaker(bind=engine, expire_on_commit=False, autoflush=False, future=True)


def _seed(session) -> None:
    session.add_all(
        [
            PublicModelORM(id="pm_fail", name="fail-model", routing_mode="failover"),
            PublicModelORM(id="pm_weighted", name="weighted-model", routing_mode="weighted"),
            PublicModelORM(id="pm_cond", name="cond-model", routing_mode="conditional"),
            ModelTargetORM(
                id="mt_f1", public_model_id="pm_fail", upstream_model_id="um_x", priority=10
            ),
            ModelTargetORM(
                id="mt_f2", public_model_id="pm_fail", upstream_model_id="um_y", priority=20
            ),
            ModelTargetORM(
                id="mt_f3", public_model_id="pm_fail", upstream_model_id="um_z", priority=30
            ),
            ModelTargetORM(
                id="mt_w1",
                public_model_id="pm_weighted",
                upstream_model_id="um_x",
                priority=0,
                weight=60,
            ),
            ModelTargetORM(
                id="mt_w2",
                public_model_id="pm_weighted",
                upstream_model_id="um_y",
                priority=0,
                weight=40,
            ),
            ModelTargetORM(
                id="mt_c1",
                public_model_id="pm_cond",
                upstream_model_id="um_x",
                priority=7,
                when_expr="request.model == 'x'",
            ),
        ]
    )
    session.commit()


def test_plan_flips_only_failover_targets_per_model() -> None:
    factory = _factory()
    with factory() as session:
        _seed(session)
        plan = plan_priority_migration(session)
        assert plan.semantics == SEMANTICS_LEGACY
        assert plan.already_v2 is False
        assert plan.changed == 3
        mapping = {
            change.target_id: (change.old_priority, change.new_priority)
            for change in plan.changes
        }
        # max_priority=30, so legacy 10/20/30 -> v2 20/10/0 (smaller wins).
        assert mapping == {"mt_f1": (10, 20), "mt_f2": (20, 10), "mt_f3": (30, 0)}


def test_plan_is_dry_run_until_applied() -> None:
    factory = _factory()
    with factory() as session:
        _seed(session)
        plan_priority_migration(session)
        priorities = {row.id: row.priority for row in session.query(ModelTargetORM).all()}
        assert priorities["mt_f1"] == 10 and priorities["mt_f3"] == 30
        assert priorities["mt_w1"] == 0 and priorities["mt_c1"] == 7
        assert stored_semantics(session) == "unknown"
        assert get_setting(session, SEMANTICS_KEY) is None


def test_apply_flips_priorities_and_records_v2_marker() -> None:
    factory = _factory()
    with factory() as session:
        _seed(session)
        plan = plan_priority_migration(session)
        apply_priority_migration(session, plan)
        session.commit()
        priorities = {row.id: row.priority for row in session.query(ModelTargetORM).all()}
        assert priorities == {
            "mt_f1": 20,
            "mt_f2": 10,
            "mt_f3": 0,
            "mt_w1": 0,
            "mt_w2": 0,
            "mt_c1": 7,  # conditional target untouched
        }
        assert stored_semantics(session) == SEMANTICS_V2
        marker = json.loads(get_setting(session, SEMANTICS_KEY) or "{}")
        assert marker["semantics"] == SEMANTICS_V2


def test_second_run_is_idempotent() -> None:
    factory = _factory()
    with factory() as session:
        _seed(session)
        apply_priority_migration(session, plan_priority_migration(session))
        session.commit()
        plan = plan_priority_migration(session)
        assert plan.already_v2 is True
        assert plan.changes == ()
        apply_priority_migration(session, plan)
        session.commit()
        priorities = {row.id: row.priority for row in session.query(ModelTargetORM).all()}
        assert priorities["mt_f1"] == 20 and priorities["mt_f3"] == 0


def test_explicit_v2_marks_data_without_flipping() -> None:
    factory = _factory()
    with factory() as session:
        _seed(session)
        plan = plan_priority_migration(session, semantics=SEMANTICS_V2)
        assert plan.changes == () and plan.already_v2 is False
        apply_priority_migration(session, plan)
        session.commit()
        priorities = {row.id: row.priority for row in session.query(ModelTargetORM).all()}
        assert priorities["mt_f3"] == 30  # already v2, nothing rewritten
        assert stored_semantics(session) == SEMANTICS_V2
        assert session.get(AppSettingORM, SEMANTICS_KEY) is not None


def test_unknown_semantics_is_rejected() -> None:
    factory = _factory()
    with factory() as session:
        with pytest.raises(ValueError):
            plan_priority_migration(session, semantics="guess")
