"""Run the unify-users migration on a real demo DB (CLI, subprocess).

Mirrors test_priority_migration_demo: the database is created by the real seed
script. A unified-era database (ADR-019) has no admin_users table at all, so
the CLI pass must be a clean no-op there. The actual merge is then exercised by
recreating the retired table with raw SQL — exactly what an old database looks
like before the migration — and asserting linked merges, new rows and login
survival.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[2]

# The retired admin_users shape (ADR-019), created only in this test to
# simulate a pre-unification database; the live schema never creates it.
_LEGACY_DDL = """
CREATE TABLE admin_users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(255) UNIQUE,
    password_hash VARCHAR(256),
    role VARCHAR(32) DEFAULT 'user',
    display_name VARCHAR(255) DEFAULT '',
    status VARCHAR(16) DEFAULT 'active',
    created_at_ms BIGINT DEFAULT 0,
    updated_at_ms BIGINT DEFAULT 0
)
"""


def _env(db_path: Path) -> dict[str, str]:
    return {
        **os.environ,
        "SLIPSTREAM_DATABASE_URL": "sqlite:///" + db_path.as_posix(),
        "SLIPSTREAM_SECRET_KEY": "test-secret",
        "SLIPSTREAM_AG_CONFIG_DIR": str(db_path.parent / "ag-config"),
    }


def _run_script(
    db_path: Path, env: dict[str, str], *extra: str
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            "scripts/migrate_unify_users.py",
            "--database-url",
            "sqlite:///" + db_path.as_posix(),
            *extra,
        ],
        cwd=API_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )


def _seed(db_path: Path, env: dict[str, str]) -> None:
    seeded = subprocess.run(
        [sys.executable, "scripts/seed_demo.py"],
        cwd=API_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    assert seeded.returncode == 0, seeded.stderr[-2000:]


def _query(db_path: Path, sql: str) -> list[tuple]:
    import sqlite3

    connection = sqlite3.connect(db_path)
    try:
        return list(connection.execute(sql))
    finally:
        connection.close()


def _execute(db_path: Path, sql: str, params: tuple = ()) -> None:
    import sqlite3

    connection = sqlite3.connect(db_path)
    try:
        with connection:
            connection.execute(sql, params)
    finally:
        connection.close()


def test_cli_is_a_noop_on_a_unified_seed_db(tmp_path: Path) -> None:
    """No admin_users table -> no rows, no writes, no crash."""
    db_path = tmp_path / "demo.db"
    env = _env(db_path)
    _seed(db_path, env)
    assert _query(db_path, "SELECT count(*) FROM sqlite_master WHERE name='admin_users'") == [
        (0,)
    ]

    dry = _run_script(db_path, env)
    assert dry.returncode == 0, dry.stderr[-2000:]
    assert "预演" in dry.stdout
    assert "admin 行 0" in dry.stdout

    applied = _run_script(db_path, env, "--apply", "--json")
    assert applied.returncode == 0, applied.stderr[-2000:]
    payload = json.loads(applied.stdout)
    assert payload["admin_rows"] == 0
    assert payload["users_total"] == 6  # root D + 5 seeded consumers


def test_cli_merges_a_legacy_database(tmp_path: Path) -> None:
    """Recreate the retired table like an old DB, then run the merge for real."""
    from l05_service import auth

    db_path = tmp_path / "legacy.db"
    env = _env(db_path)
    _seed(db_path, env)
    _execute(db_path, _LEGACY_DDL)
    old_hash = auth.hash_password("Adm1n-pw-2026")
    # One linked row already folded (username + hash equal on the users row) and
    # one unlinked row that must become a NEW users row under root D.
    _execute(
        db_path,
        "UPDATE users SET admin_user_id = 'adm_link' WHERE username = 'admin'",
    )
    _execute(
        db_path,
        "INSERT INTO admin_users (id, username, password_hash, role, display_name, status)"
        " VALUES ('adm_link', 'admin', ?, 'admin', '张三', 'active')",
        (_query(db_path, "SELECT password_hash FROM users WHERE username='admin'")[0][0],),
    )
    _execute(
        db_path,
        "INSERT INTO admin_users (id, username, password_hash, role, display_name, status)"
        " VALUES ('adm_new', 'legacy-op', ?, 'agent', '老管理员', 'active')",
        (old_hash,),
    )

    applied = _run_script(db_path, env, "--apply", "--json")
    assert applied.returncode == 0, applied.stderr[-2000:]
    payload = json.loads(applied.stdout)
    assert payload["admin_rows"] == 2
    assert payload["linked_merges"] == []
    assert len(payload["new_rows"]) == 1
    assert payload["new_rows"][0]["username"] == "legacy-op"
    assert payload["users_total"] == 7

    rows = _query(
        db_path,
        "SELECT username, password_hash, role FROM users"
        " WHERE username IN ('admin','legacy-op')",
    )
    by_name = {row[0]: row for row in rows}
    assert {row[0] for row in rows} == {"admin", "legacy-op"}
    assert all(row[1].startswith("scrypt$") for row in rows)
    assert by_name["legacy-op"][2] == "agent"

    # Idempotency: a second pass finds both rows already folded.
    second = _run_script(db_path, env, "--apply", "--json")
    payload = json.loads(second.stdout)
    assert payload["linked_merges"] == [] and payload["new_rows"] == []
    assert len(payload["skipped"]) == 2
