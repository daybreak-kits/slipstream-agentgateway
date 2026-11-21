"""Daily status check job (W6 ticket 08): config drift + build version drift.

Once a day -- the runner anchors the first pass to just after local midnight
and the wrapper self-gates on the app_settings last-run date, so a restart or
a second replica never repeats the pass inside the same local day (W6 review
P1-1) -- the job runs two checks and hands the raw results to the notice store
(l05_service.status_notice), which decides whether an operator-visible
reminder is pushed into the notification center via ``GET /admin/system-status``:

* the latest active config revision's artifact hash vs the data plane's running
  hash (the adapter ``status()`` port). A missing running hash or an unreachable
  status port reports ``unknown`` -- never a false "consistent";
* the control-plane release version vs the served web build version. The web
  build injects its package version as an ``app-version`` meta tag into
  dist/index.html (vite.config.ts), which is the lightest available signal; an
  unreadable build reports ``unknown`` too.

Registering here means the job follows SLIPSTREAM_JOBS_ENABLED like the other
in-process jobs; failures are JobRunner-visible (logged, loop keeps running)
and never affect service startup.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from l01_core.settings import Settings, get_settings
from l01_core.timeutil import local_today, now_ms
from l04_repo.orm import ConfigRevisionORM
from l04_repo.repository import get_setting, put_setting
from l05_service.rollout import RevisionStatus
from l05_service.status_notice import CONTROL_PLANE_VERSION, apply_check_result
from l06_api.adapter_factory import make_adapter
from l06_api.spa import resolve_web_dist

LOGGER = logging.getLogger("slipstream.jobs")

#: Daily housekeeping cadence, same as log_cleanup / models_dev_sync.
STATUS_CHECK_INTERVAL_S = 24 * 3600

#: app_settings key recording the last-run local date (restart/multi-replica gate).
STATUS_CHECK_LAST_RUN_KEY = "daily_status_check_last_run"

#: Neutral check ids reported in the notice payload.
CHECK_CONFIG_HASH = "config_hash"
CHECK_FRONTEND_VERSION = "frontend_version"

_APP_VERSION_META = re.compile(r'name="app-version"\s+content="([^"]+)"')

__all__ = [
    "CHECK_CONFIG_HASH",
    "CHECK_FRONTEND_VERSION",
    "STATUS_CHECK_INTERVAL_S",
    "STATUS_CHECK_LAST_RUN_KEY",
    "frontend_build_version",
    "make_status_check_job",
    "run_status_check",
]


def frontend_build_version(dist_dir: str | None = None) -> str | None:
    """The version the served console build declares (None when unreadable)."""
    dist = resolve_web_dist(dist_dir)
    if dist is None:
        return None
    try:
        html = (dist / "index.html").read_text(encoding="utf-8")
    except OSError:
        return None
    match = _APP_VERSION_META.search(html)
    return match.group(1) if match else None


def _latest_active_hash(session_factory: sessionmaker) -> str | None:
    """Artifact hash of the newest active config revision (None when empty)."""
    with session_factory() as session:
        row = session.scalars(
            select(ConfigRevisionORM)
            .where(ConfigRevisionORM.status == RevisionStatus.ACTIVE.value)
            .order_by(ConfigRevisionORM.created_at_ms.desc(), ConfigRevisionORM.id.desc())
            .limit(1)
        ).first()
        return row.artifact_hash if row is not None else None


def _check_config_hash(session_factory: sessionmaker, adapter: object) -> dict:
    """Applied config artifact hash vs the data plane's running hash."""
    expected = _latest_active_hash(session_factory)
    try:
        status = adapter.status()
    except Exception as exc:  # external boundary: an unreachable data plane is "unknown"
        return {
            "status": "unknown",
            "expected": expected,
            "actual": None,
            "detail": f"数据面状态不可得：{exc}",
        }
    actual = getattr(status, "config_hash", None)
    if expected is None:
        return {
            "status": "unknown",
            "expected": None,
            "actual": actual,
            "detail": "无活跃配置版本",
        }
    if actual is None:
        detail = "数据面运行 hash 不可得"
        if getattr(status, "detail", ""):
            detail += f"：{status.detail}"
        return {"status": "unknown", "expected": expected, "actual": None, "detail": detail}
    return {
        "status": "ok" if actual == expected else "mismatch",
        "expected": expected,
        "actual": actual,
        "detail": "",
    }


def _check_frontend_version(dist_dir: str | None) -> dict:
    """Control-plane release version vs the served web build version."""
    expected = CONTROL_PLANE_VERSION
    actual = frontend_build_version(dist_dir)
    if actual is None:
        return {
            "status": "unknown",
            "expected": expected,
            "actual": None,
            "detail": "前端构建产物不可得（未构建或缺少版本标记）",
        }
    return {
        "status": "ok" if actual == expected else "mismatch",
        "expected": expected,
        "actual": actual,
        "detail": "",
    }


def run_status_check(
    session_factory: sessionmaker,
    settings: Settings | None = None,
    *,
    adapter: object | None = None,
    now: int | None = None,
    dist_dir: str | None = None,
) -> dict:
    """One daily pass over both checks; persists the notices and returns the raw results.

    ``adapter`` (tests) overrides the composition-resolved driver; ``now`` and
    ``dist_dir`` are the test-injectable clock and web build location.
    """
    resolved = settings or get_settings()
    resolved_adapter = adapter if adapter is not None else make_adapter(resolved)
    stamp = now if now is not None else now_ms()
    checks = {
        CHECK_CONFIG_HASH: _check_config_hash(session_factory, resolved_adapter),
        CHECK_FRONTEND_VERSION: _check_frontend_version(dist_dir),
    }
    with session_factory() as session:
        notices = apply_check_result(session, checks, stamp)
        session.commit()
    for check, notice in notices.items():
        if checks[check]["status"] == "mismatch":
            LOGGER.warning("每日状态检查推送提醒：%s %s", notice["title"], notice["detail"])
    LOGGER.info(
        "daily status check finished: %s",
        {check: result["status"] for check, result in checks.items()},
    )
    return {"checked_at_ms": stamp, "checks": checks}


def make_status_check_job(
    session_factory: sessionmaker, settings: Settings | None = None
) -> Callable[[], Awaitable[dict]]:
    """Coroutine factory registered with the JobRunner (daily cadence).

    The pass body is :func:`run_status_check`; this wrapper records the last-run
    local date under ``STATUS_CHECK_LAST_RUN_KEY`` so a restart or a second
    replica never repeats the pass inside the same local day (W6 review P1-1).
    """
    resolved = settings or get_settings()

    async def _job() -> dict:
        with session_factory() as session:
            last_run_date = get_setting(session, STATUS_CHECK_LAST_RUN_KEY)
        if last_run_date == local_today():
            LOGGER.info("daily status check already ran today (%s); skipping", last_run_date)
            return {"skipped": True}
        result = run_status_check(session_factory, resolved)
        with session_factory() as session:
            put_setting(session, STATUS_CHECK_LAST_RUN_KEY, local_today(), now_ms())
            session.commit()
        return result

    return _job
