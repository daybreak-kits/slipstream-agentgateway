"""Ticket 08: run the priority migration on a COPY of the seeded demo DB.

Purpose: prove the one-shot conversion keeps every row and only rewrites
failover priorities, that a dry-run writes nothing, and that a second run is a
no-op (the priority_semantics=v2 marker wins). The demo DB is created by the
real seed script into a temp sqlite file, so it is the same data the demo UI
serves - never the developer's database.

Ticket 19 made the seed write v2 priorities plus the v2 marker, so the migration
is already a no-op on a fresh demo DB. To exercise the flip, _make_legacy drops
the marker and applies the inverse transform on failover targets only; this is
exactly the shape of a pre-v2 database.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[2]
COUNTED_TABLES = (
    "model_targets",
    "public_models",
    "upstreams",
    "upstream_models",
    "vendors",
    "users",
    "config_revisions",
    "gateway_usage_events",
    "cost_entries",
    "charge_entries",
)


def _env(db_path: Path) -> dict[str, str]:
    return {
        **os.environ,
        "SLIPSTREAM_DATABASE_URL": "sqlite:///" + db_path.as_posix(),
        "SLIPSTREAM_SECRET_KEY": "test-secret",
        "SLIPSTREAM_AG_CONFIG_DIR": str(db_path.parent / "ag-config"),
    }


def _run(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *args],
        cwd=API_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )


def _query(db_path: Path, sql: str) -> list[tuple]:
    connection = sqlite3.connect(db_path)
    try:
        return list(connection.execute(sql).fetchall())
    finally:
        connection.close()


def _counts(db_path: Path) -> dict[str, int]:
    return {
        name: _query(db_path, f"SELECT COUNT(*) FROM {name}")[0][0]
        for name in COUNTED_TABLES
    }


def _priorities(db_path: Path) -> dict[str, int]:
    return {row[0]: row[1] for row in _query(db_path, "SELECT id, priority FROM model_targets")}


def _make_legacy(db_path: Path) -> None:
    """Convert the seeded v2 demo data back to legacy ordering for this test.

    Ticket 19 seeds v2 priorities (smaller wins) and records the v2 marker, so
    the migration would be a no-op on a fresh demo DB. Drop the marker and apply
    the inverse transform new = max - old per failover model; weighted and
    conditional targets keep their priorities, matching the real migration.
    """
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM app_settings WHERE key = 'priority_semantics'")
        failover = {
            row[0]
            for row in connection.execute(
                "SELECT id FROM public_models WHERE routing_mode = 'failover'"
            )
        }
        per_model: dict[str, list[tuple[str, int]]] = {}
        for target_id, model_id, priority in connection.execute(
            "SELECT id, public_model_id, priority FROM model_targets"
        ):
            per_model.setdefault(model_id, []).append((target_id, priority))
        for model_id, targets in per_model.items():
            if model_id not in failover:
                continue
            max_priority = max(priority for _, priority in targets)
            for target_id, priority in targets:
                connection.execute(
                    "UPDATE model_targets SET priority = ? WHERE id = ?",
                    (max_priority - priority, target_id),
                )
        connection.commit()
    finally:
        connection.close()


def _migrate(db_path: Path, env: dict[str, str], *extra: str) -> dict:
    run = _run(
        [
            "scripts/migrate_priority_v2.py",
            "--database-url",
            "sqlite:///" + db_path.as_posix(),
            "--json",
            *extra,
        ],
        env,
    )
    assert run.returncode == 0, run.stderr[-2000:]
    return json.loads(run.stdout)


def _assert_migrated_plan_is_renderable(db_path: Path) -> None:
    """After the flip the demo data must still render a valid v2 IR.

    A priority scale where "bigger wins" sorted descending; v2 sorts ascending,
    so a successful migration is only useful if every failover model still has
    non-negative, ascending priorities and the render plan covers all 8 models.
    """
    from l01_core.settings import get_settings, reset_settings_cache
    from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
    from l04_repo.base import make_engine, make_sessionmaker
    from l05_service.rendering import build_render_plan

    os.environ["SLIPSTREAM_SECRET_KEY"] = "test-secret"
    os.environ["SLIPSTREAM_AG_CONFIG_DIR"] = str(db_path.parent / "ag-config")
    reset_settings_cache()
    engine = make_engine("sqlite:///" + db_path.as_posix())
    factory = make_sessionmaker(engine)
    # Pass the real adapter so its capability matrix fills the IR: ticket 19 seeds
    # MCP targets/policies, and validation rejects them without a capability claim.
    adapter = AgentgatewayAdapter(get_settings().data_plane_config_dir, ag_binary="")
    try:
        with factory() as session:
            ir, key_files = build_render_plan(session, revision="rev_check", adapter=adapter)
    finally:
        engine.dispose()
        reset_settings_cache()
    assert len(ir.public_models) == 8
    assert key_files
    for model in ir.public_models:
        if model.routing_mode != "failover":
            continue
        priorities = [target.priority for target in model.targets]
        assert priorities == sorted(priorities)
        assert all(priority >= 0 for priority in priorities)


def test_migration_on_demo_db_copy_preserves_rows_and_flips_once(tmp_path: Path) -> None:
    db_path = tmp_path / "demo.db"
    env = _env(db_path)
    seeded = _run(["scripts/seed_demo.py"], env)
    assert seeded.returncode == 0, seeded.stderr[-2000:]
    _make_legacy(db_path)
    counts_before = _counts(db_path)
    assert counts_before["model_targets"] == 16
    priority_before = _priorities(db_path)
    model_of = dict(_query(db_path, "SELECT id, public_model_id FROM model_targets"))
    failover = {
        row[0]
        for row in _query(
            db_path, "SELECT id FROM public_models WHERE routing_mode = 'failover'"
        )
    }

    dry = _migrate(db_path, env)
    assert dry["applied"] is False and dry["changes"]
    assert _priorities(db_path) == priority_before  # dry-run wrote nothing
    assert _counts(db_path) == counts_before

    applied = _migrate(db_path, env, "--apply")
    assert applied["applied"] is True and applied["already_v2"] is False
    assert _counts(db_path) == counts_before  # no row added, dropped or rewritten

    # The flip rule per public model: new = model_max - old (legacy_priority_to_v2).
    per_model_max: dict[str, int] = {}
    for target_id, priority in priority_before.items():
        model_id = model_of[target_id]
        per_model_max[model_id] = max(per_model_max.get(model_id, priority), priority)
    priority_after = _priorities(db_path)
    for change in applied["changes"]:
        model_id = change["public_model_id"]
        assert change["new_priority"] == per_model_max[model_id] - change["old_priority"]
        assert priority_after[change["target_id"]] == change["new_priority"]

    # Weighted/conditional targets keep their priorities; only failover scales move.
    for target_id, priority in priority_after.items():
        if model_of[target_id] not in failover:
            assert priority_before[target_id] == priority
    assert set(priority_before) == set(priority_after)

    again = _migrate(db_path, env, "--apply")
    assert again["already_v2"] is True and again["changes"] == []
    assert _priorities(db_path) == priority_after
    assert _counts(db_path) == counts_before

    # The migrated database still renders the full desired state (no data loss).
    _assert_migrated_plan_is_renderable(db_path)
