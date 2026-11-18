"""Global console auth gate: every /admin route except login/logout/health needs a session.

Runs inside CORS so a 401 still carries CORS headers for the browser. The
principal is resolved once here and consumed by the route dependencies; no
request header (X-Admin-Role included) can choose an identity.
"""

from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from l05_service import auth
from l06_api.deps import SESSION_COOKIE, UNAUTHENTICATED_MESSAGE

# Exact paths that must work without a session.
EXEMPT_PATHS = frozenset(
    {"/admin/auth/login", "/admin/auth/logout", "/admin/health", "/api/health"}
)


class AdminSessionMiddleware(BaseHTTPMiddleware):
    """Resolve the session cookie to a principal; reject unauthenticated admin calls."""

    async def dispatch(self, request: Request, call_next):
        # CORS preflights carry no cookie and no payload; let the CORS layer
        # answer them (it is installed inside this middleware), otherwise the
        # browser never sees Access-Control-Allow-Origin on protected routes.
        if request.method == "OPTIONS":
            return await call_next(request)
        path = request.url.path.rstrip("/") or "/"
        if not path.startswith("/admin") or path in EXEMPT_PATHS:
            return await call_next(request)

        principal = None
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            factory = request.app.state.session_factory
            with factory() as session:
                principal = auth.resolve_session(session, token)
        if principal is None:
            request_id = request.headers.get("X-Request-Id", uuid.uuid4().hex)
            return JSONResponse(
                status_code=401,
                content={
                    "code": "UNAUTHORIZED",
                    "message": UNAUTHENTICATED_MESSAGE,
                    "details": {},
                    "request_id": request_id,
                },
                headers={"X-Request-Id": request_id},
            )
        request.state.principal = principal
        return await call_next(request)
