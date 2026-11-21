"""FastAPI application factory (docs/PLAN.md §3: control plane on 3700)."""

from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import sessionmaker

from l01_core.cors import cors_origins
from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l04_repo.base import init_db, make_engine, make_sessionmaker
from l05_service import auth, availability, roles, user_tree
from l06_api.auth_middleware import AdminSessionMiddleware
from l06_api.money_filter import MoneyVisibilityMiddleware
from l06_api.routers_apikeys import router as apikeys_router
from l06_api.routers_auth import router as auth_router
from l06_api.routers_availability import router as availability_router
from l06_api.routers_billing import router as billing_router
from l06_api.routers_bills import router as bills_router
from l06_api.routers_config import router as config_router
from l06_api.routers_health import router as health_router
from l06_api.routers_log_payload import router as log_payload_router
from l06_api.routers_meta import router as meta_router
from l06_api.routers_models import router as models_router
from l06_api.routers_my_models import router as my_models_router
from l06_api.routers_ops import router as ops_router
from l06_api.routers_policies import router as policies_router
from l06_api.routers_pricing_io import router as pricing_io_router
from l06_api.routers_reports import router as reports_router
from l06_api.routers_roles import router as roles_router
from l06_api.routers_upstreams import router as upstreams_router
from l06_api.routers_usage import router as usage_router
from l06_api.spa import mount_web_console

ALL_ROUTERS = (
    health_router,
    auth_router,
    upstreams_router,
    models_router,
    my_models_router,
    apikeys_router,
    availability_router,
    usage_router,
    billing_router,
    pricing_io_router,
    bills_router,
    reports_router,
    roles_router,
    ops_router,
    policies_router,
    config_router,
    meta_router,
    log_payload_router,
)


def create_app(
    session_factory: sessionmaker | None = None,
    *,
    init_tables: bool = True,
) -> FastAPI:
    """Build the app; tests inject their own sessionmaker (tables already created)."""
    app = FastAPI(title="slipstream-control-plane", version="0.1.0")
    # Middleware added last is outermost: money visibility runs after the auth
    # gate (principal in scope state) but inside CORS; auth responses still carry
    # CORS headers because CORS is outermost.
    app.add_middleware(MoneyVisibilityMiddleware)
    app.add_middleware(AdminSessionMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,  # session cookie must ride along from the Vite origin
        expose_headers=["x-request-id"],
    )
    if session_factory is None:
        settings = get_settings()
        engine = make_engine(settings.database_url)
        if init_tables:
            init_db(engine)
        session_factory = make_sessionmaker(engine)
    app.state.session_factory = session_factory
    # Built-in roles are data: seed missing rows once per app start (idempotent).
    with session_factory() as seed_session:
        roles.ensure_builtin_roles(seed_session)
        # Root user D (ticket 04): every consumer account hangs under it.
        user_tree.ensure_root_user(seed_session)
        # ADR-019 bootstrap: create the initial admin from .env only while no
        # admin-role user with a password exists; afterwards env never applies.
        auth.ensure_bootstrap_admin(seed_session)
        # ADR-004: adopt any pre-existing row deadline into its managed rule so
        # availability_rules is the only write authority (idempotent, additive).
        availability.migrate_legacy_cooldowns(seed_session)
        seed_session.commit()
    for router in ALL_ROUTERS:
        app.include_router(router)
    # 单端口部署：构建后的管理台（web/dist）由控制面在 3700 同源托管。
    # dist 不存在时静默跳过（pytest / 纯 API 模式），不阻塞控制面启动。
    mount_web_console(app)

    def _resolve_request_id(request: Request) -> str:
        """One request id per request: minted by the outer middleware below.

        Exception handlers must reuse it (scope state is shared) so the
        X-Request-Id header and the JSON body never disagree (W6 ticket 07).
        """
        return getattr(request.state, "request_id", "") or uuid.uuid4().hex

    @app.exception_handler(AppError)
    async def _app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        request_id = _resolve_request_id(request)
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.to_payload(request_id),
            headers={"X-Request-Id": request_id},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        request_id = _resolve_request_id(request)
        error = AppError(
            ErrorCode.VALIDATION_ERROR,
            "request validation failed",
            details={"errors": exc.errors()[:10]},
            status_code=422,
        )
        return JSONResponse(
            status_code=422,
            content=error.to_payload(request_id),
            headers={"X-Request-Id": request_id},
        )

    @app.exception_handler(Exception)
    async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        """Last-resort 500: uncaught bugs still answer the unified JSON shape.

        Plain-text 500s were the W6 recon root pain (500s.md B1: no code, no
        request id, no content type). The body pins exactly the three contract
        fields -- internals stay out of the payload; the traceback still reaches
        uvicorn's log because ServerErrorMiddleware re-raises after the response.
        """
        request_id = _resolve_request_id(request)
        return JSONResponse(
            status_code=500,
            content={
                "code": ErrorCode.INTERNAL_ERROR.value,
                "message": "internal server error",
                "request_id": request_id,
            },
            headers={"X-Request-Id": request_id},
        )

    @app.middleware("http")
    async def _request_id_middleware(request: Request, call_next):
        request_id = request.headers.get("X-Request-Id", uuid.uuid4().hex)
        # scope state is shared with the exception handlers: header and body
        # carry the SAME id.
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response

    return app
