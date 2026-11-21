"""The daily status notice store (W6 ticket 08).

The daily job (``l07_jobs.status_notice``) computes the raw check results --
config artifact hash vs the data-plane running hash, backend version vs the web
build version -- and hands them to :func:`apply_check_result`; this module owns
what an operator actually sees: which problems are currently active, whether a
notice was already pushed for one inside the last 24 hours, and the wire
payload ``GET /admin/system-status`` returns to the notification center.

Both the notices and the dedup state live in app_settings and are written back
on every pass, so restarting the control plane does not reset the 24-hour
window. A check that reports ``unknown`` (say, an unreachable data plane)
neither clears an existing problem nor re-arms its window: only a positive
``ok`` does, which is what lets a recovered problem notify again.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from l01_core.timeutil import ms_to_iso
from l04_repo.repository import get_setting, put_setting

#: The control-plane release version; a pin test keeps it in step with
#: api/pyproject.toml and web/package.json (tests/unit/test_status_notice.py).
CONTROL_PLANE_VERSION = "0.1.0"

#: app_settings keys: the pollable notice payload and the dedup state.
STATUS_NOTICE_KEY = "daily_status_notice"
STATUS_STATE_KEY = "daily_status_check_state"

#: Same-problem dedup window: one reminder per problem per 24 hours.
STATUS_NOTICE_WINDOW_MS = 24 * 3600 * 1000

#: Readable reminder titles keyed by the check id the job reports.
CHECK_TITLES = {
    "config_hash": "配置未生效：数据面运行版本与最新配置不一致",
    "frontend_version": "版本不一致：前端构建版本与后端版本不一致",
}


def _load(session: Session, key: str) -> dict[str, Any]:
    """Stored JSON object, or {} when absent/corrupt (the store self-heals)."""
    raw = get_setting(session, key)
    if raw is None:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _notice_detail(result: dict[str, Any], now: int) -> str:
    """One readable line: expected vs actual, then the check time."""
    parts = []
    if result.get("expected") is not None:
        parts.append(f"期望 {result['expected']}")
    if result.get("actual") is not None:
        parts.append(f"实际 {result['actual']}")
    if result.get("detail"):
        parts.append(str(result["detail"]))
    parts.append(f"检查时间 {ms_to_iso(now)}")
    return "；".join(parts) + "。"


def apply_check_result(
    session: Session, checks: dict[str, dict[str, Any]], now: int
) -> dict[str, dict[str, Any]]:
    """Merge one pass of raw check results into the persisted notice store.

    ``checks`` maps check id to ``{"status": ok|unknown|mismatch, "expected",
    "actual", "detail"}``. Returns the notice map that is current afterwards:
    one entry per active problem, freshly stamped when pushed.

    Per problem: ``mismatch`` pushes a new notice when none was pushed in the
    last 24h (otherwise the original notice is kept -- dedup); ``ok`` recovers
    and clears it; ``unknown`` leaves the problem and its window untouched.
    """
    state = _load(session, STATUS_STATE_KEY)
    raw_problems = state.get("problems")
    problems: dict[str, Any] = raw_problems if isinstance(raw_problems, dict) else {}
    store = _load(session, STATUS_NOTICE_KEY)
    raw_notices = store.get("notices")
    notices: dict[str, Any] = raw_notices if isinstance(raw_notices, dict) else {}

    for check, result in checks.items():
        status = result.get("status") if isinstance(result, dict) else None
        if status == "ok":
            problems.pop(check, None)
            notices.pop(check, None)
            continue
        if status != "mismatch":
            # unknown (or a malformed result): never clears, never re-arms.
            continue
        record = problems.get(check)
        last = record.get("last_notified_at_ms") if isinstance(record, dict) else None
        if isinstance(last, int) and 0 <= now - last < STATUS_NOTICE_WINDOW_MS:
            continue  # same problem inside the window: keep the original push
        problems[check] = {"last_notified_at_ms": now}
        notices[check] = {
            "check": check,
            "title": CHECK_TITLES.get(check, check),
            "detail": _notice_detail(result, now),
            "notified_at_ms": now,
            "notified_at": ms_to_iso(now),
        }

    payload = {"checked_at_ms": now, "checks": checks, "notices": notices}
    put_setting(
        session, STATUS_NOTICE_KEY, json.dumps(payload, ensure_ascii=False), now
    )
    put_setting(
        session, STATUS_STATE_KEY, json.dumps({"problems": problems}), now
    )
    return notices


def read_status(session: Session) -> dict[str, Any]:
    """The ``GET /admin/system-status`` payload the notification center polls."""
    store = _load(session, STATUS_NOTICE_KEY)
    raw_notices = store.get("notices")
    checked_at_ms = store.get("checked_at_ms")
    notices = sorted(
        (n for n in raw_notices.values() if isinstance(n, dict)),
        key=lambda n: n.get("notified_at_ms") or 0,
        reverse=True,
    ) if isinstance(raw_notices, dict) else []
    return {
        "checked_at": ms_to_iso(checked_at_ms) if isinstance(checked_at_ms, int) else "",
        "backend_version": CONTROL_PLANE_VERSION,
        "checks": store.get("checks") if isinstance(store.get("checks"), dict) else {},
        "notices": notices,
    }
