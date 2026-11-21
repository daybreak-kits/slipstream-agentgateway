"""Request-scoped dependencies: authenticated principal, RBAC gate, session scope."""

from __future__ import annotations

from collections.abc import Callable, Iterator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l05_service import auth, rbac
from l06_api.adapter_factory import get_adapter as get_adapter  # re-exported request dependency

# httpOnly cookie carrying the opaque session token (server-side row in admin_sessions).
SESSION_COOKIE = "slipstream_admin_session"
UNAUTHENTICATED_MESSAGE = "未登录或会话已失效"
ALLOWED_PAGE_SIZES = (25, 50, 100, 200)
DEFAULT_PAGE_SIZE = 50

# W6 ticket 16: the custom report window cap, defined once. ops/contract/gen_ts.py
# exports it into web/src/generated/contract.ts and the UI picker derives its
# calendar bounds from that export, so the selector and the backend cannot drift.
MAX_CUSTOM_SPAN_MS = 366 * 86_400_000
MAX_CUSTOM_SPAN_DAYS = MAX_CUSTOM_SPAN_MS // 86_400_000


def raise_span_over_cap(from_ms: int, to_ms: int) -> None:
    """422 when an explicit positive epoch-ms pair spans more than the shared cap."""
    if to_ms - from_ms > MAX_CUSTOM_SPAN_MS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"from_ms/to_ms span must not exceed {MAX_CUSTOM_SPAN_DAYS} days",
            details={
                "from_ms": from_ms,
                "to_ms": to_ms,
                "max_span_ms": MAX_CUSTOM_SPAN_MS,
                "max_span_days": MAX_CUSTOM_SPAN_DAYS,
            },
        )


def validate_window_pair(from_ms: int, to_ms: int) -> None:
    """Shared guard for overview/margin windows (W6 ticket 16).

    These routes treat from_ms <= 0 / to_ms <= 0 as "since the beginning / up
    to now" -- a documented default, not an explicit custom window. Only a
    fully explicit positive pair is validated, and then with the same rules as
    the latency/timeseries/heatmap/flow guard: ordered, and within the cap.
    """
    if from_ms <= 0 or to_ms <= 0:
        return
    if from_ms >= to_ms:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "from_ms must be less than to_ms",
            details={"from_ms": from_ms, "to_ms": to_ms},
        )
    raise_span_over_cap(from_ms, to_ms)


def current_principal(request: Request) -> auth.Principal:
    """Identity resolved by AdminSessionMiddleware; 401 when the gate let a request through."""
    principal = getattr(request.state, "principal", None)
    if principal is None:
        raise AppError(ErrorCode.UNAUTHORIZED, UNAUTHENTICATED_MESSAGE)
    return principal


def require(permission: str) -> Callable[[], auth.Principal]:
    """Dependency factory enforcing one registered permission key (`resource:action`)."""

    def _dep(  # noqa: B008
        principal: auth.Principal = Depends(current_principal),  # noqa: B008
    ) -> auth.Principal:
        rbac.require_permission(principal.permissions, permission)
        return principal

    return _dep


def session_of(request: Request) -> Iterator[Session]:
    """One session per request, closed on exit; the factory is injectable for tests."""
    factory = request.app.state.session_factory
    with factory() as session:
        yield session


def page_params(page_size: int = DEFAULT_PAGE_SIZE, offset: int = 0) -> tuple[int, int]:
    """Tiered page sizes only: 25/50/100/200, default 50 (lead decision 6)."""
    if page_size not in ALLOWED_PAGE_SIZES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"page_size must be one of {ALLOWED_PAGE_SIZES}",
            details={"page_size": page_size},
        )
    if offset < 0:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, "offset must be >= 0", details={"offset": offset}
        )
    return page_size, offset
