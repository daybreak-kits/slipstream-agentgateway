"""Resident OTLP/HTTP trace receiver (M5-a).

AG 1.7 exports spans only while ``frontendPolicies.tracing`` is enabled, posting
protobuf batches to ``POST /v1/traces``. The control plane runs this small ASGI
app on its own port (default 127.0.0.1:4318) so the exporter can deliver spans
without going through the admin session/cookie gate.

Lifecycle is deliberately forgiving: ``server.py`` wires ``TraceReceiver`` on
the control-plane lifespan, and a bind failure is a warning plus a degraded
feature (no routing chain), never a crash of the control plane. Spans are
best-effort telemetry; losing them is acceptable.
"""

from __future__ import annotations

import logging
import socket
import threading
import time

import uvicorn
from fastapi import FastAPI, Request, Response
from sqlalchemy.orm import sessionmaker

from l01_core.settings import Settings
from l03_adapters.agentgateway.otel import OtlpDecodeError, decode_trace_export
from l05_service.traces import ingest_spans

logger = logging.getLogger("slipstream.traces")

#: One OTLP export is expected to carry >= 4 spans (1 server + 1 client per
#: upstream attempt); 8 MB is a hard guard against a hostile/runaway body.
MAX_OTLP_BODY_BYTES = 8 * 1024 * 1024
_START_TIMEOUT_S = 3.0


class _BodyTooLarge(Exception):
    pass


async def _read_limited(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared:
        try:
            if int(declared) > limit:
                raise _BodyTooLarge
        except ValueError:
            pass
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise _BodyTooLarge
    return bytes(body)


def create_trace_receiver_app(session_factory: sessionmaker) -> FastAPI:
    """The standalone OTLP export app; no console auth or middleware."""
    app = FastAPI(
        title="slipstream-otlp-receiver",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.session_factory = session_factory

    @app.post("/v1/traces")
    async def receive_traces(request: Request) -> Response:
        content_type = (
            request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        )
        if content_type == "application/json":
            # OTLP/JSON is a different wire format; AG sends protobuf (E19).
            return Response(status_code=415, content=b"OTLP/JSON is not supported")
        try:
            body = await _read_limited(request, MAX_OTLP_BODY_BYTES)
        except _BodyTooLarge:
            return Response(status_code=413, content=b"OTLP request body too large")
        try:
            spans = decode_trace_export(body)
        except OtlpDecodeError as exc:
            logger.warning("丢弃非法 OTLP traces 请求：%s", exc)
            return Response(status_code=400, content=b"invalid OTLP trace payload")
        try:
            with session_factory() as session:
                added = ingest_spans(session, spans)
                session.commit()
        except Exception:
            logger.exception("OTLP span 入库失败（本次导出丢弃，接收器继续服务）")
            return Response(status_code=500, content=b"trace ingestion failed")
        logger.debug("OTLP traces 接收：decoded=%d stored=%d", len(spans), added)
        return Response(status_code=200, media_type="application/x-protobuf", content=b"")

    return app


def _port_available(host: str, port: int) -> bool:
    """Best-effort preflight so a busy port degrades with a clear warning."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((host, int(port)))
        return True
    except OSError:
        return False


class TraceReceiver:
    """Runs the OTLP ASGI app in a daemon thread; start/stop are failure-safe."""

    def __init__(
        self,
        session_factory: sessionmaker,
        host: str = "127.0.0.1",
        port: int = 4318,
    ) -> None:
        self.app = create_trace_receiver_app(session_factory)
        self.host = host
        self.port = int(port)
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> bool:
        """Start listening; returns False (warning only) when binding/startup fails."""
        if self.running:
            return True
        if not _port_available(self.host, self.port):
            logger.warning(
                "OTLP 接收器 %s:%d 绑定失败（端口被占用？），链路追踪降级："
                "控制面继续运行，span 不会被采集",
                self.host,
                self.port,
            )
            return False
        config = uvicorn.Config(
            self.app,
            host=self.host,
            port=self.port,
            log_level="warning",
            log_config=None,
            access_log=False,
        )
        server = uvicorn.Server(config)
        self._server = server
        thread = threading.Thread(
            target=self._serve, name="slipstream-otlp", daemon=True
        )
        self._thread = thread
        thread.start()
        deadline = time.monotonic() + _START_TIMEOUT_S
        while time.monotonic() < deadline and thread.is_alive():
            if server.started:
                logger.info("OTLP 接收器已启动：http://%s:%d/v1/traces", self.host, self.port)
                return True
            time.sleep(0.01)
        logger.warning(
            "OTLP 接收器 %s:%d 未能启动，链路追踪降级：控制面继续运行",
            self.host,
            self.port,
        )
        self.stop()
        return False

    def _serve(self) -> None:
        server = self._server
        if server is None:  # pragma: no cover - start() always sets it first
            return
        try:
            server.run()
        except BaseException:  # noqa: BLE001 - a receiver failure must never crash the app
            logger.warning("OTLP 接收器线程退出（链路追踪降级）", exc_info=True)

    def stop(self) -> None:
        server = self._server
        thread = self._thread
        if server is not None:
            server.should_exit = True
        if thread is not None and thread.is_alive():
            thread.join(timeout=5.0)
            if thread.is_alive():  # pragma: no cover - uvicorn normally exits fast
                logger.warning("OTLP 接收器停止超时，线程保持 daemon 状态")
        self._server = None
        self._thread = None


def wire_trace_receiver(app, session_factory: sessionmaker, settings: Settings) -> TraceReceiver:
    """Attach the receiver to the control-plane lifespan; returns it for tests."""
    receiver = TraceReceiver(
        session_factory,
        host=settings.trace_otlp_host,
        port=settings.trace_otlp_port,
    )
    app.state.trace_receiver = receiver
    app.router.add_event_handler("startup", receiver.start)
    app.router.add_event_handler("shutdown", receiver.stop)
    return receiver


__all__ = [
    "MAX_OTLP_BODY_BYTES",
    "TraceReceiver",
    "create_trace_receiver_app",
    "wire_trace_receiver",
]
