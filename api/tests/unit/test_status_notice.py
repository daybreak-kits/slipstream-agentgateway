"""W6 ticket 08: the daily status check and its 24-hour notice dedup.

Seams under test:

* ``l05_service.status_notice.apply_check_result`` - the persisted notice store:
  one notice per problem, 24h dedup, recovery re-arms, unknown keeps state
  (time is injected, so the state machine is pinned exactly);
* ``l07_jobs.status_notice.run_status_check`` - the daily job body: active
  revision hash vs the adapter status port, backend version vs the web build
  meta, unknown-when-unavailable semantics;
* ``GET /admin/system-status`` - the wire the notification center polls.

The dedup state and the notices live in app_settings, so a control-plane
restart does not reset the 24h window.
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

from l04_repo.orm import AppSettingORM, ConfigRevisionORM
from l05_service.status_notice import (
    CONTROL_PLANE_VERSION,
    STATUS_NOTICE_KEY,
    STATUS_STATE_KEY,
    apply_check_result,
    read_status,
)
from l07_jobs.status_notice import run_status_check

#: Fixed clock base so dedup windows are exact (2026-11-21T00:05:00Z).
T0 = 1_795_219_500_000
DAY_MS = 24 * 3600 * 1000


def _mismatch(expected: str = "aaa", actual: str = "bbb") -> dict:
    return {"status": "mismatch", "expected": expected, "actual": actual, "detail": ""}


def _ok(expected: str = "aaa") -> dict:
    return {"status": "ok", "expected": expected, "actual": expected, "detail": ""}


def _unknown(expected: str | None = "aaa") -> dict:
    return {"status": "unknown", "expected": expected, "actual": None, "detail": "不可得"}


# ---------------------------------------------------------------------------
# Notice store state machine (l05 seam)


def test_mismatch_pushes_one_notice_with_check_and_time(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        notices = apply_check_result(session, {"config_hash": _mismatch()}, T0)
        session.commit()
    notice = notices["config_hash"]
    assert notice["title"] == "配置未生效：数据面运行版本与最新配置不一致"
    assert "aaa" in notice["detail"] and "bbb" in notice["detail"]
    assert "2026-11-21" in notice["detail"], "the readable reminder carries the check time"
    assert notice["notified_at_ms"] == T0
    with factory() as session:
        payload = read_status(session)
    assert [n["check"] for n in payload["notices"]] == ["config_hash"]


def test_consistent_checks_push_nothing(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        notices = apply_check_result(
            session,
            {"config_hash": _ok(), "frontend_version": _ok("0.1.0")},
            T0,
        )
        session.commit()
    assert notices == {}
    with factory() as session:
        assert read_status(session)["notices"] == []


def test_same_problem_within_24h_is_deduped(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        first = apply_check_result(session, {"config_hash": _mismatch()}, T0)
        session.commit()
    with factory() as session:
        second = apply_check_result(session, {"config_hash": _mismatch()}, T0 + DAY_MS - 1)
        session.commit()
    assert second["config_hash"]["notified_at_ms"] == T0, "no second push inside the window"
    assert first["config_hash"]["notified_at_ms"] == T0


def test_same_problem_after_24h_pushes_again(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        apply_check_result(session, {"config_hash": _mismatch()}, T0)
        session.commit()
    with factory() as session:
        again = apply_check_result(session, {"config_hash": _mismatch()}, T0 + DAY_MS)
        session.commit()
    assert again["config_hash"]["notified_at_ms"] == T0 + DAY_MS


def test_recovery_clears_notice_and_next_problem_pushes_fresh(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        apply_check_result(session, {"config_hash": _mismatch()}, T0)
        session.commit()
    with factory() as session:
        cleared = apply_check_result(session, {"config_hash": _ok()}, T0 + 3600_000)
        session.commit()
    assert cleared == {}, "recovery clears the notice"
    with factory() as session:
        assert read_status(session)["notices"] == []
    with factory() as session:
        rearm = apply_check_result(session, {"config_hash": _mismatch()}, T0 + 7200_000)
        session.commit()
    assert rearm["config_hash"]["notified_at_ms"] == T0 + 7200_000, (
        "a recovered problem may notify again immediately"
    )


def test_unknown_check_keeps_state_and_notice_untouched(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        apply_check_result(session, {"config_hash": _mismatch()}, T0)
        session.commit()
    with factory() as session:
        kept = apply_check_result(session, {"config_hash": _unknown()}, T0 + 3600_000)
        session.commit()
    assert kept["config_hash"]["notified_at_ms"] == T0, (
        "unknown never clears a problem nor resets its window"
    )


def test_corrupt_persisted_state_is_treated_as_empty(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        from l04_repo.repository import put_setting

        put_setting(session, STATUS_STATE_KEY, "{not json", T0)
        put_setting(session, STATUS_NOTICE_KEY, "garbage", T0)
        session.commit()
        notices = apply_check_result(session, {"config_hash": _mismatch()}, T0)
        session.commit()
    assert notices["config_hash"]["notified_at_ms"] == T0


def test_unchanged_conclusion_skips_the_app_settings_writes(engine_and_sessionmaker):
    """W6 review P1-1: a pass whose conclusion is unchanged writes no app_settings row."""
    _, factory = engine_and_sessionmaker
    with factory() as session:
        apply_check_result(session, {"config_hash": _mismatch()}, T0)
        session.commit()
        first_notice = session.get(AppSettingORM, STATUS_NOTICE_KEY)
        first_state = session.get(AppSettingORM, STATUS_STATE_KEY)

    with factory() as session:
        apply_check_result(session, {"config_hash": _mismatch()}, T0 + 3600_000)
        session.commit()
        second_notice = session.get(AppSettingORM, STATUS_NOTICE_KEY)
        second_state = session.get(AppSettingORM, STATUS_STATE_KEY)

    assert second_notice.value_json == first_notice.value_json
    assert second_notice.updated_at_ms == first_notice.updated_at_ms, (
        "同结论重跑不得重写 notice 行"
    )
    assert second_state.updated_at_ms == first_state.updated_at_ms, (
        "同结论重跑不得重写 state 行"
    )

    with factory() as session:
        apply_check_result(session, {"config_hash": _ok()}, T0 + 7200_000)
        session.commit()
        third_notice = session.get(AppSettingORM, STATUS_NOTICE_KEY)

    assert third_notice.updated_at_ms == T0 + 7200_000, "结论变化（恢复）仍要落库"


# ---------------------------------------------------------------------------
# Daily job body (l07 seam)


class _StubStatusAdapter:
    """Status-port-only stub: the daily check touches ``status()`` alone."""

    def __init__(self, result: object) -> None:
        self._result = result

    def status(self):
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


def _status(config_hash: str | None):
    return type("S", (), {"config_hash": config_hash, "detail": "applied"})()


def _add_active_revision(factory, artifact_hash: str) -> None:
    with factory() as session:
        session.add(
            ConfigRevisionORM(
                id="rev_t08",
                artifact="config: {}",
                artifact_hash=artifact_hash,
                status="active",
                created_at_ms=T0,
            )
        )
        session.commit()


def _dist_with_version(tmp_path: Path, version: str | None) -> Path:
    meta = f'<meta name="app-version" content="{version}">' if version else ""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text(
        "<!doctype html><head>" + meta + "</head><body></body>", encoding="utf-8"
    )
    return dist


def test_matching_config_hash_is_ok_and_silent(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _add_active_revision(factory, "a" * 64)
    result = run_status_check(factory, adapter=_StubStatusAdapter(_status("a" * 64)), now=T0)
    assert result["checks"]["config_hash"]["status"] == "ok"
    with factory() as session:
        assert read_status(session)["notices"] == []


def test_config_hash_mismatch_pushes_a_notice(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _add_active_revision(factory, "a" * 64)
    result = run_status_check(factory, adapter=_StubStatusAdapter(_status("b" * 64)), now=T0)
    assert result["checks"]["config_hash"]["status"] == "mismatch"
    with factory() as session:
        payload = read_status(session)
    assert payload["notices"][0]["check"] == "config_hash"
    assert payload["notices"][0]["title"], "the reminder is readable"
    assert payload["checked_at"] != ""


def test_unreachable_status_is_unknown_never_a_false_mismatch(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _add_active_revision(factory, "a" * 64)
    result = run_status_check(
        factory, adapter=_StubStatusAdapter(RuntimeError("data plane down")), now=T0
    )
    check = result["checks"]["config_hash"]
    assert check["status"] == "unknown"
    assert check["detail"], "the report says why it is unknown"
    with factory() as session:
        assert read_status(session)["notices"] == []


def test_running_hash_absent_is_unknown(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _add_active_revision(factory, "a" * 64)
    result = run_status_check(
        factory, adapter=_StubStatusAdapter(_status(None)), now=T0
    )
    assert result["checks"]["config_hash"]["status"] == "unknown"
    with factory() as session:
        assert read_status(session)["notices"] == []


def test_no_active_revision_is_unknown(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    result = run_status_check(
        factory, adapter=_StubStatusAdapter(_status("b" * 64)), now=T0
    )
    assert result["checks"]["config_hash"]["status"] == "unknown"


def test_frontend_version_mismatch_pushes_a_notice(engine_and_sessionmaker, tmp_path):
    _, factory = engine_and_sessionmaker
    dist = _dist_with_version(tmp_path, "9.9.9-different")
    result = run_status_check(
        factory, adapter=_StubStatusAdapter(RuntimeError("not used")), now=T0, dist_dir=dist
    )
    check = result["checks"]["frontend_version"]
    assert check["status"] == "mismatch"
    assert check["expected"] == CONTROL_PLANE_VERSION
    assert check["actual"] == "9.9.9-different"
    with factory() as session:
        payload = read_status(session)
    assert payload["notices"][0]["check"] == "frontend_version"


def test_frontend_version_match_is_ok(engine_and_sessionmaker, tmp_path):
    _, factory = engine_and_sessionmaker
    dist = _dist_with_version(tmp_path, CONTROL_PLANE_VERSION)
    result = run_status_check(
        factory, adapter=_StubStatusAdapter(RuntimeError("not used")), now=T0, dist_dir=dist
    )
    assert result["checks"]["frontend_version"]["status"] == "ok"


def test_missing_frontend_build_is_unknown(engine_and_sessionmaker, tmp_path):
    _, factory = engine_and_sessionmaker
    result = run_status_check(
        factory,
        adapter=_StubStatusAdapter(RuntimeError("not used")),
        now=T0,
        dist_dir=tmp_path / "no-dist-here",
    )
    assert result["checks"]["frontend_version"]["status"] == "unknown"
    with factory() as session:
        assert read_status(session)["notices"] == []


def test_frontend_build_version_reader_parses_the_meta(tmp_path):
    from l07_jobs.status_notice import frontend_build_version

    dist = _dist_with_version(tmp_path, "0.1.0")
    assert frontend_build_version(dist) == "0.1.0"
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "index.html").write_text("<!doctype html><head></head>", encoding="utf-8")
    assert frontend_build_version(plain) is None


def test_control_plane_version_matches_pyproject_and_web_package():
    """The compare baseline must not drift from the release manifests."""
    api_root = Path(__file__).resolve().parents[2]
    repo_root = api_root.parent
    with (api_root / "pyproject.toml").open("rb") as handle:
        pyproject = tomllib.load(handle)
    web_pkg = json.loads((repo_root / "web" / "package.json").read_text(encoding="utf-8"))
    assert CONTROL_PLANE_VERSION == pyproject["project"]["version"] == web_pkg["version"]


# ---------------------------------------------------------------------------
# Wire seam: GET /admin/system-status


def _login(factory):
    from fastapi.testclient import TestClient
    from tests.conftest import make_admin, new_session_token

    from l06_api.deps import SESSION_COOKIE
    from server import create_app

    app = create_app(session_factory=factory, init_tables=False, jobs=False)
    admin_id = make_admin(factory, username="status-notice-reader")
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client


def test_system_status_endpoint_reports_checks_and_notices(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    client = _login(factory)
    empty = client.get("/admin/system-status")
    assert empty.status_code == 200, empty.text
    assert empty.json()["backend_version"] == CONTROL_PLANE_VERSION
    assert empty.json()["notices"] == []
    assert empty.json()["checked_at"] == ""

    _add_active_revision(factory, "a" * 64)
    run_status_check(factory, adapter=_StubStatusAdapter(_status("b" * 64)), now=T0)
    after = client.get("/admin/system-status")
    assert after.status_code == 200
    body = after.json()
    assert body["checks"]["config_hash"]["status"] == "mismatch"
    assert body["notices"][0]["title"]


def test_system_status_requires_a_session(engine_and_sessionmaker):
    from fastapi.testclient import TestClient

    from server import create_app

    _, factory = engine_and_sessionmaker
    app = create_app(session_factory=factory, init_tables=False, jobs=False)
    client = TestClient(app)
    assert client.get("/admin/system-status").status_code == 401
