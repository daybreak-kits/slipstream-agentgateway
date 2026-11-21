"""Unified error taxonomy: every layer raises AppError; l06_api renders it as one JSON shape."""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    """Stable machine-readable error codes surfaced verbatim to admins."""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    RATE_LIMITED = "RATE_LIMITED"
    # W6 ticket 07: a missing/unreachable data plane is a dependency state, not
    # a server bug -- reads degrade to 503 with this stable code, never a 500.
    DATA_PLANE_UNAVAILABLE = "DATA_PLANE_UNAVAILABLE"
    SCHEMA_MISMATCH = "SCHEMA_MISMATCH"
    APPLY_FAILED = "APPLY_FAILED"
    CRYPTO_FAILED = "CRYPTO_FAILED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


_HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.VALIDATION_ERROR: 422,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.CONFLICT: 409,
    ErrorCode.UNAUTHORIZED: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.DATA_PLANE_UNAVAILABLE: 503,
    ErrorCode.SCHEMA_MISMATCH: 500,
    ErrorCode.APPLY_FAILED: 502,
    ErrorCode.CRYPTO_FAILED: 500,
    ErrorCode.INTERNAL_ERROR: 500,
}


def http_status(code: ErrorCode) -> int:
    """Default HTTP status for an error code; callers may override per route."""
    return _HTTP_STATUS[code]


class AppError(Exception):
    """Business error with a stable code; safe to surface to admin clients."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details: dict[str, Any] = details or {}
        self.status_code = status_code or http_status(code)

    def to_payload(self, request_id: str = "") -> dict[str, Any]:
        """JSON body used by the API error handler."""
        return {
            "code": self.code.value,
            "message": self.message,
            "details": self.details,
            "request_id": request_id,
        }
