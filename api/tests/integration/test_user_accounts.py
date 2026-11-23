"""W7 ticket 01: one users table - every row is a login account.

ADR-019 + W7: a user row always carries a username and a password hash, the
creation endpoint accepts an explicit credential or auto-generates one, and the
user API never exposes a "type" field (the console/API split is gone).

Seams: the HTTP admin API (login + /admin/users) and the real seed script
(fresh demo database in a temp sqlite file, never the developer database).
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from l06_api.app import create_app

API_ROOT = Path(__file__).resolve().parents[2]
DEMO_PASSWORD = "Adm1n-pw-2026"


def _query(db_path: Path, sql: str) -> list[tuple]:
    connection = sqlite3.connect(db_path)
    try:
        return list(connection.execute(sql).fetchall())
    finally:
        connection.close()


@pytest.fixture(scope="module")
def seeded_db(tmp_path_factory) -> Path:
    """Run the real seed script into a temp sqlite file (never the dev DB)."""
    db_path = tmp_path_factory.mktemp("seed-user-accounts") / "demo.db"
    env = {
        **os.environ,
        "SLIPSTREAM_DATABASE_URL": "sqlite:///" + db_path.as_posix(),
        "SLIPSTREAM_SECRET_KEY": "test-secret",
        "SLIPSTREAM_DEMO_ADMIN_PASSWORD": DEMO_PASSWORD,
        "SLIPSTREAM_AG_CONFIG_DIR": str(db_path.parent / "ag-config"),
    }
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
    return db_path


@pytest.fixture(scope="module")
def seeded_client(seeded_db: Path) -> TestClient:
    """The control plane bound to the freshly seeded database."""
    engine = create_engine(
        "sqlite:///" + seeded_db.as_posix(),
        connect_args={"check_same_thread": False},
        future=True,
    )
    factory = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False, future=True)
    app = create_app(session_factory=factory, init_tables=False)
    return TestClient(app)


def _login(client: TestClient, username: str, password: str):
    return client.post("/admin/auth/login", json={"username": username, "password": password})


def _user_rows(payload: object) -> list[dict]:
    """User rows out of /admin/users (list) or /admin/users/tree (nodes)."""
    if isinstance(payload, list):
        return list(payload)
    assert isinstance(payload, dict)
    return list(payload.get("nodes", []))


def test_every_seeded_user_has_credentials_and_can_log_in(seeded_db, seeded_client):
    """No "无登录帐户" row: every seeded user has a username, a hash and a login."""
    rows = _query(
        seeded_db,
        "SELECT username, password_hash FROM users WHERE name <> 'playground'",
    )
    assert rows, "the seed must write users"
    for username, password_hash in rows:
        assert username, "every seeded user needs a login name"
        assert password_hash, "every seeded user needs a password hash"
        response = _login(seeded_client, username, DEMO_PASSWORD)
        assert response.status_code == 200, (username, response.text)
        assert response.json()["user"]["username"] == username


def test_user_api_exposes_no_type_field_and_always_a_username(seeded_client):
    """The user payloads carry a login name and no console/API type column."""
    assert _login(seeded_client, "admin", DEMO_PASSWORD).status_code == 200
    for path in ("/admin/users", "/admin/users/tree"):
        response = seeded_client.get(path)
        assert response.status_code == 200, path
        rows = _user_rows(response.json())
        assert rows, path
        for row in rows:
            assert "type" not in row, (path, row)
            assert row["username"], (path, row)


def test_created_user_with_explicit_credentials_can_log_in(client, anon_client):
    """Explicit path: the given username/password are what the account uses."""
    created = client.post(
        "/admin/users",
        json={
            "name": "显式凭证用户",
            "username": "explicit-login",
            "password": "Explicit-pw-2026",
            "role": "customer",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["username"] == "explicit-login"
    assert body["initial_password"] == "Explicit-pw-2026"

    login = _login(anon_client, "explicit-login", "Explicit-pw-2026")
    assert login.status_code == 200, login.text
    assert login.json()["user"]["username"] == "explicit-login"


def test_created_user_without_credentials_gets_a_usable_generated_login(client, anon_client):
    """ADR-019 path: username derived, 12-char password generated and shown once."""
    created = client.post("/admin/users", json={"name": "自动凭证用户", "role": "customer"})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["username"], body
    generated = body["initial_password"]
    assert len(generated) == 12, generated
    assert (
        any(char.isupper() for char in generated)
        and any(char.islower() for char in generated)
        and any(char.isdigit() for char in generated)
        and any(not char.isalnum() for char in generated)
    ), generated

    login = _login(anon_client, body["username"], generated)
    assert login.status_code == 200, login.text
    assert login.json()["user"]["username"] == body["username"]


def test_user_creation_rejects_rows_without_credentials(client):
    """A row without a login name or password hash must never reach the table."""
    from l01_core.errors import AppError, ErrorCode
    from l05_service import crud

    with client.app.state.session_factory() as session:
        with pytest.raises(AppError) as raised:
            crud.create_user(
                session,
                name="无凭证用户",
                username="",
                password_hash="",
                parent_user_id=None,
                role="customer",
                actor="test",
            )
    assert raised.value.code == ErrorCode.VALIDATION_ERROR
    assert "username" in raised.value.message or "password" in raised.value.message
