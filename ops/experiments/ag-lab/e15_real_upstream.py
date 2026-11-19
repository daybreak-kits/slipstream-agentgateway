"""E15: re-verify AG 1.7 in-request retry / failover against REAL upstreams.

Mock (E14) showed: LLM requests never switch targets in-request (48 req, 0 switch);
route-layer retry only hits plain-HTTP routes, never the LLM listener; request_logs
1 row per client request with empty trace_id. User rejected the mock conclusion and
asked for the same scenarios against real upstreams.

Scenario matrix (each isolated AG run against lab ports 3692/3921-3923, real upstreams):
  S1 bad-key primary (real 401) -> healthy real backup; 5 chat reqs.
  S2 fabricated model primary (real 404) -> healthy backup; 5 chat reqs.
  S3 mid-stream kill proxy primary -> direct real backup; 5 stream reqs.
     (expect: client sees broken SSE, NOT a switch to backup)
  S4 two healthy upstreams weighted 3:1 -> 20 reqs distribution.
  S5 in-request retry recheck: S1/S2 config + route/backend retry; see if real 401/404
     trigger in-request retry (E14: route retry only on plain HTTP, not LLM listener).

Credentials come only from .env.e15 (gitignored). Keys never enter any evidence file,
config, unit test or process log; evidence masks them as sk-***masked***.
OpenRouter is only used with :free models.

Run:  python e15_real_upstream.py
"""
from __future__ import annotations

import json
import os
import socket
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import lab as L

LAB = Path(__file__).resolve().parent
EVID = LAB / "evidence"
ENV_FILE = LAB / ".env.e15"
KEYDIR = LAB / ".e15-tmp"          # gitignored (*.key under repo); sibling of bin-e14
PORT = 3692
BIN_SHA = "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c"
BINARY_META = {
    "binary": str(L.AG),
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": BIN_SHA,
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe",
}
CLIENT_KEY = L.KEY            # sk-ss-lab-client-0001 (lab gateway key, not a real secret)
CHAT_MODEL = "sensenova-6.8-flash-lite"     # cheap/fast SenseNova text model
NV_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"   # fast NVIDIA text model
OR_FREE = "nvidia/nemotron-3.5-lightning:free"       # OpenRouter :free (only allowed)

UPSTREAMS: dict = {}
KEY_FILES: dict = {}          # logical name -> key file path (created at runtime)


def _load_env() -> None:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        UPSTREAMS[k.strip()] = v.strip()
    # expected names
    for required in ("SENSENOVA_BASE_URL", "SENSENOVA_API_KEY",
                     "NVIDIA_BASE_URL", "NVIDIA_API_KEY",
                     "OPENROUTER_BASE_URL", "OPENROUTER_API_KEY"):
        if required not in UPSTREAMS:
            raise RuntimeError(f".env.e15 missing {required}")


def _mask(secret: str) -> str:
    return "sk-***masked***" if secret else ""


def _write_key_files() -> None:
    """Write each real key to a gitignored .key file (sibling of bin-e14)."""
    KEYDIR.mkdir(exist_ok=True)
    mapping = {
        "sensenova": UPSTREAMS["SENSENOVA_API_KEY"],
        "nvidia": UPSTREAMS["NVIDIA_API_KEY"],
        "openrouter": UPSTREAMS["OPENROUTER_API_KEY"],
        "badkey": "sk-e15-invalid-key-0000",          # deliberate wrong key (S1)
    }
    for name, secret in mapping.items():
        path = KEYDIR / f"e15-{name}.key"
        path.write_text(secret, encoding="utf-8")
        KEY_FILES[name] = str(path.resolve())


def _cleanup_key_files() -> None:
    for p in list(KEY_FILES.values()):
        try:
            os.unlink(p)
        except OSError:
            pass


def _base() -> dict:
    cfg = L.base_cfg()
    # Pin session.key so AG does NOT rewrite run-config.yaml to YAML mid-run (that
    # rewrite + file-watch reload was observed to break model resolution -> spurious 404).
    cfg["config"]["session"] = {"key": "3a5dde678b895d76e244397deac58c4eac0199d751ee0c168e4ef022d62e9c2e"}
    # point the llm block at the real upstreams only; we build providers/models/vms per scenario
    cfg["llm"]["providers"] = []
    cfg["llm"]["models"] = []
    cfg["llm"]["virtualModels"] = []
    cfg["llm"]["policies"] = {"apiKey": {"mode": "strict", "keys": [
        {"key": CLIENT_KEY, "metadata": {"name": "lab-client"}}]}}
    cfg["frontendPolicies"] = {"accessLog": {"database": {"llm": "full"}}}
    return cfg


def _provider(name: str, base_url: str, key_file: str) -> dict:
    # NOTE: env base URLs already include the /v1 version segment; do NOT append it.
    return {"name": name, "provider": "openAI",
            "params": {"baseUrl": base_url.rstrip("/"),
                       "apiKey": {"file": key_file}}}


def _model(name: str, provider_name: str, upstream_model: str) -> dict:
    return {"name": name, "visibility": "internal",
            "provider": {"reference": provider_name},
            "params": {"model": upstream_model}}


def _vm(name: str, targets: list[dict]) -> dict:
    return {"name": name, "routing": {"failover": {"targets": targets}}}


# ---------------------------------------------------------------- HTTP helpers
def post_chat(model: str, timeout: float = 90.0, stream: bool = False) -> dict:
    payload = {"model": model, "messages": [{"role": "user", "content": "hi"}],
               "max_tokens": 24}
    if stream:
        payload["stream"] = True
    hdrs = {"Content-Type": "application/json",
            "Authorization": f"Bearer {CLIENT_KEY}"}
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions",
                                 data=json.dumps(payload).encode(), headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"status": resp.status, "body": resp.read().decode("utf-8", "replace")}
    except urllib.error.HTTPError as exc:
        return {"status": exc.code, "body": exc.read().decode("utf-8", "replace")}
    except Exception as exc:  # noqa: BLE001
        return {"status": None, "error": repr(exc)[:300]}


def stream_chat(model: str, timeout: float = 90.0) -> dict:
    """Stream a chat completion, report whether the SSE completed or was truncated."""
    payload = {"model": model, "messages": [{"role": "user", "content": "count to five"}],
               "stream": True, "max_tokens": 32}
    hdrs = {"Content-Type": "application/json", "Authorization": f"Bearer {CLIENT_KEY}"}
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions",
                                 data=json.dumps(payload).encode(), headers=hdrs)
    started = time.time()
    chunks = 0
    first = None
    done = False
    err = None
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            while True:
                line = resp.readline()
                if not line:
                    break
                if line.startswith(b"data:"):
                    data = line[5:].strip()
                    if data == b"[DONE]":
                        done = True
                        break
                    chunks += 1
                    if first is None:
                        first = time.time() - started
    except Exception as exc:  # noqa: BLE001
        err = repr(exc)[:300]
    return {"chunks": chunks, "first_token_s": round(first, 3) if first else None,
            "done": done, "duration_s": round(time.time() - started, 3), "error": err}


# ---------------------------------------------------------------- mid-stream kill proxy
class KillProxy:
    """Plaintext-HTTP-in / HTTPS-out forwarding proxy that kills the client
    connection ~`delay_s` after the first upstream response chunk.

    AG talks plain HTTP to this proxy (baseUrl http://127.0.0.1:<port>); the proxy
    opens a TLS connection to the real upstream, forwards the request, streams the
    response headers + first chunk back, then breaks the connection. This simulates
    an upstream that dies mid-SSE.
    """

    def __init__(self, upstream_host: str, delay_s: float = 0.5, kills: int = 5):
        self.upstream_host = upstream_host
        self.delay_s = delay_s
        self.remaining = kills
        self.hits = 0
        self.lock = threading.Lock()
        self.srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.port = self.srv.getsockname()[1]
        self.srv.listen(8)
        self.stop_flag = threading.Event()
        self.thread = threading.Thread(target=self._accept_loop, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def _accept_loop(self) -> None:
        while not self.stop_flag.is_set():
            try:
                self.srv.settimeout(0.3)
                conn, _ = self.srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn: socket.socket) -> None:
        up = None
        with self.lock:
            self.hits += 1
        try:
            conn.settimeout(20)
            head = b""
            while b"\r\n\r\n" not in head and len(head) < 65536:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                head += chunk
            head, _, rest = head.partition(b"\r\n\r\n")
            headers = {}
            lines = head.split(b"\r\n")
            for line in lines[1:]:
                if b":" in line:
                    k, v = line.split(b":", 1)
                    headers[k.strip().lower()] = v.strip()
            body = rest
            n = int(headers.get(b"content-length", b"0") or b"0")
            while len(body) < n:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                body += chunk
            # open TLS to the real upstream and replay the request
            import ssl
            raw = socket.create_connection((self.upstream_host, 443), timeout=30)
            ctx = ssl.create_default_context()
            up = ctx.wrap_socket(raw, server_hostname=self.upstream_host)
            # rewrite Host so the real upstream accepts the request
            hdr_lines = []
            for line in lines[1:]:
                if line.lower().startswith(b"host:"):
                    hdr_lines.append(b"Host: " + self.upstream_host.encode())
                else:
                    hdr_lines.append(line)
            req = lines[0] + b"\r\n" + b"\r\n".join(hdr_lines) + b"\r\n\r\n" + body
            up.sendall(req)
            up.settimeout(30)
            # read response headers
            rhead = b""
            while b"\r\n\r\n" not in rhead:
                chunk = up.recv(4096)
                if not chunk:
                    return
                rhead += chunk
            rhead, _, rrest = rhead.partition(b"\r\n\r\n")
            rhdrs = {}
            for line in rhead.split(b"\r\n")[1:]:
                if b":" in line:
                    k, v = line.split(b":", 1)
                    rhdrs[k.strip().lower()] = v.strip()
            conn.sendall(rhead + b"\r\n\r\n")
            if b"content-length" in rhdrs:
                # fixed-length response: read exactly N bytes, then done
                n = int(rhdrs[b"content-length"] or b"0")
                data = rrest
                while len(data) < n:
                    chunk = up.recv(65536)
                    if not chunk:
                        break
                    data += chunk
                if data:
                    conn.sendall(data)
                return
            # streaming (SSE / chunked / close-delimited)
            first = rrest
            if not first:
                first = up.recv(65536)
            if first:
                conn.sendall(first)
            if self._should_kill():
                time.sleep(self.delay_s)   # client got headers + first chunk, then...
                return                     # ...connection dies (no [DONE], no end)
            # not killed: stream the rest
            chunked = b"chunked" in rhdrs.get(b"transfer-encoding", b"").lower()
            buf = first
            while True:
                chunk = up.recv(65536)
                if not chunk:
                    break
                conn.sendall(chunk)
                if chunked:
                    buf += chunk
                    if b"\r\n0\r\n\r\n" in buf or buf.endswith(b"0\r\n\r\n"):
                        break
        except OSError:
            pass
        finally:
            for s in (conn, up):
                try:
                    s.close()
                except OSError:
                    pass

    def _should_kill(self) -> bool:
        with self.lock:
            if self.remaining > 0:
                self.remaining -= 1
                return True
        return False

    def stop(self) -> None:
        self.stop_flag.set()
        try:
            self.srv.close()
        except OSError:
            pass


# ---------------------------------------------------------------- DB helpers
def db_dump() -> dict:
    cols = ("id, trace_id, span_id, http_status, error, gen_ai_operation_name, "
            "gen_ai_provider_name, gen_ai_request_model, gen_ai_response_model, "
            "input_tokens, output_tokens, duration_ms, agentgateway_user")
    con = sqlite3.connect(f"file:{L.DB}?mode=ro", uri=True)
    names = [d[0] for d in con.execute(f"select {cols} from request_logs limit 1").description]
    rows = [dict(zip(names, map(str, r)))
            for r in con.execute(f"select {cols} from request_logs order by started_at").fetchall()]
    con.close()
    return {"rows": rows, "row_count": len(rows)}


# ---------------------------------------------------------------- scenarios
def _run_chat_n(model: str, n: int, tag: str, cfg: dict) -> dict:
    log = L.start_ag(cfg, fresh_db=True, tag=tag)
    trials = []
    for i in range(n):
        resp = post_chat(model)
        trials.append({"n": i + 1, "status": resp.get("status"),
                       "body": (resp.get("body") or resp.get("error") or "")[:200]})
        time.sleep(1.0)
    time.sleep(1.5)
    logs = db_dump()
    tail = L.tail_log(log, 80)
    L.stop_ag()
    return {"trials": trials, "request_logs": logs, "ag_log_tail": tail,
            "config": cfg, "model": model}


def _guard_first_request(model: str, tag: str) -> None:
    """Abort early if AG returns its own model_not_found (config wiring / reload broke)
    instead of reaching a real upstream. Prevents wasting a full run on a 404 storm."""
    resp = post_chat(model)
    body = resp.get("body") or ""
    if resp.get("status") == 404 and "model_not_found" in body:
        raise RuntimeError(
            f"[{tag}] AG returned its own model_not_found (zero upstream hits); "
            "aborting before full run. Check provider/model wiring and run-config rewrite.")


def s1_bad_key() -> dict:
    cfg = _base()
    # primary = NVIDIA with a deliberately wrong key (reliable 401); backup = real SenseNova
    cfg["llm"]["providers"] = [
        _provider("e15-s1-primary", UPSTREAMS["NVIDIA_BASE_URL"], KEY_FILES["badkey"]),
        _provider("e15-s1-backup", UPSTREAMS["OPENROUTER_BASE_URL"], KEY_FILES["openrouter"]),
    ]
    cfg["llm"]["models"] = [
        _model("e15-s1-primary-model", "e15-s1-primary", NV_MODEL),
        _model("e15-s1-backup-model", "e15-s1-backup", OR_FREE),
    ]
    cfg["llm"]["virtualModels"] = [_vm("vm-e15-s1", [
        {"model": "e15-s1-primary-model", "priority": 1},
        {"model": "e15-s1-backup-model", "priority": 2}])]
    # guard: confirm AG routes to a real upstream (not its own model_not_found)
    _glog = L.start_ag(cfg, fresh_db=True, tag="e15-s1-guard")
    try:
        _guard_first_request("vm-e15-s1", "e15-s1")
    finally:
        L.stop_ag()
    return _run_chat_n("vm-e15-s1", 5, "e15-s1", cfg)


def s2_bad_model() -> dict:
    cfg = _base()
    cfg["llm"]["providers"] = [
        _provider("e15-s2-primary", UPSTREAMS["NVIDIA_BASE_URL"], KEY_FILES["nvidia"]),
        _provider("e15-s2-backup", UPSTREAMS["OPENROUTER_BASE_URL"], KEY_FILES["openrouter"]),
    ]
    cfg["llm"]["models"] = [
        _model("e15-s2-primary-model", "e15-s2-primary", "e15-fabricated-model-xyz"),
        _model("e15-s2-backup-model", "e15-s2-backup", OR_FREE),
    ]
    cfg["llm"]["virtualModels"] = [_vm("vm-e15-s2", [
        {"model": "e15-s2-primary-model", "priority": 1},
        {"model": "e15-s2-backup-model", "priority": 2}])]
    _glog = L.start_ag(cfg, fresh_db=True, tag="e15-s2-guard")
    try:
        _guard_first_request("vm-e15-s2", "e15-s2")
    finally:
        L.stop_ag()
    return _run_chat_n("vm-e15-s2", 5, "e15-s2", cfg)


def s3_stream_kill() -> dict:
    # proxy primary (kills after first byte) -> direct real backup
    up_host = "integrate.api.nvidia.com"
    cfg = _base()
    cfg["llm"]["providers"] = [
        _provider("e15-s3-proxy", "http://127.0.0.1:18443/v1", KEY_FILES["nvidia"]),
        _provider("e15-s3-direct", UPSTREAMS["OPENROUTER_BASE_URL"], KEY_FILES["openrouter"]),
    ]
    cfg["llm"]["models"] = [
        _model("e15-s3-proxy-model", "e15-s3-proxy", NV_MODEL),
        _model("e15-s3-direct-model", "e15-s3-direct", OR_FREE),
    ]
    cfg["llm"]["virtualModels"] = [_vm("vm-e15-s3", [
        {"model": "e15-s3-proxy-model", "priority": 1},
        {"model": "e15-s3-direct-model", "priority": 2}])]
    # Start AG WITHOUT the proxy first: p1 (dead proxy port) should fail and AG
    # should route to p2 (real senseNova) -> 200. This proves config wiring resolves.
    log = L.start_ag(cfg, fresh_db=True, tag="e15-s3")
    g = post_chat("vm-e15-s3")
    if g.get("status") == 404 and "model_not_found" in (g.get("body") or ""):
        L.stop_ag()
        raise RuntimeError("[e15-s3] AG returned its own model_not_found; aborting")
    L.stop_ag()
    # now start the kill proxy and re-run AG fresh for the real measurement
    proxy = KillProxy(up_host, delay_s=0.5, kills=5)
    proxy.start()
    time.sleep(0.2)
    cfg["llm"]["providers"][0] = _provider("e15-s3-proxy", f"http://127.0.0.1:{proxy.port}/v1", KEY_FILES["nvidia"])
    log = L.start_ag(cfg, fresh_db=True, tag="e15-s3")
    trials = []
    for i in range(5):
        res = stream_chat("vm-e15-s3")
        res["n"] = i + 1
        trials.append(res)
        time.sleep(0.2)
    time.sleep(1.5)
    logs = db_dump()
    tail = L.tail_log(log, 80)
    L.stop_ag()
    proxy.stop()
    # the proxy itself counts how many connections it killed
    killed = 5 - proxy.remaining
    return {"trials": trials, "proxy_kills": killed,
            "request_logs": logs, "ag_log_tail": tail,
            "config": cfg, "model": "vm-e15-s3"}


def s4_weighted() -> dict:
    # two healthy real upstreams, weighted 3:1
    cfg = _base()
    cfg["llm"]["providers"] = [
        _provider("e15-s4-openrouter", UPSTREAMS["OPENROUTER_BASE_URL"], KEY_FILES["openrouter"]),
        _provider("e15-s4-nvidia", UPSTREAMS["NVIDIA_BASE_URL"], KEY_FILES["nvidia"]),
    ]
    cfg["llm"]["models"] = [
        _model("e15-s4-openrouter-model", "e15-s4-openrouter", OR_FREE),
        _model("e15-s4-nvidia-model", "e15-s4-nvidia", NV_MODEL),
    ]
    cfg["llm"]["virtualModels"] = [{"name": "vm-e15-s4", "routing": {"weighted": {
        "targets": [{"model": "e15-s4-openrouter-model", "weight": 3},
                    {"model": "e15-s4-nvidia-model", "weight": 1}]}}}]
    # guard (separate run) so the 20 measured trials are clean
    _glog = L.start_ag(cfg, fresh_db=True, tag="e15-s4-guard")
    try:
        _guard_first_request("vm-e15-s4", "e15-s4")
    finally:
        L.stop_ag()
    log = L.start_ag(cfg, fresh_db=True, tag="e15-s4")
    trials = []
    for i in range(20):
        resp = post_chat("vm-e15-s4")
        trials.append({"n": i + 1, "status": resp.get("status"),
                       "model_used": _model_of(resp)})
        time.sleep(2.0)
    time.sleep(1.5)
    logs = db_dump()
    tail = L.tail_log(log, 80)
    L.stop_ag()
    # second independent batch of 20 for a less noisy distribution estimate
    log2 = L.start_ag(cfg, fresh_db=True, tag="e15-s4b")
    trials2 = []
    for i in range(20):
        resp = post_chat("vm-e15-s4")
        trials2.append({"n": i + 1, "status": resp.get("status"),
                        "model_used": _model_of(resp)})
        time.sleep(2.0)
    time.sleep(1.5)
    logs2 = db_dump()
    tail2 = L.tail_log(log2, 80)
    L.stop_ag()
    return {"trials": trials, "request_logs": logs, "ag_log_tail": tail,
            "trials_run2": trials2, "request_logs_run2": logs2, "ag_log_tail_run2": tail2,
            "config": cfg, "model": "vm-e15-s4"}


def _model_of(resp: dict) -> str | None:
    try:
        return json.loads(resp.get("body", "")).get("model")
    except Exception:  # noqa: BLE001
        return None


def s5_retry_recheck() -> dict:
    """S1/S2 config + route-layer retry on plain HTTP; see whether LLM traffic retries.

    The LLM primary is fronted by a counting proxy (kills=0) that forwards to the real
    NVIDIA and counts requests, so the number of upstream hits per client request is
    directly measurable (5 client requests -> 5 hits = no in-request retry; 15 = retry)."""
    proxy = KillProxy("integrate.api.nvidia.com", delay_s=0.0, kills=0)
    proxy.start()
    time.sleep(0.2)
    cfg = _base()
    cfg["llm"]["providers"] = [
        _provider("e15-s5-primary", f"http://127.0.0.1:{proxy.port}/v1", KEY_FILES["badkey"]),
        _provider("e15-s5-backup", UPSTREAMS["OPENROUTER_BASE_URL"], KEY_FILES["openrouter"]),
    ]
    cfg["llm"]["models"] = [
        _model("e15-s5-primary-model", "e15-s5-primary", NV_MODEL),
        _model("e15-s5-backup-model", "e15-s5-backup", OR_FREE),
    ]
    cfg["llm"]["virtualModels"] = [_vm("vm-e15-s5", [
        {"model": "e15-s5-primary-model", "priority": 1},
        {"model": "e15-s5-backup-model", "priority": 2}])]
    # route-layer retry on a plain HTTP gateway (E14 scenario B same shape)
    cfg["gateways"] = {"gw-lab": {"port": 3694, "bindAddress": "127.0.0.1"}}
    cfg["routes"] = [{"name": "retry-e15", "gateways": "gw-lab",
                      "matches": [{"path": {"pathPrefix": "/"}}],
                      "policies": {"retry": {"attempts": 2,
                                             "codes": [401, 404, 429, 500, 502, 503],
                                             "backoff": "100ms"}},
                      "backends": [{"host": "127.0.0.1:8099"}]}]
    # plain HTTP control on 3694 -> mock 8099 (which counts hits)
    L.ensure_mock()
    # guard in a separate run so the 5 measured LLM trials are not polluted
    _glog = L.start_ag(cfg, fresh_db=True, tag="e15-s5-guard")
    try:
        _guard_first_request("vm-e15-s5", "e15-s5")
    finally:
        L.stop_ag()
    proxy.hits = 0   # reset: count only the 5 measured client requests
    log = L.start_ag(cfg, fresh_db=True, tag="e15-s5")
    # 1) LLM traffic with 401 primary (does route retry reach LLM listener?)
    L.mock_reset()
    llm_trials = []
    for i in range(5):
        resp = post_chat("vm-e15-s5")
        llm_trials.append({"n": i + 1, "status": resp.get("status"),
                           "body": (resp.get("body") or resp.get("error") or "")[:200]})
        time.sleep(1.0)
    llm_upstream_hits = proxy.hits
    # 2) plain HTTP retry control
    plain = {}
    for code in (401, 404):
        L.mock_reset()
        req = urllib.request.Request("http://127.0.0.1:3694/plain/%d" % code,
                                     data=json.dumps({"ping": 1}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                pr = {"status": resp.status, "body": resp.read().decode("utf-8", "replace")}
        except urllib.error.HTTPError as exc:
            pr = {"status": exc.code, "body": exc.read().decode("utf-8", "replace")}
        except Exception as exc:  # noqa: BLE001
            pr = {"status": None, "error": repr(exc)[:200]}
        time.sleep(0.4)
        plain[str(code)] = {"client": pr, "counters": L.mock_stats()}
    time.sleep(1.5)
    logs = db_dump()
    tail = L.tail_log(log, 80)
    L.stop_ag()
    proxy.stop()
    return {"llm_trials": llm_trials, "llm_upstream_hits": llm_upstream_hits, "plain": plain,
            "request_logs": logs, "ag_log_tail": tail,
            "config": cfg, "model": "vm-e15-s5"}


# ---------------------------------------------------------------- masking / evidence
def _mask_obj(obj):
    """Recursively replace any string that contains a real secret with a masked token."""
    real = [UPSTREAMS.get("SENSENOVA_API_KEY", ""), UPSTREAMS.get("NVIDIA_API_KEY", ""),
            UPSTREAMS.get("OPENROUTER_API_KEY", "")]
    real = [r for r in real if r]
    if isinstance(obj, str):
        for r in real:
            if r and r in obj:
                obj = obj.replace(r, "sk-***masked***")
        # also mask any sk- token that is not our lab client key
        if "sk-" in obj and CLIENT_KEY not in obj:
            import re
            obj = re.sub(r"sk-[A-Za-z0-9\-_]{6,}", "sk-***masked***", obj)
        return obj
    if isinstance(obj, list):
        return [_mask_obj(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _mask_obj(v) for k, v in obj.items()}
    return obj


def _strip_keyfiles(cfg: dict) -> dict:
    """Replace {file: <keypath>} in the evidence copy with a pointer string."""
    if isinstance(cfg, dict):
        out = {}
        for k, v in cfg.items():
            if k == "apiKey" and isinstance(v, dict) and "file" in v:
                out[k] = {"file": "<key-file:see bin-e14 sibling temp dir, gitignored>"}
            else:
                out[k] = _strip_keyfiles(v)
        return out
    if isinstance(cfg, list):
        return [_strip_keyfiles(x) for x in cfg]
    return cfg


def _cfg_has_secret(cfg_text: str) -> bool:
    return any(r and r in cfg_text for r in
               (UPSTREAMS.get("SENSENOVA_API_KEY", ""),
                UPSTREAMS.get("NVIDIA_API_KEY", ""),
                UPSTREAMS.get("OPENROUTER_API_KEY", "")))


def _save(name: str, payload: dict) -> None:
    """Save evidence with masking + a hard guard against leaking real keys.

    Dumps the on-disk config to evidence/cfg-<name>.yaml (key file refs masked) and
    appends the AG run log to evidence/ag-<name>.log so the evidence is self-contained."""
    # dump the config the AG process actually used
    if isinstance(payload.get("config"), dict):
        cfg_path = EVID / f"cfg-{name}.yaml"
        cfg_copy = _strip_keyfiles(payload["config"])
        cfg_text = json.dumps(cfg_copy, indent=2, ensure_ascii=False)
        if _cfg_has_secret(cfg_text):
            raise RuntimeError("REFUSING to write cfg: real key would leak")
        cfg_path.write_text(cfg_text + "\n", encoding="utf-8")
        payload["config"] = {"evidence_file": str(cfg_path.name),
                             "note": "apiKey.file -> temp key file (gitignored); real key never written"}
    # append the AG run log (masked) next to the JSON
    tail = payload.get("ag_log_tail", "")
    if tail:
        log_path = EVID / f"ag-{name}.log"
        log_path.write_text(_mask_obj(tail) + "\n", encoding="utf-8")
    safe = _mask_obj(payload)
    text = json.dumps(safe, indent=2, ensure_ascii=False)
    if _cfg_has_secret(text):
        raise RuntimeError("REFUSING to write evidence: real key would leak")
    (EVID / f"{name}.json.md").write_text(text + "\n", encoding="utf-8")


# ---------------------------------------------------------------- main
def main() -> int:
    _load_env()
    _write_key_files()
    try:
        results = {}
        for name, fn in (("E15-S1-bad-key-primary", s1_bad_key),
                         ("E15-S2-fabricated-model", s2_bad_model),
                         ("E15-S3-stream-kill", s3_stream_kill),
                         ("E15-S4-weighted-3-1", s4_weighted),
                         ("E15-S5-retry-recheck", s5_retry_recheck)):
            r = fn()
            r["binary"] = BINARY_META
            _save(name, r)
            results[name] = r
            print(f"[{name}] done", flush=True)
    finally:
        L.stop_ag()
        _cleanup_key_files()
    summary = {
        "S1": {"trials": [t["status"] for t in results["E15-S1-bad-key-primary"]["trials"]],
               "log_rows": results["E15-S1-bad-key-primary"]["request_logs"]["row_count"]},
        "S2": {"trials": [t["status"] for t in results["E15-S2-fabricated-model"]["trials"]],
               "log_rows": results["E15-S2-fabricated-model"]["request_logs"]["row_count"]},
        "S3": {"trials": [{"chunks": t["chunks"], "done": t["done"], "error": t["error"]}
                          for t in results["E15-S3-stream-kill"]["trials"]],
               "proxy_kills": results["E15-S3-stream-kill"]["proxy_kills"],
               "log_rows": results["E15-S3-stream-kill"]["request_logs"]["row_count"]},
        "S4": {"trials": results["E15-S4-weighted-3-1"]["trials"],
               "log_rows": results["E15-S4-weighted-3-1"]["request_logs"]["row_count"]},
        "S5": {"llm_trials": [t["status"] for t in results["E15-S5-retry-recheck"]["llm_trials"]],
               "plain": results["E15-S5-retry-recheck"]["plain"],
               "log_rows": results["E15-S5-retry-recheck"]["request_logs"]["row_count"]},
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())