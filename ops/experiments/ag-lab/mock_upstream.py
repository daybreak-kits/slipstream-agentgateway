"""OpenAI-compatible mock upstream for the agentgateway isolation lab (port 8099)."""
from __future__ import annotations

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DEFAULT_USAGE = {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8}


def _usage_for(model: str | None) -> dict:
    """Usage varies by upstream model name so token-based limits can be probed."""
    if model and "usage-p100" in model:
        return {"prompt_tokens": 100, "completion_tokens": 0, "total_tokens": 100}
    if model and "usage-c100" in model:
        return {"prompt_tokens": 0, "completion_tokens": 100, "total_tokens": 100}
    return dict(DEFAULT_USAGE)
COUNTERS: dict[str, int] = {}
COUNTERS_LOCK = threading.Lock()
SEQ_COUNTS: dict[str, int] = {}
LOG_FILE: str | None = None


def _chat_body(model: str) -> dict:
    return {
        "id": "chatcmpl-mock",
        "object": "chat.completion",
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "ok"},
                "finish_reason": "stop",
            }
        ],
        "usage": _usage_for(model),
    }


def _log(record: dict) -> None:
    line = json.dumps(record, ensure_ascii=True)
    print(line, flush=True)
    if LOG_FILE:
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def _bump(path: str) -> int:
    with COUNTERS_LOCK:
        COUNTERS[path] = COUNTERS.get(path, 0) + 1
        return COUNTERS[path]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            parsed = json.loads(raw)
        except Exception:
            return {"_raw": raw[:400].decode("utf-8", "replace")}
        return parsed if isinstance(parsed, dict) else {"_raw": str(parsed)[:400]}

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.rstrip("/") == "/health":
            self._json(200, {"status": "ok"})
            return
        if parsed.path.rstrip("/") == "/stats":
            with COUNTERS_LOCK:
                self._json(200, {"counters": dict(COUNTERS)})
            return
        self._json(404, {"error": {"message": "not found"}})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path.rstrip("/") == "/reset":
            with COUNTERS_LOCK:
                COUNTERS.clear()
                SEQ_COUNTS.clear()
            self._json(200, {"reset": True})
            return
        body = self._read_body()
        # E14b: passthrough endpoints under any provider prefix return valid JSON.
        suffix = path.rstrip("/")
        if suffix.endswith("/embeddings") or suffix.endswith("/images/generations") \
                or suffix.endswith("/systemone"):
            prefix = "/" + path.strip("/").split("/")[0]
            count = _bump(prefix)
            _log({"ts": round(time.time(), 3), "kind": "passthrough", "prefix": prefix,
                  "path": path, "body_keys": sorted(body.keys()), "count": count})
            if suffix.endswith("/embeddings"):
                self._json(200, {"object": "list", "model": body.get("model"),
                                 "data": [{"object": "embedding", "index": 0,
                                           "embedding": [0.01, 0.02, 0.03]}],
                                 "usage": {"prompt_tokens": 1, "completion_tokens": 0,
                                           "total_tokens": 1}})
            elif suffix.endswith("/images/generations"):
                self._json(200, {"created": int(time.time()),
                                 "data": [{"url": "http://127.0.0.1:8099/mock-image.png"}]})
            else:
                self._json(200, {"service": "systemone", "ok": True, "echo": body})
            return
        # E14a scenario B: plain-proxy status-code control, /plain/<spec>.
        if path.startswith("/plain/"):
            spec = path[len("/plain/"):].strip("/")
            count = _bump(path)
            status = 200
            if spec.startswith("seq-"):
                parts = spec.split("-")
                with COUNTERS_LOCK:
                    SEQ_COUNTS[path] = SEQ_COUNTS.get(path, 0) + 1
                status = int(parts[1]) if SEQ_COUNTS[path] == 1 else int(parts[-1])
            elif spec.isdigit():
                status = int(spec)
            elif spec.startswith("slow-"):
                time.sleep(int(spec[5:]) / 1000.0)
            _log({"ts": round(time.time(), 3), "kind": "plain", "path": path,
                  "spec": spec, "count": count, "status": status})
            self._json(status, {"spec": spec, "hit": count, "status": status})
            return
        if not path.endswith("/chat/completions"):
            self._json(404, {"error": {"message": "not found"}})
            return
        prefix = "/" + path.strip("/").split("/")[0]
        count = _bump(prefix)
        headers = {k.lower(): v for k, v in self.headers.items() if k.lower().startswith("x-") or k.lower() == "authorization"}
        _log(
            {
                "ts": round(time.time(), 3),
                "prefix": prefix,
                "path": path,
                "model": body.get("model"),
                "stream": bool(body.get("stream")),
                "auth": (self.headers.get("Authorization") or "")[:32],
                "headers": headers,
                "messages": body.get("messages"),
                "max_tokens": body.get("max_tokens"),
                "count": count,
            }
        )
        # E14a scenario A: model-name driven status code / stall control.
        model_name = str(body.get("model") or "")
        if model_name.startswith("code-timeout-"):
            secs = float(model_name[len("code-timeout-"):])
            time.sleep(secs)
            try:
                self._json(200, _chat_body(model_name))
            except OSError:
                pass
            return
        if model_name.startswith("code-") and model_name[5:].isdigit():
            code = int(model_name[5:])
            self._json(code, {"error": {"message": f"mock upstream {code}",
                                        "type": "mock_error", "code": code}})
            return
        if prefix == "/fail":
            self._json(500, {"error": {"message": "mock upstream 500", "type": "mock_error"}})
            return
        if prefix == "/slow":
            self._stream(query, body.get("model") or "slow-model")
            return
        self._json(
            200,
            {
                "id": "chatcmpl-mock",
                "object": "chat.completion",
                "model": body.get("model") or "mock-model",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "ok"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": _usage_for(body.get("model")),
            },
        )

    def _stream(self, query: dict, model: str) -> None:
        chunks = int(query.get("chunks", ["40"])[0])
        delay_ms = int(query.get("delay_ms", ["200"])[0])
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            for index in range(chunks):
                payload = {
                    "id": "chatcmpl-slow",
                    "object": "chat.completion.chunk",
                    "model": model,
                    "choices": [
                        {"index": 0, "delta": {"content": f"c{index}"}, "finish_reason": None}
                    ],
                }
                self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode())
                self.wfile.flush()
                time.sleep(delay_ms / 1000.0)
            final = {
                "id": "chatcmpl-slow",
                "object": "chat.completion.chunk",
                "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                "usage": _usage_for(model),
            }
            self.wfile.write(f"data: {json.dumps(final)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            return


def main() -> int:
    global LOG_FILE
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8099)
    parser.add_argument("--log-file", default=None)
    args = parser.parse_args()
    LOG_FILE = args.log_file
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    print(f"mock upstream on 127.0.0.1:{args.port}", flush=True)
    server.serve_forever(poll_interval=0.01)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
