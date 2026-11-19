"""Shared fixtures: in-memory SQLite, injected sessionmaker, app client, seeded data."""

from __future__ import annotations

import os
import shutil
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from l01_core.crypto import AesGcmBox, SecretBox
from l01_core.settings import reset_settings_cache
from l04_repo.base import init_db
from l04_repo.orm import (
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
    UpstreamORM,
    UserORM,
    VendorORM,
)
from l05_service import auth
from l05_service.client_keys import issue_client_key
from l06_api.app import create_app
from l06_api.deps import SESSION_COOKIE

TEST_DB = "sqlite:///:memory:"
DEMO_PASSWORD = "Adm1n-pw-2026"
TEST_TMP_ROOT = Path(__file__).resolve().parents[1]


def _rmtree_retry(path: str, attempts: int = 12, delay: float = 0.05) -> None:
    """Remove a test artefact dir; Windows can hold the last handle briefly.

    Plain shutil.rmtree(ignore_errors=True) can empty the tree but leave the empty
    directory behind, so retry rmtree, then rmdir, with a longer backoff.
    """

    for attempt in range(attempts):
        if not os.path.exists(path):
            return
        shutil.rmtree(path, ignore_errors=True)
        if not os.path.exists(path):
            return
        try:
            os.rmdir(path)
        except OSError:
            pass
        if not os.path.exists(path):
            return
        time.sleep(min(delay * (attempt + 1), 0.5))


_TEST_TMP_PATTERNS = (
    ".tmp-ag-test-*",
    ".tmp-ag-contract-*",
    ".tmp-status-*",
    ".tmp-ag-config-check",
)

_LOCK_NAME = ".ag-dir.lock"


@contextmanager
def _hold_dir_lock(path: Path):
    """Hold an exclusive lock on <path>/<lock> so other pytest processes skip
    sweeping this dir (W6: parallel pytest race — one session's cleanup must
    not delete another process's live AG_CONFIG_DIR).

    Windows uses msvcrt byte-range locks, POSIX fcntl.flock; both are released
    by the OS when the owning process dies, so a stale dir from a crashed run
    is sweepable again. The lock file lives inside the dir, so it must be
    closed before the dir is removed.
    """
    lock_path = path / _LOCK_NAME
    fh = open(lock_path, "a+b")
    try:
        if os.name == "nt":
            import msvcrt

            fh.seek(0)
            fh.write(b"\0")
            fh.flush()
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        raise
    try:
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt

                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        fh.close()


def _dir_is_live(path: Path) -> bool:
    """True when another pytest process holds the dir lock (or the lock file
    cannot be opened); such dirs are never swept."""
    lock_path = path / _LOCK_NAME
    if not lock_path.exists():
        return False
    try:
        fh = open(lock_path, "a+b")
    except OSError:
        return True
    try:
        try:
            if os.name == "nt":
                import msvcrt

                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return True  # locked by a live owner
        return False
    finally:
        fh.close()


def _sweep_repo_local_test_dirs() -> None:
    for pattern in _TEST_TMP_PATTERNS:
        for path in TEST_TMP_ROOT.glob(pattern):
            if path.is_dir() and not _dir_is_live(path):
                _rmtree_retry(str(path))


@pytest.fixture(scope="session", autouse=True)
def _cleanup_repo_local_test_dirs():
    """Tests create short-lived dirs inside the repo (sandbox-friendly); sweep leftovers."""

    _sweep_repo_local_test_dirs()
    yield
    _sweep_repo_local_test_dirs()


@pytest.fixture()
def engine_and_sessionmaker():
    os.environ["SLIPSTREAM_SECRET_KEY"] = "test-secret"
    # Inside the repo, plain makedirs: the host sandbox denies writes inside
    # mkdtemp'd directories, and the system temp area entirely.
    ag_dir = str(TEST_TMP_ROOT / (".tmp-ag-test-" + uuid4().hex[:8]))
    os.makedirs(ag_dir, exist_ok=True)
    os.environ["SLIPSTREAM_AG_CONFIG_DIR"] = ag_dir
    # Hermetic tests: never invoke an installed gateway binary from the HTTP
    # layer; the real --validate-only path has its own opt-in test.
    os.environ["SLIPSTREAM_AG_BINARY"] = ""
    reset_settings_cache()
    # Shared in-memory DB across threads: TestClient runs sync endpoints in a
    # threadpool, so the pool must hand back the ONE :memory: connection.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    init_db(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False, future=True)
    # Hold the dir lock across the test so concurrent sessions cannot sweep it.
    with _hold_dir_lock(Path(ag_dir)):
        yield engine, factory
    _rmtree_retry(ag_dir)
    reset_settings_cache()


def make_admin(
    factory,
    *,
    username: str,
    password: str = DEMO_PASSWORD,
    role: str = "owner",
    status: str = "active",
    display_name: str = "",
    user_id: str = "",
) -> str:
    """Insert one unified user account (ADR-019) with a real scrypt hash.

    Returns the users.id, which is also the session identity (session.admin_id
    IS users.id since ADR-019). user_id pins a stable id for tests that assert
    specific node ids in the user tree.
    """
    from l01_core.ids import new_id
    from l01_core.timeutil import now_ms

    with factory() as session:
        row = UserORM(
            id=user_id or new_id("user"),
            username=username,
            password_hash=auth.hash_password(password),
            name=display_name or username,
            role=role,
            status=status,
            created_at_ms=now_ms(),
            updated_at_ms=now_ms(),
        )
        session.add(row)
        session.commit()
        return row.id


def new_session_token(factory, admin_id: str, ttl_seconds: int = 3600) -> str:
    """Create a server-side session directly and return the plaintext cookie token."""
    with factory() as session:
        token, _row = auth.create_session(session, admin_id=admin_id, ttl_seconds=ttl_seconds)
        session.commit()
        return token


# Older tests called this name; both mean "mint a session row without HTTP".
seed_login_session = new_session_token


def _app_client(factory) -> TestClient:
    app = create_app(session_factory=factory, init_tables=False)
    return TestClient(app, raise_server_exceptions=True)


def _authenticated_client(factory, role: str) -> TestClient:
    admin_id = make_admin(factory, username="test-" + role + "-" + uuid4().hex[:6], role=role)
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client


@pytest.fixture(autouse=True)
def _fresh_login_limiter():
    """Login throttling is process-global; never let one test starve another."""
    auth.reset_login_limits()
    yield
    auth.reset_login_limits()


@pytest.fixture()
def client(engine_and_sessionmaker):
    """Authenticated as a default owner; RBAC tests switch roles via login_cookies."""
    _, factory = engine_and_sessionmaker
    return _authenticated_client(factory, "owner")


@pytest.fixture()
def anon_client(engine_and_sessionmaker):
    """A browser with no session cookie (401/forgery/login tests)."""
    _, factory = engine_and_sessionmaker
    return _app_client(factory)


@pytest.fixture()
def login_cookies(engine_and_sessionmaker):
    """Factory: role -> per-request cookie dict for a dedicated account of that role."""

    _, factory = engine_and_sessionmaker

    def _login(role: str = "owner") -> dict[str, str]:
        admin_id = make_admin(
            factory, username="test-" + role + "-" + uuid4().hex[:6], role=role
        )
        return {SESSION_COOKIE: new_session_token(factory, admin_id)}

    return _login


def seed_channel(engine, session_factory, *, transforms=None) -> dict:
    """Seed vendor + upstream(+transforms) + model chain + one user/key; returns ids."""
    from l01_core.timeutil import now_ms

    with session_factory() as session:
        vendor = VendorORM(
            id="vend_test", name="Test Vendor", slug="testv", created_at_ms=now_ms()
        )
        session.add(vendor)
        secret_box = SecretBox("test-secret")
        upstream = UpstreamORM(
            id="ups_test",
            vendor_id=vendor.id,
            name="testv-01",
            base_url="https://upstream.example/v1",
            api_style="openai_chat",
            api_key_enc=secret_box.encrypt("raw-upstream-key"),
            transforms_json=transforms or "",
            created_at_ms=now_ms(),
        )
        session.add(upstream)
        model = UpstreamModelORM(
            id="umdl_test",
            upstream_id=upstream.id,
            name="glm-5.3",
            model_type="chat",
            created_at_ms=now_ms(),
        )
        session.add(model)
        public = PublicModelORM(id="pmdl_test", name="flagship", created_at_ms=now_ms())
        session.add(public)
        session.add(
            ModelTargetORM(
                id="mt_test",
                public_model_id=public.id,
                upstream_model_id=model.id,
                priority=1,
                created_at_ms=now_ms(),
            )
        )
        user = UserORM(
            id="usr_test", name="alice", balance_micro=50_000_000, created_at_ms=now_ms()
        )
        session.add(user)
        session.flush()
        issued = issue_client_key(session, user_id=user.id, box=AesGcmBox("test-secret"))
        session.commit()
        return {
            "vendor_id": vendor.id,
            "upstream_id": upstream.id,
            "upstream_model_id": model.id,
            "public_id": public.id,
            "user_id": user.id,
            "key_id": issued.key_id,
            "key_plaintext": issued.plaintext,
            "key_hash": issued.key_hash,
        }
