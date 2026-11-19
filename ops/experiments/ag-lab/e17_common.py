"""E17 shared harness: AG 1.7 FULL FORM (gateways/routes/backends[].ai) lab.

Answers the three E16 leftovers:
  T1  real-upstream auth through backends[].ai.groups[].providers[].policies.backendAuth
      (schema has NO provider-level auth; backendAuth = {key: FileOrInline} for a bare
      Bearer key, or {credentials:[{location:{header:{name,prefix}}, key}]}).
  T2  streaming + route retry interaction (mock upstreams) + token/ttft accounting.
  T3  real upstream + retry group failover chain.

Conventions
  * Never print/write a real key. Keys live in .e17-tmp/<harness>/keys/*.key (gitignored);
    evidence save replaces {file: <path>} with {file: <gitignored-key-file>} and masks
    any residual key string (save refuses to write if a secret is still present).
  * Each harness owns a workdir (.e17-tmp/<name>/), its own data.db, run-config.yaml,
    gateway port and admin ports, so multiple harnesses can run in parallel.
  * AG binary: ops/experiments/ag-lab/bin-e14/agentgateway.exe (v1.7.0, sha256 ...ed3c).
  * hostOverride MUST be "host:port"; plain HTTP is dialled unless policies.backendTLS
    is set, and then TLS is used with backendTLS.hostname as SNI/verify name.
  * pathPrefix is prepended in front of the provider path: /v1/chat/completions becomes
    <pathPrefix>/v1/chat/completions (the provider format may strip /v1 for some
    upstreams; mock logs show both /ok/v1/... and /ok/...).
"""
from __future__ import annotations

import json
import os
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

LAB = Path(__file__).resolve().parent
EVID = LAB / "evidence"
ENV_FILE = LAB / ".env.e15"
TMPROOT = LAB / ".e17-tmp"
AG = LAB / "bin-e14" / "agentgateway.exe"
BIN_SHA = "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c"
BINARY_META = {
    "binary": str(AG),
    "version": "v1.7.0 (upstream --version prints true)",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": BIN_SHA,
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe",
}
CLIENT_KEY = "sk-ss-lab-client-0001"
SESSION_KEY = "3a5dde678b895d76e244397deac58c4eac0199d751ee0c168e4ef022d62e9c2e"

ENV: dict = {}
REAL_KEYS: list = []


def load_env() -> dict:
    global ENV, REAL_KEYS
    ENV = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            ENV[k.strip()] = v.strip()
    for required in ("NVIDIA_BASE_URL", "NVIDIA_API_KEY",
                     "OPENROUTER_BASE_URL", "OPENROUTER_API_KEY"):
        if required not in ENV:
            raise RuntimeError(".env.e15 missing " + required)
    REAL_KEYS = [ENV[k] for k in ("NVIDIA_API_KEY", "OPENROUTER_API_KEY",
                                  "SENSENOVA_API_KEY") if ENV.get(k)]
    return ENV


def mask_text(text: str) -> str:
    for key in REAL_KEYS:
        if key and key in text:
            text = text.replace(key, "sk-***masked***")
    return text


def mask_obj(obj):
    if isinstance(obj, str):
        return mask_text(obj)
    if isinstance(obj, list):
        return [mask_obj(x) for x in obj]
    if isinstance(obj, dict):
        return {mask_text(str(k)): mask_obj(v) for k, v in obj.items()}
    return obj


def has_secret(obj) -> bool:
    return mask_text(json.dumps(obj, ensure_ascii=False)) != json.dumps(obj, ensure_ascii=False)


def write_key(workdir, name: str, value: str) -> str:
    kdir = Path(workdir) / "keys"
    kdir.mkdir(parents=True, exist_ok=True)
    path = (kdir / (name + ".key")).resolve()
    path.write_text(value, encoding="utf-8")
    return str(path)


def cleanup_keys(workdir) -> None:
    kdir = Path(workdir) / "keys"
    if kdir.exists():
        for p in kdir.glob("*.key"):
            p.unlink(missing_ok=True)


def wait_port(port: int, timeout: float = 20.0, host: str = "127.0.0.1") -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.3)
            if sock.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.15)
    return False


# ------------------------------------------------------------------ config builders
def base_cfg(h) -> dict:
    return {
        "config": {
            "adminAddr": "127.0.0.1:" + str(h.admin_port),
            "statsAddr": "127.0.0.1:" + str(h.stats_port),
            "readinessAddr": "127.0.0.1:" + str(h.ready_port),
            "database": {"url": "sqlite://data.db"},
            "storage": {"mode": "file"},
            "session": {"key": SESSION_KEY},
        },
        "gateways": {h.gw: {"port": h.port, "bindAddress": "127.0.0.1"}},
        "routes": [],
        "frontendPolicies": {"accessLog": {"database": {"llm": "full"}}},
    }


def ai_route(h, groups, route_name=None, retry=None, health=None,
             backend_policies=None) -> dict:
    name = route_name or ("ai-" + h.name)
    backend = {"ai": {"groups": [{"providers": list(g)} for g in groups]}}
    pol = dict(backend_policies or {})
    if health:
        pol["health"] = health
    if pol:
        backend["policies"] = pol
    route = {"name": name, "gateways": h.gw,
             "matches": [{"path": {"pathPrefix": "/v1/chat/completions"}}],
             "backends": [backend]}
    if retry:
        route["policies"] = {"retry": retry}
    return route


def full_form_config(h, groups, retry=None, health=None, backend_policies=None) -> dict:
    cfg = base_cfg(h)
    cfg["routes"] = [ai_route(h, groups, retry=retry, health=health,
                              backend_policies=backend_policies)]
    return cfg


def prov(name, host, model, key_file=None, path_prefix=None, tls_hostname=None,
         auth="bare", extra_policies=None) -> dict:
    p = {"name": name, "hostOverride": host, "provider": {"openAI": {"model": model}}}
    if path_prefix is not None:
        p["pathPrefix"] = path_prefix
    policies = dict(extra_policies or {})
    if auth == "bare":
        policies["backendAuth"] = {"key": {"file": key_file}}
    elif auth == "cred":
        policies["backendAuth"] = {"credentials": [{
            "location": {"header": {"name": "Authorization"}},
            "key": {"file": key_file}}]}
    elif auth == "cred_bearer":
        policies["backendAuth"] = {"credentials": [{
            "location": {"header": {"name": "Authorization", "prefix": "Bearer "}},
            "key": {"file": key_file}}]}
    elif auth is not None:
        raise ValueError("bad auth shape " + str(auth))
    if tls_hostname:
        policies["backendTLS"] = {"hostname": tls_hostname}
    if policies:
        p["policies"] = policies
    return p


def retry_policy(codes, attempts=2, backoff="100ms", precondition=None,
                 condition=None) -> dict:
    pol = {"attempts": attempts, "codes": list(codes), "backoff": backoff}
    if precondition is not None:
        pol["precondition"] = precondition
    if condition is not None:
        pol["condition"] = condition
    return pol


def health_policy(expression="response.code >= 400", consecutive_failures=1) -> dict:
    return {"unhealthyExpression": expression,
            "eviction": {"consecutiveFailures": consecutive_failures}}


# ------------------------------------------------------------------ harness
class Harness:
    # evidence naming knobs; experiment-specific harnesses override these only
    tmp_root = TMPROOT
    log_prefix = "ag-E17-"
    evid_prefix = "E17-"
    cfg_prefix = "cfg-E17-"

    def __init__(self, name, tag, port=3692, admin=(3921, 3922, 3923), gw=None):
        self.name = name
        self.tag = tag
        self.port = port
        self.admin_port, self.stats_port, self.ready_port = admin
        self.gw = gw or ("gw-" + name)
        self.workdir = self.tmp_root / name
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.run_cfg = self.workdir / "run-config.yaml"
        self.proc = None
        self.log = None

    def write_cfg(self, cfg) -> Path:
        self.run_cfg.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        return self.run_cfg

    def validate(self, cfg, tag) -> dict:
        scratch = self.workdir / ("validate-" + tag + ".yaml")
        scratch.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        proc = subprocess.run([str(AG), "--validate-only", "-f", str(scratch)],
                              cwd=str(self.workdir), capture_output=True, text=True,
                              timeout=120)
        return {"exit": proc.returncode, "stdout": mask_text(proc.stdout.strip()),
                "stderr": mask_text(proc.stderr.strip())}

    def start(self, cfg, tag) -> Path:
        self.stop()
        for f in self.workdir.glob("data.db*"):
            f.unlink(missing_ok=True)
        self.write_cfg(cfg)
        self.log = EVID / (self.log_prefix + tag + ".log")
        self.log.write_text("", encoding="utf-8")
        self.proc = subprocess.Popen([str(AG), "-f", str(self.run_cfg)],
                                     cwd=str(self.workdir),
                                     stdout=open(self.log, "ab"), stderr=subprocess.STDOUT)
        if not wait_port(self.port):
            tail = self.log.read_text(errors="replace")[-2000:]
            self.stop()
            raise RuntimeError("AG did not start on " + str(self.port) + ": " + mask_text(tail))
        time.sleep(0.4)
        return self.log

    def stop(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except Exception:
                self.proc.kill()
        self.proc = None

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        self.stop()

    def url(self) -> str:
        return "http://127.0.0.1:" + str(self.port) + "/v1/chat/completions"

    def post(self, model="client-model", messages=None, extra=None,
             client_key=CLIENT_KEY, headers=None, timeout=90.0) -> dict:
        payload = {"model": model,
                   "messages": messages or [{"role": "user", "content": "hi"}],
                   "max_tokens": 32}
        if extra:
            payload.update(extra)
        hdrs = {"Content-Type": "application/json"}
        if client_key:
            hdrs["Authorization"] = "Bearer " + client_key
        if headers:
            hdrs.update(headers)
        req = urllib.request.Request(self.url(), data=json.dumps(payload).encode(),
                                     headers=hdrs)
        started = time.time()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return {"status": resp.status, "headers": dict(resp.headers),
                        "body": mask_text(resp.read().decode("utf-8", "replace"))[:1200],
                        "duration_s": round(time.time() - started, 3)}
        except urllib.error.HTTPError as exc:
            return {"status": exc.code, "headers": dict(exc.headers),
                    "body": mask_text(exc.read().decode("utf-8", "replace"))[:1200],
                    "duration_s": round(time.time() - started, 3)}
        except Exception as exc:
            return {"status": None, "error": mask_text(repr(exc))[:300],
                    "duration_s": round(time.time() - started, 3)}

    def stream(self, model="client-model", extra=None, client_key=CLIENT_KEY,
               headers=None, timeout=90.0) -> dict:
        payload = {"model": model,
                   "messages": [{"role": "user", "content": "count to five"}],
                   "stream": True, "max_tokens": 32}
        if extra:
            payload.update(extra)
        hdrs = {"Content-Type": "application/json"}
        if client_key:
            hdrs["Authorization"] = "Bearer " + client_key
        if headers:
            hdrs.update(headers)
        req = urllib.request.Request(self.url(), data=json.dumps(payload).encode(),
                                     headers=hdrs)
        started = time.time()
        first = None
        chunks = 0
        done = False
        err = None
        raw = []
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                while True:
                    line = resp.readline()
                    if not line:
                        break
                    text = line.decode("utf-8", "replace").rstrip("\r\n")
                    if text.startswith("data:"):
                        data = text[5:].strip()
                        if len(raw) < 4:
                            raw.append(mask_text(data)[:160])
                        if data == "[DONE]":
                            done = True
                            break
                        chunks += 1
                        if first is None:
                            first = time.time() - started
        except Exception as exc:
            err = mask_text(repr(exc))[:300]
        return {"chunks": chunks,
                "first_token_s": round(first, 3) if first is not None else None,
                "done": done, "duration_s": round(time.time() - started, 3),
                "error": err, "raw_sample": raw}

    def db_dump(self, limit=None) -> dict:
        path = self.workdir / "data.db"
        if not path.exists():
            return {"row_count": 0, "rows": [], "error": "no db"}
        con = sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True)
        cur = con.execute("select * from request_logs order by started_at")
        names = [d[0] for d in cur.description]
        rows = []
        for values in cur.fetchall():
            row = dict(zip(names, values))
            row["id"] = str(row.get("id") or "")[:8]
            row["trace_id"] = str(row.get("trace_id") or "")[:12]
            row["span_id"] = str(row.get("span_id") or "")[:12]
            for k in ("duration_ms", "time_to_first_token_ms", "time_per_output_token_ms"):
                if row.get(k) is not None:
                    row[k] = round(float(row[k]), 2)
            attrs = row.pop("attributes_json", None)
            if attrs:
                row["attributes_json"] = mask_text(str(attrs))[:400]
            rows.append(row)
        con.close()
        if limit:
            rows = rows[:limit]
        return {"row_count": len(rows), "rows": rows}

    def tail_log(self, lines=80) -> str:
        if not self.log or not Path(self.log).exists():
            return ""
        return "\n".join(Path(self.log).read_text(encoding="utf-8",
                                                  errors="replace").splitlines()[-lines:])

    def save(self, tag, payload) -> None:
        payload = dict(payload)
        payload["binary"] = BINARY_META
        cfg = payload.get("config")
        if isinstance(cfg, dict):
            safe_cfg = _strip_key_files(cfg)
            cfg_text = json.dumps(safe_cfg, indent=2, ensure_ascii=False)
            if has_secret(cfg_text):
                raise RuntimeError("REFUSING to write cfg: real key would leak")
            cfg_path = EVID / (self.cfg_prefix + tag + ".yaml")
            cfg_path.write_text(cfg_text + "\n", encoding="utf-8")
            payload["config"] = {"evidence_file": cfg_path.name,
                                 "note": "backendAuth key {file: ...} -> gitignored "
                                         ".e17-tmp key file; real key never written"}
        safe = mask_obj(payload)
        text = json.dumps(safe, indent=2, ensure_ascii=False, default=str)
        if has_secret(text):
            raise RuntimeError("REFUSING to write evidence: real key would leak")
        (EVID / (self.evid_prefix + tag + ".json.md")).write_text(text + "\n", encoding="utf-8")


def _strip_key_files(obj):
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k == "file" and isinstance(v, str) and v.endswith(".key"):
                out[k] = "<gitignored-key-file>"
            else:
                out[k] = _strip_key_files(v)
        return out
    if isinstance(obj, list):
        return [_strip_key_files(x) for x in obj]
    return obj


# ------------------------------------------------------------------ mock upstream
import base64
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class _ReuseServer:
    def __init__(self, handler_cls):
        from http.server import ThreadingHTTPServer
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self._thread = None

    def start(self):
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._thread.start()
        return self.port

    def stop(self):
        try:
            self.httpd.shutdown()
        except Exception:
            pass
        try:
            self.httpd.server_close()
        except Exception:
            pass


def _json_bytes(obj) -> bytes:
    return json.dumps(obj).encode()


def _sse_stream(handler, chunks=8, delay_ms=40, first_delay_ms=120,
                usage=(7, 8, 15), model="mock-stream") -> None:
    from http.server import BaseHTTPRequestHandler
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Connection", "close")
    handler.end_headers()
    time.sleep(first_delay_ms / 1000.0)
    base = {"id": "chatcmpl-mock", "object": "chat.completion.chunk",
            "created": 1700000000, "model": model}
    try:
        for i in range(chunks):
            delta = {"content": ("tok%d " % i)}
            ev = dict(base)
            ev["choices"] = [{"index": 0, "delta": delta, "finish_reason": None}]
            handler.wfile.write(("data: " + json.dumps(ev) + "\n\n").encode())
            handler.wfile.flush()
            if i < chunks - 1:
                time.sleep(delay_ms / 1000.0)
        final = dict(base)
        final["choices"] = [{"index": 0, "delta": {}, "finish_reason": "stop"}]
        if usage:
            final["usage"] = {"prompt_tokens": usage[0],
                              "completion_tokens": usage[1],
                              "total_tokens": usage[2]}
        handler.wfile.write(("data: " + json.dumps(final) + "\n\n").encode())
        handler.wfile.write(b"data: [DONE]\n\n")
        handler.wfile.flush()
    except (BrokenPipeError, ConnectionResetError):
        return


class MockServer:
    """Configurable mock upstream. behaviors: prefix -> one of
    fail500 | fail502 | ok | sse | sse_slow | echo. Longest prefix wins.
    Records every hit (path, headers, auth prefix) for the hit matrix."""

    def __init__(self, name, behaviors, log_path=None, ok_usage=(5, 3, 8)):
        self.name = name
        self.behaviors = dict(behaviors)
        self.ok_usage = ok_usage
        self.log_path = Path(log_path) if log_path else None
        self.hits = []
        self.lock = threading.Lock()
        self.httpd = None

    def start(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, fmt, *args):
                return

            def _handle(self):
                path = self.path
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                hit = {"ts": round(time.time(), 2), "method": self.command,
                       "path": path,
                       "auth": mask_text((self.headers.get("Authorization") or "")[:24]),
                       "headers": {k: mask_text(str(v))[:80] for k, v in
                                   self.headers.items()},
                       "body": mask_text(body.decode("utf-8", "replace"))[:300]}
                bhv = None
                for prefix in sorted(outer.behaviors, key=len, reverse=True):
                    if path.startswith(prefix):
                        bhv = outer.behaviors[prefix]
                        hit["prefix"] = prefix
                        break
                with outer.lock:
                    outer.hits.append(hit)
                if outer.log_path:
                    with open(outer.log_path, "a", encoding="utf-8") as fh:
                        fh.write(json.dumps(hit, ensure_ascii=False) + "\n")
                if path.rstrip("/").endswith("/reset"):
                    with outer.lock:
                        outer.hits = []
                    return self._json(200, {"reset": True})
                if path.rstrip("/").endswith("/stats"):
                    return self._json(200, outer.stats())
                if path.rstrip("/").endswith("/hits"):
                    return self._json(200, {"hits": outer.hits})
                if bhv == "fail500":
                    return self._json(500, {"error": {"message": "mock primary 500",
                                                      "type": "server_error"}})
                if bhv == "fail502":
                    return self._json(502, {"error": {"message": "mock primary 502"}})
                if bhv == "echo":
                    return self._json(200, {"echo": True, "path": path,
                                            "headers": hit["headers"], "model": "echo"})
                if bhv == "sse":
                    return _sse_stream(self, chunks=8, delay_ms=40,
                                       first_delay_ms=120, usage=outer.ok_usage)
                if bhv == "sse_slow":
                    return _sse_stream(self, chunks=40, delay_ms=200,
                                       first_delay_ms=150, usage=outer.ok_usage)
                return self._json(200, {
                    "id": "chatcmpl-mock", "object": "chat.completion",
                    "created": 1700000000, "model": "mock-ok",
                    "choices": [{"index": 0, "message": {"role": "assistant",
                                                         "content": "mock reply"},
                                 "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": outer.ok_usage[0],
                              "completion_tokens": outer.ok_usage[1],
                              "total_tokens": outer.ok_usage[2]}})

            def _json(self, code, obj):
                data = _json_bytes(obj)
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                self._handle()

            def do_GET(self):
                self._handle()

        self.httpd = _ReuseServer(Handler)
        self.port = self.httpd.start()
        return self

    def stop(self):
        if self.httpd:
            self.httpd.stop()
            self.httpd = None

    def stats(self):
        counts = {}
        with self.lock:
            for hit in self.hits:
                key = hit.get("prefix") or "other"
                counts[key] = counts.get(key, 0) + 1
            total = len(self.hits)
            auths = {}
            for hit in self.hits:
                a = hit.get("auth") or "(none)"
                auths[a] = auths.get(a, 0) + 1
        return {"name": self.name, "total": total, "counts": counts,
                "auth_shapes": auths}

    def reset(self):
        with self.lock:
            self.hits = []

    def host(self):
        return "127.0.0.1:" + str(self.port)


# ------------------------------------------------------------------ forwarding proxy
class Proxy:
    """TCP proxy 127.0.0.1:<port> -> target_host:target_port.
    kills=N > 0: abort the connection right after N response bytes were forwarded
    (simulates a mid-stream SSE upstream death). kills=0 = pure counting proxy.
    TLS-out when tls=True (ALPN http/1.1). Counts hits per request path."""

    def __init__(self, target_host, target_port, tls=False, kills=0,
                 kill_after_bytes=300, kill_delay=0.0, name="proxy"):
        self.target_host = target_host
        self.target_port = target_port
        self.tls = tls
        self.kills = kills
        self.kill_after_bytes = kill_after_bytes
        self.kill_delay = kill_delay
        self.name = name
        self.hits = []
        self.lock = threading.Lock()
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(32)
        self.port = self.sock.getsockname()[1]
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        try:
            self.sock.close()
        except Exception:
            pass

    def host(self):
        return "127.0.0.1:" + str(self.port)

    def stats(self):
        counts = {}
        with self.lock:
            for h in self.hits:
                counts[h["path"]] = counts.get(h["path"], 0) + 1
            total = len(self.hits)
        return {"name": self.name, "total": total, "counts": counts,
                "target": self.target_host + ":" + str(self.target_port),
                "tls": self.tls, "kills": self.kills}

    def reset(self):
        with self.lock:
            self.hits = []

    def _accept_loop(self):
        while not self._stop.is_set():
            try:
                client, _ = self.sock.accept()
            except Exception:
                return
            threading.Thread(target=self._handle_relay, args=(client,), daemon=True).start()

    def _handle(self, client):
        upstream = None
        try:
            client.settimeout(120)
            data = b""
            while b"\r\n\r\n" not in data:
                chunk = client.recv(4096)
                if not chunk:
                    return
                data += chunk
            head, _, rest = data.partition(b"\r\n\r\n")
            headers = {}
            for line in head.split(b"\r\n")[1:]:
                if b":" in line:
                    k, v = line.split(b":", 1)
                    headers[k.strip().lower()] = v.strip()
            length = int(headers.get(b"content-length", b"0") or b"0")
            body = rest
            while len(body) < length:
                chunk = client.recv(4096)
                if not chunk:
                    break
                body += chunk
            raw = head + b"\r\n\r\n" + body
            path = head.split(b"\r\n", 1)[0].decode("latin-1").split(" ")[1]
            with self.lock:
                self.hits.append({"path": path, "ts": round(time.time(), 2)})
            try:
                upstream = socket.create_connection((self.target_host,
                                                     self.target_port), timeout=60)
            except Exception as exc:
                with self.lock:
                    self.hits[-1]["error"] = repr(exc)[:120]
                return
            if self.tls:
                ctx = ssl.create_default_context()
                ctx.set_alpn_protocols(["http/1.1"])
                upstream = ctx.wrap_socket(upstream,
                                           server_hostname=self.target_host)
            # rewrite Host header toward the real target host
            out = raw
            if self.tls:
                parts = head.split(b"\r\n")
                nh = [parts[0]]
                for line in parts[1:]:
                    if line.lower().startswith(b"host:"):
                        nh.append(b"Host: " + self.target_host.encode())
                    else:
                        nh.append(line)
                out = b"\r\n".join(nh) + b"\r\n\r\n" + body
            upstream.sendall(out)
            forwarded = 0
            killed = False
            while True:
                try:
                    chunk = upstream.recv(2048)
                except Exception:
                    break
                if not chunk:
                    break
                try:
                    client.sendall(chunk)
                except Exception:
                    break
                forwarded += len(chunk)
                if self.kills and not killed and forwarded >= self.kill_after_bytes:
                    killed = True
                    if self.kill_delay:
                        time.sleep(self.kill_delay)
                    break
        except Exception:
            pass
        finally:
            for s in (client, upstream):
                if s is not None:
                    try:
                        s.close()
                    except Exception:
                        pass


# ---- full-duplex relay proxy (handles chunked request bodies + streaming) ----
# Appended after Proxy is defined: replaces the one-shot _handle used above.
def _proxy_relay(self, client):
    import select
    upstream = None
    try:
        client.settimeout(60)
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = client.recv(65536)
            if not chunk:
                return
            data += chunk
        head, _, rest = data.partition(b"\r\n\r\n")
        first = head.split(b"\r\n", 1)[0].decode("latin-1")
        try:
            path = first.split(" ")[1]
        except Exception:
            path = "/"
        with self.lock:
            self.hits.append({"path": path, "ts": round(time.time(), 2)})
        parts = head.split(b"\r\n")
        nh = [parts[0]]
        saw_host = False
        saw_conn = False
        for line in parts[1:]:
            low = line.lower()
            if self.tls and low.startswith(b"host:"):
                nh.append(b"Host: " + self.target_host.encode())
                saw_host = True
            elif low.startswith(b"connection:"):
                nh.append(b"Connection: close")
                saw_conn = True
            else:
                nh.append(line)
        if self.tls and not saw_host:
            nh.append(b"Host: " + self.target_host.encode())
        if not saw_conn:
            nh.append(b"Connection: close")
        nhead = b"\r\n".join(nh)
        try:
            upstream = socket.create_connection((self.target_host, self.target_port),
                                                timeout=60)
        except Exception as exc:
            with self.lock:
                self.hits[-1]["error"] = repr(exc)[:120]
            return
        if self.tls:
            ctx = ssl.create_default_context()
            ctx.set_alpn_protocols(["http/1.1"])
            upstream = ctx.wrap_socket(upstream, server_hostname=self.target_host)
        upstream.sendall(nhead + b"\r\n\r\n" + rest)
        forwarded = 0
        killed = False
        pair = [client, upstream]
        while pair and not killed:
            try:
                readable, _, _ = select.select(pair, [], [], 120)
            except Exception:
                break
            if not readable:
                break
            for sock in readable:
                try:
                    chunk = sock.recv(65536)
                except Exception:
                    chunk = b""
                if not chunk:
                    if sock is client:
                        pair = [s for s in pair if s is not client]
                        try:
                            upstream.shutdown(socket.SHUT_WR)
                        except Exception:
                            pass
                        continue
                    killed = True
                    break
                if sock is client:
                    try:
                        upstream.sendall(chunk)
                    except Exception:
                        pair = []
                        break
                else:
                    try:
                        client.sendall(chunk)
                    except Exception:
                        pair = []
                        break
                    forwarded += len(chunk)
                    if self.kills and forwarded >= self.kill_after_bytes:
                        killed = True
                        if self.kill_delay:
                            time.sleep(self.kill_delay)
                        break
    except Exception:
        pass
    finally:
        for s in (client, upstream):
            if s is not None:
                try:
                    s.close()
                except Exception:
                    pass


Proxy._handle_relay = _proxy_relay
