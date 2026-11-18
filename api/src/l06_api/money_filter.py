"""Response-level money visibility (architecture review #5).

ADR-016 says a field is absent, not null, without its permission. Before this
module every route had to remember `field_filter.sanitize(...)`; a forgotten
call leaked money. The filter now runs once for every JSON /admin response,
inside the auth middleware so the principal is already resolved.

Route-specific bare `amount_micro` values declare their class in the route
decorator (`openapi_extra={"x-money-amount-class": "spend"}`); named money keys
(cost_micro / margin / charge_micro / balance_after_micro ...) are recognized by
the shared vocabulary in field_filter. Streams (NDJSON/CSV/text) bypass this
filter and must sanitize their own projection explicitly - the one remaining
escape hatch, documented in docs/api-contract.md §0.5.
"""

from __future__ import annotations

import json
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from l06_api import field_filter


def amount_class_for_scope(scope: Scope) -> field_filter.CostClass | None:
    """Read the route's declared bare-amount class, if any."""
    route = scope.get("route")
    extra = getattr(route, "openapi_extra", None) or {}
    value = extra.get("x-money-amount-class")
    return value if value in ("cost", "spend") else None


class MoneyVisibilityMiddleware:
    """Filter finished JSON responses by the caller's money permissions once."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith("/admin"):
            await self.app(scope, receive, send)
            return
        state = scope.get("state") or {}
        principal = state.get("principal")
        if principal is None:
            await self.app(scope, receive, send)
            return

        start: Message | None = None
        chunks: list[bytes] = []
        passthrough = False

        async def wrapped_send(message: Message) -> None:
            nonlocal start, chunks, passthrough
            if message["type"] == "http.response.start":
                headers = {key.lower(): value for key, value in message["headers"]}
                content_type = headers.get(b"content-type", b"").decode("latin-1")
                if (
                    "application/json" not in content_type
                    or message["status"] in (204, 304)
                ):
                    passthrough = True
                    await send(message)
                    return
                start = message
                chunks = []
                return
            if message["type"] != "http.response.body":
                await send(message)
                return
            if passthrough:
                await send(message)
                return
            chunks.append(message.get("body", b""))
            if message.get("more_body"):
                return
            body = b"".join(chunks)
            try:
                payload: Any = json.loads(body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                # Never break a response we cannot parse; this is a guard, not a
                # serializer transformation.
                if start is not None:
                    await send(start)
                await send({"type": "http.response.body", "body": body})
                return
            cleaned = field_filter.filter_payload(
                payload,
                principal.permissions,
                amount_micro=amount_class_for_scope(scope),
            )
            if cleaned == payload:
                new_body = body
            else:
                new_body = json.dumps(
                    cleaned, ensure_ascii=False, separators=(",", ":"), allow_nan=False
                ).encode("utf-8")
            assert start is not None
            headers = [
                (key, value)
                for key, value in start["headers"]
                if key.lower() != b"content-length"
            ]
            headers.append((b"content-length", str(len(new_body)).encode("latin-1")))
            await send({**start, "headers": headers})
            await send({"type": "http.response.body", "body": new_body})

        await self.app(scope, receive, wrapped_send)
