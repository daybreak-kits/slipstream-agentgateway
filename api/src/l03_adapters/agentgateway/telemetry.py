"""agentgateway telemetry intake (ADR-028, W5-W1.7).

AG 1.7 can only push per-attempt facts over OTLP/HTTP, so this module owns that
transport entirely: the resident receiver, the protobuf decode, and the mapping
to the control-plane RequestAttempt fact. The system never sees OTLP/trace/span
concepts; the composition root only injects an AttemptSink and starts this
adapter service on the app lifespan.

Export is enabled only while this receiver is running. The renderer asks
export_enabled() before adding frontendPolicies.tracing, so an API process that
does not host the receiver (e.g. a test or a worker) never points AG at a dead
endpoint. Host is fixed to loopback; AG only supports push, so a private local
listener is the minimum possible surface. The receiver accepts only the fixed
trace path, a protobuf content type and an 8 MB body.
"""

from __future__ import annotations

import logging
import os
import socket
import threading
import time
from collections.abc import Iterable, Sequence
from urllib.parse import urlsplit

import uvicorn
from fastapi import FastAPI, Request, Response

from l02_domain.models import AttemptSink, RequestAttempt
from l03_adapters.agentgateway.otel import DecodedSpan, OtlpDecodeError, decode_trace_export

logger = logging.getLogger("slipstream.agentgateway.telemetry")

#: The data plane may only push to this loopback endpoint; the control plane
#: does not expose a second LAN-visible service (user architecture decision).
TRACE_HOST = "127.0.0.1"
TRACE_PATH = "/v1/traces"
DEFAULT_TRACE_PORT = 4318
MAX_OTLP_BODY_BYTES = 8 * 1024 * 1024
_START_TIMEOUT_S = 3.0

_export_enabled = False
_export_lock = threading.Lock()
_path_map: tuple[tuple[str, str], ...] = ()
_path_lock = threading.Lock()


def trace_port() -> int:
    """Adapter-internal OTLP listener port; not a control-plane setting."""
    raw = os.environ.get("SLIPSTREAM_AG_TRACE_PORT", "")
    if not raw:
        return DEFAULT_TRACE_PORT
    try:
        port = int(raw)
    except ValueError:
        logger.warning("SLIPSTREAM_AG_TRACE_PORT 不是整数，回退到 %d", DEFAULT_TRACE_PORT)
        return DEFAULT_TRACE_PORT
    return port if 1 <= port <= 65535 else DEFAULT_TRACE_PORT


def export_enabled() -> bool:
    """True only while the adapter receiver is running in this process."""
    with _export_lock:
        return _export_enabled


def set_export_enabled(enabled: bool) -> None:
    """Lifecycle hook and test seam; renderer reads export_enabled()."""
    global _export_enabled
    with _export_lock:
        _export_enabled = bool(enabled)


def register_upstream_paths(entries: Iterable[tuple[str, str]]) -> None:
    """Remember rendered provider base URLs so a client span path maps to a provider.

    upstream_ref stored in request_attempts is the provider name (upstream id),
    which the console resolves to a display name. The adapter owns this mapping;
    the control plane never guesses from base_url prefixes.
    """
    items: list[tuple[str, str]] = []
    for ref, base_url in entries:
        path = urlsplit(base_url).path.rstrip("/")
        items.append((path or "/", ref))
    global _path_map
    with _path_lock:
        _path_map = tuple(items)


def resolve_upstream(http_path: str) -> str:
    """Longest rendered provider path prefix -> upstream ref, or empty on ambiguity."""
    normalized = (http_path or "").split("?", 1)[0]
    with _path_lock:
        candidates = tuple(_path_map)
    matches: list[tuple[int, str]] = []
    for prefix, ref in candidates:
        if prefix == "/" or normalized == prefix or normalized.startswith(prefix + "/"):
            matches.append((len(prefix), ref))
    if not matches:
        return ""
    matches.sort(key=lambda item: item[0], reverse=True)
    longest = matches[0][0]
    refs = {ref for length, ref in matches if length == longest}
    return refs.pop() if len(refs) == 1 else ""


def _root_model(root: DecodedSpan | None) -> str:
    if root is None:
        return ""
    for key in ("gen_ai.response.model", "gen_ai.request.model"):
        value = root.attributes.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _outcome(status_code: int | None) -> str:
    if status_code is None:
        return "unknown"
    return "ok" if 200 <= status_code < 400 else "error"


def decode_attempts(spans: Sequence[DecodedSpan]) -> tuple[RequestAttempt, ...]:
    """Map one AG span tree to normalized attempts (1 server root + N clients).

    AG 1.7 carries no explicit attempt ordinal (E19): client spans are sorted by
    start time, exactly matching the hit matrix. The root span carries the model
    and the request correlation id; client spans carry the per-attempt upstream
    path/status/error/duration. Everything else is intentionally dropped here.
    """
    roots: dict[str, DecodedSpan] = {}
    clients: dict[str, list[DecodedSpan]] = {}
    for span in spans:
        if not span.trace_id:
            continue
        if span.kind == "server":
            roots.setdefault(span.trace_id, span)
        elif span.kind == "client":
            clients.setdefault(span.trace_id, []).append(span)
    attempts: list[RequestAttempt] = []
    for trace_id, spans_for_trace in clients.items():
        root = roots.get(trace_id)
        model = _root_model(root)
        ordered = sorted(spans_for_trace, key=lambda span: (span.start_ms, span.span_id))
        for index, span in enumerate(ordered, start=1):
            status_code = span.http_status
            attempts.append(
                RequestAttempt(
                    correlation_key=trace_id,
                    attempt_no=index,
                    upstream_ref=resolve_upstream(span.http_path) or span.http_path,
                    model=model,
                    status_code=status_code,
                    error_type=span.error_type,
                    error_message="",
                    started_at_ms=span.start_ms,
                    duration_ms=span.duration_ms,
                    outcome=_outcome(status_code),
                    adapter_id="agentgateway",
                )
            )
    return tuple(attempts)


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


def create_telemetry_app(sink: AttemptSink) -> FastAPI:
    """The adapter-private OTLP app; no console auth or system middleware."""
    app = FastAPI(
        title="slipstream-agentgateway-telemetry",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.post(TRACE_PATH)
    async def receive_traces(request: Request) -> Response:
        content_type = (
            request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        )
        if content_type == "application/json":
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
        attempts = decode_attempts(spans)
        if not attempts:
            return Response(status_code=200, media_type="application/x-protobuf", content=b"")
        try:
            sink(attempts)
        except Exception:
            logger.exception("请求尝试入库失败（本次导出丢弃，接收器继续服务）")
            return Response(status_code=500, content=b"attempt ingestion failed")
        logger.debug("OTLP traces 接收：decoded=%d attempts=%d", len(spans), len(attempts))
        return Response(status_code=200, media_type="application/x-protobuf", content=b"")

    return app


def _port_available(host: str, port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((host, int(port)))
        return True
    except OSError:
        return False


class TelemetryReceiver:
    """Runs the adapter OTLP app in a daemon thread; start/stop are failure-safe."""

    def __init__(self, sink: AttemptSink, host: str = TRACE_HOST, port: int | None = None) -> None:
        self.app = create_telemetry_app(sink)
        self.host = host
        self.port = trace_port() if port is None else int(port)
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> bool:
        if self.running:
            return True
        if not _port_available(self.host, self.port):
            logger.warning(
                "agentgateway 遥测接收器 %s:%d 绑定失败（端口被占用？），请求尝试链降级：",
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
        thread = threading.Thread(target=self._serve, name="agentgateway-telemetry", daemon=True)
        self._thread = thread
        thread.start()
        deadline = time.monotonic() + _START_TIMEOUT_S
        while time.monotonic() < deadline and thread.is_alive():
            if server.started:
                logger.info(
                    "agentgateway 遥测接收器已启动：http://%s:%d%s",
                    self.host,
                    self.port,
                    TRACE_PATH,
                )
                return True
            time.sleep(0.01)
        logger.warning(
            "agentgateway 遥测接收器 %s:%d 未能启动，请求尝试链降级", self.host, self.port
        )
        self.stop()
        return False

    def _serve(self) -> None:
        server = self._server
        if server is None:
            return
        try:
            server.run()
        except BaseException:
            logger.warning("agentgateway 遥测接收器线程退出（尝试链降级）", exc_info=True)

    def stop(self) -> None:
        server = self._server
        thread = self._thread
        if server is not None:
            server.should_exit = True
        if thread is not None and thread.is_alive():
            thread.join(timeout=5.0)
            if thread.is_alive():
                logger.warning("agentgateway 遥测接收器停止超时，线程保持 daemon 状态")
        self._server = None
        self._thread = None


def wire_telemetry(app: FastAPI, sink: AttemptSink) -> TelemetryReceiver:
    """Attach the adapter telemetry lifecycle; returns it for tests."""
    receiver = TelemetryReceiver(sink)

    def _start() -> None:
        set_export_enabled(receiver.start())

    def _stop() -> None:
        set_export_enabled(False)
        receiver.stop()

    app.state.agentgateway_telemetry = receiver
    app.router.add_event_handler("startup", _start)
    app.router.add_event_handler("shutdown", _stop)
    return receiver


__all__ = [
    "DEFAULT_TRACE_PORT",
    "MAX_OTLP_BODY_BYTES",
    "TRACE_HOST",
    "TRACE_PATH",
    "TelemetryReceiver",
    "create_telemetry_app",
    "decode_attempts",
    "export_enabled",
    "register_upstream_paths",
    "resolve_upstream",
    "set_export_enabled",
    "trace_port",
    "wire_telemetry",
]
