"""E20 conditional-routing x multi-key expansion probe (D-wave leftover), on
the pinned AG 1.7.0 hybrid form (ADR-024: gateways + llm.gateways +
llm.providers/models/virtualModels + top-level policies[] retry), same binary
pin as E14-E19.

Background: ADR-026 key expansion renders one public-model target into N
same-priority chain entries, one per key ({model}#k{seq}). E18 pinned the
failover form. The D-wave leftover is the CONDITIONAL form: a target with a
`when` CEL predicate expands into N entries sharing the SAME predicate, and a
no-when (catch-all) target expands into a trailing no-when suffix. AG 1.7
schema says conditional targets are "evaluated in order. The first matching
condition selects the model" - what that means for duplicate predicates and
for the expanded catch-all suffix is untested.

Questions (task: conditional x multi-key runtime semantics):
  T1  --validate-only legality of the expanded shapes:
        T1-when2      same `when` x 2 #kN entries (core expansion shape)
        T1-mixed-kn2  faithful D-wave shape: [when#k1, when#k2, catchall#k1,
                      catchall#k2] (no-when entries = contiguous trailing suffix)
        T1-mixed-k1   single-key contrast: [when#k1, catchall#k1] (the
                      schema-documented "omit only on the final fallback" shape)
        T1-true-tail  control-plane workaround candidate: the same kn2 shape
                      but the catch-all tail rendered as `when: "true"`
        T1-neg-tail   no-when NOT trailing (control plane rejects; does AG?)
        T1-ctrl-single single when entry (conditional form sanity baseline)
  T2  runtime split: requests MATCHING the when, N=40 -> do the two same-when
        #kN entries share traffic (per-key auth attribution), or does
        first-match collapse to one entry?  + a faithful variant (both entries
        carry the same upstream model name, N=20).
  T3  runtime predicate jump: requests NOT matching the when (header present
        with another value / header absent) -> do they fall through to the
        no-when trailing entries (and then: does the catch-all suffix split
        between its #kN entries)?  If T1 rejected the mixed shape, the
        validate error text IS the conclusion (runtime skipped, mixed-k1
        contrast shape runs instead).
  T4  when + in-request failover: matching requests against a chain whose
        #k1 entry always 500s and #k2 entry always 200s (retry codes=[500]
        attempts=2 + health trio, E18 T3 caliber) -> does the request switch
        to the other same-when entry, or does first-match pin the failure?

Conventions (inherited from e18_multikey_probe.py; hybrid-form probes are
self-contained scripts, e17_common is the full-form harness):
  * AG binary ops/experiments/ag-lab/bin-e14/agentgateway.exe (v1.7.0,
    sha256 909b93dc...ed3c, same pin as E14-E19).
  * Lab-only ports 3698 (AG) / 3934-3936 (admin/stats/ready) / 8098 (mock
    upstream) - production 3691/1900x/3700 untouched.
  * NO real credentials: .env.e15 is never read here. All upstream keys are
    dummy lab values written to .e20-tmp/keys/*.key (gitignored); evidence
    save replaces {file: ...} paths with a placeholder.
  * Attribution per hit: mock_upstream.py logs the received Authorization
    prefix (distinct dummy key per key-provider) and the body model; both
    recorded (dual channel, same as E18).
  * Raw AG stdout -> evidence/ag-E20-<tag>.log (gitignored like prior runs);
    JSON evidence -> evidence/E20-<tag>.json.md; configs -> evidence/cfg-E20-*.yaml.

Run:  python e20_conditional_multikey_probe.py t1|t2|t3|t4|all
"""
from __future__ import annotations

import argparse
import json
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
TMPROOT = LAB / ".e20-tmp"
AG = LAB / "bin-e14" / "agentgateway.exe"
BIN_SHA = "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c"
BINARY_META = {
    "binary": "ops/experiments/ag-lab/bin-e14/agentgateway.exe",
    "version": "v1.7.0",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": BIN_SHA,
}

AG_PORT = 3698
ADMIN_PORT, STATS_PORT, READY_PORT = 3934, 3935, 3936
MOCK_A_PORT = 8098

CLIENT_KEY = "sk-ss-lab-client-0001"  # lab dummy, already committed in lab.py
SESSION_KEY = "3a5dde678b895d76e244397deac58c4eac0199d751ee0c168e4ef022d62e9c2e"
UP_KEYS = {"a": "lab-key-a", "b": "lab-key-b"}  # dummy, per key-provider

HEADER_NAME = "x-route"
WHEN_MATCH = "a"   # header value the when predicate matches
WHEN_OTHER = "b"   # present but non-matching
WHEN = ('request.headers["%s"] == "%s"' % (HEADER_NAME, WHEN_MATCH))
WHEN_TRUE = "true"  # catch-all rendered as a predicate (workaround candidate)
MODEL_M1 = "glm-5.3"            # logical upstream model 1 (the when target)
MODEL_M2 = "glm-mini"           # logical upstream model 2 (the catch-all target)
VM_NAME = "vm-e20"
N_SPLIT = 40                    # T2 / T3 burst request count
N_FAITHFUL = 20                 # T2 faithful spot check
N_FAILOVER = 10                 # T4 trial count
HEALTH_TRIO = {"unhealthyExpression": "response.code >= 400",
               "eviction": {"consecutiveFailures": 1}}
RETRY_500 = [{
    "name": {"name": "gateway-retry", "namespace": "default"},
    "target": {"route": {"name": "llm:request", "namespace": "internal"}},
    "phase": "route",
    "policy": {"retry": {"attempts": 2, "codes": [500], "backoff": "100ms"}},
}]


def wait_port(port: int, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.3)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.15)
    return False


def write_keys() -> dict:
    kdir = TMPROOT / "keys"
    kdir.mkdir(parents=True, exist_ok=True)
    paths = {}
    for seq, value in UP_KEYS.items():
        p = (kdir / f"lab-key-{seq}.key").resolve()
        p.write_text(value, encoding="utf-8")
        paths[seq] = str(p)
    return paths


# ------------------------------------------------------------------ configs
def base_cfg() -> dict:
    return {
        "config": {
            "adminAddr": f"127.0.0.1:{ADMIN_PORT}",
            "statsAddr": f"127.0.0.1:{STATS_PORT}",
            "readinessAddr": f"127.0.0.1:{READY_PORT}",
            "database": {"url": "sqlite://data.db"},
            "storage": {"mode": "file"},
            "session": {"key": SESSION_KEY},
        },
        "gateways": {"default": {"port": AG_PORT, "bindAddress": "127.0.0.1"}},
        "frontendPolicies": {"accessLog": {"database": {"llm": "full"}}},
    }


def prov(name: str, key_file: str) -> dict:
    """One key-provider of the logical upstream: same baseUrl, own key_file
    (ADR-026 shape)."""
    return {"name": name, "provider": "openAI",
            "params": {"baseUrl": _mock_url(MOCK_A_PORT),
                       "apiKey": {"file": key_file}}}


def mdl(name: str, ref: str, up_model: str,
        health: dict | None = None) -> dict:
    """Internal #kN alias model (visibility internal, referenced via vm)."""
    e = {"name": name, "provider": {"reference": ref},
         "visibility": "internal", "params": {"model": up_model}}
    if health is not None:
        e["health"] = dict(health)
    return e


def vmodel_cond(name: str, chain: list[dict]) -> dict:
    """Conditional virtual model: chain = [{model, when(optional)}...] in
    evaluation order (render.py _routing_entry conditional branch)."""
    return {"name": name, "routing": {"conditional": {"targets": chain}}}


def llm_block(cfg: dict, providers: list, models: list, vms: list,
              retry: list | None = None) -> dict:
    llm = {"gateways": "default", "providers": providers, "models": models,
           "virtualModels": vms}
    llm["policies"] = {"apiKey": {"mode": "strict", "keys": [
        {"key": CLIENT_KEY, "metadata": {"name": "lab-client"}}]}}
    cfg["llm"] = llm
    if retry:
        cfg["policies"] = retry
    return cfg


def _mock_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/v1"


def _providers(key_paths: dict, count: int) -> list:
    names = ["up-ka", "up-kb"][:count]
    return [prov(n, key_paths[k]) for n, k in zip(names, ("a", "b")[:count])]


def chain_when2(up_names: tuple[str, str] = ("up-a", "up-b")) -> list[dict]:
    """T1-when2 / T2 / T4 core shape: one logical when-target expanded x2 keys.
    up_names=(same, same) gives the ADR-026-faithful attribution-by-auth form."""
    return [
        {"model": MODEL_M1 + "#k1", "when": WHEN},
        {"model": MODEL_M1 + "#k2", "when": WHEN},
    ], [mdl(MODEL_M1 + "#k1", "up-ka", up_names[0]),
        mdl(MODEL_M1 + "#k2", "up-kb", up_names[1])]


def cfg_t1_when2(key_paths: dict, faithful: bool = False) -> dict:
    up = (MODEL_M1, MODEL_M1) if faithful else ("up-a", "up-b")
    chain, models = chain_when2(up)
    return llm_block(base_cfg(), _providers(key_paths, 2), models,
                     [vmodel_cond(VM_NAME, chain)])


def cfg_t1_mixed_kn2(key_paths: dict) -> dict:
    """Faithful D-wave conditional shape: [when#k1, when#k2, catchall#k1,
    catchall#k2] - the no-when entries form the contiguous trailing suffix
    (expansion of one catch-all target x 2 keys)."""
    chain = [
        {"model": MODEL_M1 + "#k1", "when": WHEN},
        {"model": MODEL_M1 + "#k2", "when": WHEN},
        {"model": MODEL_M2 + "#k1"},
        {"model": MODEL_M2 + "#k2"},
    ]
    models = [mdl(MODEL_M1 + "#k1", "up-ka", "up-a"),
              mdl(MODEL_M1 + "#k2", "up-kb", "up-a"),
              mdl(MODEL_M2 + "#k1", "up-ka", "up-b"),
              mdl(MODEL_M2 + "#k2", "up-kb", "up-b")]
    return llm_block(base_cfg(), _providers(key_paths, 2), models,
                     [vmodel_cond(VM_NAME, chain)])


def cfg_t1_mixed_k1(key_paths: dict) -> dict:
    """Single-key contrast: [when#k1, catchall#k1] - the schema-documented
    "omit only on the final fallback" shape."""
    chain = [{"model": MODEL_M1 + "#k1", "when": WHEN},
             {"model": MODEL_M2 + "#k1"}]
    models = [mdl(MODEL_M1 + "#k1", "up-ka", "up-a"),
              mdl(MODEL_M2 + "#k1", "up-ka", "up-b")]
    return llm_block(base_cfg(), _providers(key_paths, 1), models,
                     [vmodel_cond(VM_NAME, chain)])


def cfg_t1_true_tail(key_paths: dict) -> dict:
    """Same kn2 shape as T1-mixed-kn2 but the catch-all tail rendered as
    `when: "true"` (control-plane workaround candidate: AG only allows ONE
    when-less fallback, so the expanded tail needs a predicate to exist)."""
    chain = [{"model": MODEL_M1 + "#k1", "when": WHEN},
             {"model": MODEL_M1 + "#k2", "when": WHEN},
             {"model": MODEL_M2 + "#k1", "when": WHEN_TRUE},
             {"model": MODEL_M2 + "#k2", "when": WHEN_TRUE}]
    models = [mdl(MODEL_M1 + "#k1", "up-ka", "up-a"),
              mdl(MODEL_M1 + "#k2", "up-kb", "up-a"),
              mdl(MODEL_M2 + "#k1", "up-ka", "up-b"),
              mdl(MODEL_M2 + "#k2", "up-kb", "up-b")]
    return llm_block(base_cfg(), _providers(key_paths, 2), models,
                     [vmodel_cond(VM_NAME, chain)])


def cfg_t1_neg_tail(key_paths: dict) -> dict:
    """No-when entries FIRST, when entries after: control plane rejects this
    (unreachable); does AG validate reject it too?"""
    chain = [{"model": MODEL_M1 + "#k1"},
             {"model": MODEL_M1 + "#k2"},
             {"model": MODEL_M2 + "#k1", "when": WHEN},
             {"model": MODEL_M2 + "#k2", "when": WHEN}]
    models = [mdl(MODEL_M1 + "#k1", "up-ka", "up-a"),
              mdl(MODEL_M1 + "#k2", "up-kb", "up-a"),
              mdl(MODEL_M2 + "#k1", "up-ka", "up-b"),
              mdl(MODEL_M2 + "#k2", "up-kb", "up-b")]
    return llm_block(base_cfg(), _providers(key_paths, 2), models,
                     [vmodel_cond(VM_NAME, chain)])


def cfg_t1_ctrl_single(key_paths: dict) -> dict:
    """Single when entry, single key: conditional form sanity baseline."""
    chain, models = chain_when2()
    return llm_block(base_cfg(), _providers(key_paths, 1),
                     models[:1], [vmodel_cond(VM_NAME, chain[:1])])


def cfg_t4(key_paths: dict) -> tuple[dict, str]:
    """when-chain failover: #k1 entry always 500 (mock model code-500),
    #k2 entry always 200 (ok-b), retry codes=[500] + health trio."""
    chain = [{"model": MODEL_M1 + "#k1", "when": WHEN},
             {"model": MODEL_M1 + "#k2", "when": WHEN}]
    models = [mdl(MODEL_M1 + "#k1", "up-ka", "code-500", HEALTH_TRIO),
              mdl(MODEL_M1 + "#k2", "up-kb", "ok-b", HEALTH_TRIO)]
    cfg = llm_block(base_cfg(), _providers(key_paths, 2), models,
                    [vmodel_cond(VM_NAME, chain)], retry=RETRY_500)
    return cfg, VM_NAME


# ------------------------------------------------------------------ processes
class MockProc:
    """mock_upstream.py subprocess (ag-lab standard mock) + incremental log reader."""

    def __init__(self, port: int, tag: str):
        self.port = port
        self.log_path = EVID / f"mock-E20-{tag}.jsonl"
        if self.log_path.exists():
            self.log_path.unlink()
        self.offset = 0
        self.proc = None
        self.lock = threading.Lock()

    def start(self) -> None:
        self.proc = subprocess.Popen(
            [sys.executable, "-I", str(LAB / "mock_upstream.py"),
             "--port", str(self.port), "--log-file", str(self.log_path)],
            cwd=str(LAB), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not wait_port(self.port, timeout=10):
            raise RuntimeError(f"mock upstream failed to start on {self.port}")

    def stop(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except Exception:
                self.proc.kill()
        self.proc = None

    def reset(self) -> None:
        _http("POST", self.port, "/reset")
        with self.lock:
            self.offset = self.log_path.stat().st_size if self.log_path.exists() else 0

    def stats(self) -> dict:
        return _http("GET", self.port, "/stats")

    def new_hits(self) -> list[dict]:
        """Lines appended since the last poll (one JSON per upstream hit)."""
        with self.lock:
            start = self.offset
            try:
                size = self.log_path.stat().st_size
            except FileNotFoundError:
                return []
            if size <= start:
                return []
            with open(self.log_path, "rb") as fh:
                fh.seek(start)
                data = fh.read()
            text = data.decode("utf-8", "replace")
            if not text.endswith("\n"):
                cut = text.rfind("\n") + 1
                text = text[:cut]
            self.offset = start + len(text.encode("utf-8"))
        hits = []
        for line in text.splitlines():
            line = line.strip()
            if line:
                try:
                    hits.append(json.loads(line))
                except json.JSONDecodeError:
                    hits.append({"_raw": line[:200]})
        return hits


def _http(method: str, port: int, path: str, payload: dict | None = None,
          auth: str | None = CLIENT_KEY, timeout: float = 30.0,
          extra_headers: dict | None = None) -> dict:
    url = f"http://127.0.0.1:{port}{path}"
    headers = {"Content-Type": "application/json"}
    if auth:
        headers["Authorization"] = "Bearer " + auth
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"status": resp.status,
                    "body": resp.read().decode("utf-8", "replace")[:2000]}
    except urllib.error.HTTPError as exc:
        return {"status": exc.code,
                "body": exc.read().decode("utf-8", "replace")[:2000]}
    except Exception as exc:
        return {"status": None, "error": repr(exc)[:200]}


class AGProc:
    """Per-scenario AG process with its own workdir/data.db (e18 harness style)."""

    def __init__(self, tag: str):
        self.tag = tag
        self.workdir = TMPROOT / tag
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.run_cfg = self.workdir / "run-config.yaml"
        self.log_path = EVID / f"ag-E20-{tag}.log"
        self.proc = None

    def validate(self, cfg: dict) -> dict:
        scratch = self.workdir / "validate.yaml"
        scratch.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        proc = subprocess.run([str(AG), "--validate-only", "-f", str(scratch)],
                              cwd=str(self.workdir), capture_output=True,
                              text=True, timeout=120)
        return {"exit": proc.returncode,
                "stdout": proc.stdout.strip()[:1500],
                "stderr": proc.stderr.strip()[:1500]}

    def start(self, cfg: dict) -> None:
        self.stop()
        for f in self.workdir.glob("data.db*"):
            f.unlink(missing_ok=True)
        self.run_cfg.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        self.log_path.write_text("", encoding="utf-8")
        self.proc = subprocess.Popen(
            [str(AG), "-f", str(self.run_cfg)], cwd=str(self.workdir),
            stdout=open(self.log_path, "ab"), stderr=subprocess.STDOUT)
        if not wait_port(AG_PORT):
            tail = self.log_text()[-2000:]
            self.stop()
            raise RuntimeError("AG did not start on " + str(AG_PORT)
                               + "; log tail: " + tail)

    def stop(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except Exception:
                self.proc.kill()
        self.proc = None

    def log_text(self) -> str:
        if not self.log_path.exists():
            return ""
        return self.log_path.read_text(encoding="utf-8", errors="replace")

    def log_head_tail(self, lines: int = 30) -> dict:
        text = self.log_text().splitlines()
        return {"head": text[:lines], "tail": text[-lines:]}

    def chat(self, model: str, headers: dict | None = None,
             timeout: float = 30.0) -> dict:
        payload = {"model": model,
                   "messages": [{"role": "user", "content": "hi"}],
                   "max_tokens": 32}
        started = time.time()
        result = _http("POST", AG_PORT, "/v1/chat/completions", payload,
                       timeout=timeout, extra_headers=headers)
        result["duration_ms"] = round((time.time() - started) * 1000, 1)
        if result.get("status") == 200:
            try:
                body = json.loads(result["body"])
                result["resp_model"] = body.get("model")
                result["resp_content"] = str(
                    body.get("choices", [{}])[0].get("message", {}).get("content"))[:60]
            except json.JSONDecodeError:
                result["resp_model"] = None
        else:
            result["resp_model"] = None
        return result

    def models_listing(self) -> dict:
        return _http("GET", AG_PORT, "/v1/models")

    def db_dump(self) -> dict:
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
            for k in ("duration_ms", "time_to_first_token_ms",
                      "time_per_output_token_ms"):
                if row.get(k) is not None:
                    row[k] = round(float(row[k]), 2)
            attrs = row.pop("attributes_json", None)
            if attrs:
                row["attributes_json"] = str(attrs)[:300]
            rows.append({k: (str(v)[:120] if isinstance(v, str) else v)
                         for k, v in row.items()})
        con.close()
        return {"row_count": len(rows), "rows": rows}


# ------------------------------------------------------------------ evidence
def strip_key_files(obj):
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k == "file" and isinstance(v, str) and v.endswith(".key"):
                out[k] = "<gitignored-key-file>"
            else:
                out[k] = strip_key_files(v)
        return out
    if isinstance(obj, list):
        return [strip_key_files(x) for x in obj]
    return obj


def save_cfg(tag: str, cfg: dict) -> str:
    text = json.dumps(strip_key_files(cfg), indent=2, ensure_ascii=False)
    for seq, value in UP_KEYS.items():
        if value in text:
            raise RuntimeError(f"refusing to write cfg {tag}: dummy key leaked")
    path = EVID / f"cfg-E20-{tag}.yaml"
    path.write_text(text + "\n", encoding="utf-8")
    return path.name


def save(tag: str, payload: dict) -> Path:
    # E20 never reads .env.e15; the only keys in play are the dummy lab values
    # (lab-key-a/b, defined above) that double as per-provider attribution
    # markers, so they are intentionally kept in the evidence JSON.
    payload = dict(payload)
    payload["binary"] = BINARY_META
    text = json.dumps(payload, indent=2, ensure_ascii=False, default=str)
    path = EVID / f"E20-{tag}.json.md"
    path.write_text(text + "\n", encoding="utf-8")
    print(f"[e20] saved evidence/E20-{tag}.json.md")
    return path


def split_counts(hits: list[dict]) -> dict:
    """Attribute hits to key-providers via the Authorization prefix (each
    key-provider carries its own dummy key) and via the upstream model name."""
    by_auth: dict[str, int] = {}
    by_model: dict[str, int] = {}
    by_route_header: dict[str, int] = {}
    for hit in hits:
        auth = str(hit.get("auth") or "(none)")
        by_auth[auth] = by_auth.get(auth, 0) + 1
        model = str(hit.get("model") or "(none)")
        by_model[model] = by_model.get(model, 0) + 1
        fwd = (hit.get("headers") or {}).get(HEADER_NAME, "(absent)")
        by_route_header[str(fwd)] = by_route_header.get(str(fwd), 0) + 1
    return {"total_hits": len(hits), "by_auth": by_auth, "by_model": by_model,
            "by_forwarded_route_header": by_route_header}


def auth_split(split: dict) -> dict:
    counts = split["by_auth"]
    return {k: sum(v for kk, v in counts.items() if k in kk)
            for k in ("lab-key-a", "lab-key-b")}


# ------------------------------------------------------------------ T1
def run_t1() -> dict:
    key_paths = write_keys()
    scenarios = {
        "T1-when2": cfg_t1_when2(key_paths),
        "T1-mixed-kn2": cfg_t1_mixed_kn2(key_paths),
        "T1-mixed-k1": cfg_t1_mixed_k1(key_paths),
        "T1-true-tail": cfg_t1_true_tail(key_paths),
        "T1-neg-tail": cfg_t1_neg_tail(key_paths),
        "T1-ctrl-single": cfg_t1_ctrl_single(key_paths),
    }
    ag = AGProc("t1")
    results = {}
    for tag, cfg in scenarios.items():
        val = ag.validate(cfg)
        cfg_file = save_cfg(tag, cfg)
        results[tag] = {"validate": val, "config_file": cfg_file}
        print(f"[e20] T1 {tag}: validate exit={val['exit']}"
              + ("" if val["exit"] == 0 else " stderr=" + val["stderr"][:300]))
    ag.stop()
    save("T1-validate", {"scenarios": results, "when_cel": WHEN})
    return results


def t1_verdict(tag: str) -> bool:
    path = EVID / "E20-T1-validate.json.md"
    if not path.exists():
        run_t1()
    t1 = json.loads(path.read_text(encoding="utf-8"))
    return t1["scenarios"][tag]["validate"]["exit"] == 0


# ------------------------------------------------------------------ bursts
def run_burst_scenario(tag: str, cfg: dict, bursts: list[dict]) -> dict:
    """Start AG + one mock, then fire each burst (label/n/headers) against a
    fresh mock reset; attribute hits per burst. AG refusing to load the config
    is recorded as evidence instead of aborting the run."""
    key_paths = write_keys()
    mock = MockProc(MOCK_A_PORT, tag)
    ag = AGProc(tag)
    out: dict = {"when_cel": WHEN, "header_name": HEADER_NAME, "bursts": {}}
    try:
        mock.start()
        try:
            ag.start(cfg)
        except RuntimeError as exc:
            out["startup_error"] = str(exc)[:1500]
            save(tag, {"config": {"file": save_cfg(tag, cfg)}, **out})
            return out
        out["models_listing"] = ag.models_listing()
        for burst in bursts:
            label = burst["label"]
            mock.reset()
            trials = []
            for _ in range(burst["n"]):
                r = ag.chat(burst.get("model", VM_NAME),
                            headers=burst.get("headers"),
                            timeout=burst.get("timeout", 30.0))
                trials.append({"status": r.get("status"),
                               "resp_model": r.get("resp_model"),
                               "duration_ms": r["duration_ms"],
                               "error": r.get("error")})
            time.sleep(0.3)
            hits = mock.new_hits()
            split = split_counts(hits)
            statuses: dict[int | None, int] = {}
            for t in trials:
                statuses[t["status"]] = statuses.get(t["status"], 0) + 1
            out["bursts"][label] = {
                "n": burst["n"],
                "headers": burst.get("headers") or "(none)",
                "trials": trials,
                "split": split,
                "auth_split": auth_split(split),
                "mock_stats": mock.stats(),
                "client_status_counts": {str(k): v for k, v in statuses.items()},
            }
            print(f"[e20] {tag} burst {label}: statuses="
                  f"{out['bursts'][label]['client_status_counts']} "
                  f"auth={out['bursts'][label]['auth_split']} "
                  f"models={split['by_model']}")
        out["ag_log"] = ag.log_head_tail(30)
        out["request_logs"] = ag.db_dump()
        save(tag, {"config": {"file": save_cfg(tag, cfg)}, **out})
    finally:
        ag.stop()
        mock.stop()
    return out


# ------------------------------------------------------------------ T2
def run_t2() -> dict:
    """Requests matching the when: do the two same-when #kN entries split?"""
    key_paths = write_keys()
    summary: dict = {"question": "same-when #k1/#k2 entries: split or first-match?",
                     "n": N_SPLIT}
    summary["when2"] = run_burst_scenario(
        "T2-when2", cfg_t1_when2(key_paths),
        [{"label": "match-x-route-a", "n": N_SPLIT,
          "headers": {HEADER_NAME: WHEN_MATCH}}])
    summary["faithful"] = run_burst_scenario(
        "T2-when2-faithful", cfg_t1_when2(key_paths, faithful=True),
        [{"label": "match-x-route-a", "n": N_FAITHFUL,
          "headers": {HEADER_NAME: WHEN_MATCH}}])
    return summary


# ------------------------------------------------------------------ T3
def run_t3() -> dict:
    """Requests NOT matching the when: fall through to the no-when trailing
    suffix? (and does the catch-all suffix split between its keys?)
    The faithful kn2 mixed shape is only runnable if T1 accepted it; when
    rejected, the single-key contrast shape answers the predicate-jump
    question and the when:"true" workaround shape (if legal) answers the
    multi-key catch-all question."""
    key_paths = write_keys()
    summary: dict = {"mixed_kn2_validate_legal": t1_verdict("T1-mixed-kn2")}
    bursts = [
        {"label": "b1-other-value", "n": N_SPLIT,
         "headers": {HEADER_NAME: WHEN_OTHER}},
        {"label": "b2-header-absent", "n": N_FAILOVER},
        {"label": "b3-match-control", "n": N_FAILOVER,
         "headers": {HEADER_NAME: WHEN_MATCH}},
    ]
    if summary["mixed_kn2_validate_legal"]:
        summary["runs"] = run_burst_scenario("T3-predicate-jump",
                                             cfg_t1_mixed_kn2(key_paths), bursts)
        return summary
    summary["shape"] = "T1-mixed-k1 (kn2 rejected by validate)"
    summary["runs"] = run_burst_scenario("T3-predicate-jump",
                                         cfg_t1_mixed_k1(key_paths), bursts)
    if t1_verdict("T1-true-tail"):
        summary["true_tail"] = run_burst_scenario(
            "T3-true-tail", cfg_t1_true_tail(key_paths),
            [{"label": "b1-other-value", "n": N_SPLIT,
              "headers": {HEADER_NAME: WHEN_OTHER}},
             {"label": "b2-header-absent", "n": N_FAILOVER}])
    else:
        summary["true_tail_validate_rejected"] = True
    return summary


# ------------------------------------------------------------------ T4
def run_t4() -> dict:
    """when + in-request failover: #k1 entry 500s, does the request switch to
    the #k2 same-when entry?"""
    key_paths = write_keys()
    cfg, client_model = cfg_t4(key_paths)
    out = run_burst_scenario(
        "T4-when-failover", cfg,
        [{"label": "match-failover", "n": N_FAILOVER,
          "headers": {HEADER_NAME: WHEN_MATCH}, "timeout": 60.0,
          "model": client_model}])
    out["retry"] = "attempts=2 codes=[500] backoff=100ms"
    out["health"] = HEALTH_TRIO
    return out


# ------------------------------------------------------------------ main
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("part", choices=["t1", "t2", "t3", "t4", "all"],
                        nargs="?", default="all")
    args = parser.parse_args()
    if not AG.exists():
        print("missing pinned binary " + str(AG))
        return 2
    TMPROOT.mkdir(parents=True, exist_ok=True)
    if args.part == "t1":
        run_t1()
        return 0
    if args.part == "t2":
        run_t2()
        return 0
    if args.part == "t3":
        run_t3()
        return 0
    if args.part == "t4":
        run_t4()
        return 0
    run_t1()
    run_t2()
    run_t3()   # adapts to the T1 verdict on the mixed shape
    run_t4()
    return 0


if __name__ == "__main__":
    sys.exit(main())
