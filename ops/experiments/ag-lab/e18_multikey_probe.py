"""E18 multi-key probe (ADR-026 前置): duplicate llm.models[] names across
key-expanded providers + in-request failover consistency, on the pinned AG
1.7.0 hybrid form (ADR-024: gateways + llm.gateways + llm.models/virtualModels
+ top-level policies[] retry targeting internal/llm:request).

Questions (docs/plans/w4-e18-multikey-probe.md):
  T1   is `llm.models[]` with duplicate names (each provider.reference -> a
       different key-provider) legal for --validate-only? (x2 / x3 / distinct
       control / + virtualModel shapes)
  T2   runtime: do duplicates coexist and split traffic (N=60), or does one
       entry win?  production shape = internal duplicates + one virtualModel
       target; also the ADR-026-faithful same-params.model spot check.
  T1b  if duplicates are rejected/dead: `glm-5.3#kN` alias models + virtualModel
       same-priority targets (T2 rerun on that form).
  T3   in-request failover between two key-providers of the SAME upstream
       (same baseUrl, different key_file): provider-A always 500, provider-B
       always 200, retry codes=[500] + health trio; 10 trials; cross-checked
       against the cross-upstream variant (two baseUrls) for consistency.
  T4   equality claim: 3 key-providers as virtualModel same-priority targets,
       N=60 distribution vs E7's P2C (~2:1) baseline.

Conventions (inherited from lab.py / e17_common.py):
  * AG binary ops/experiments/ag-lab/bin-e14/agentgateway.exe (v1.7.0,
    sha256 909b93dc...ed3c, same pin as E14-E17).
  * Lab-only ports 3696 (AG) / 3924-3926 (admin/stats/ready) / 8096-8097
    (mock upstreams) - production 3691/1900x/3700 untouched.
  * NO real credentials: .env.e15 is never read here. All upstream keys are
    dummy lab values written to .e18-tmp/keys/*.key (gitignored); evidence
    save replaces {file: ...} paths with a placeholder.
  * Attribution per hit: mock_upstream.py logs the received Authorization
    prefix (distinct dummy key per provider) and the body model; both recorded.
  * Raw AG stdout -> evidence/ag-E18-<tag>.log (gitignored like prior runs);
    JSON evidence -> evidence/E18-<tag>.json.md; configs -> evidence/cfg-E18-*.yaml.

Run:  python e18_multikey_probe.py t1|t2|t3|t4|all
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
TMPROOT = LAB / ".e18-tmp"
AG = LAB / "bin-e14" / "agentgateway.exe"
BIN_SHA = "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c"
BINARY_META = {
    "binary": "ops/experiments/ag-lab/bin-e14/agentgateway.exe",
    "version": "v1.7.0",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": BIN_SHA,
}

AG_PORT = 3696
ADMIN_PORT, STATS_PORT, READY_PORT = 3924, 3925, 3926
MOCK_A_PORT = 8096
MOCK_B_PORT = 8097

CLIENT_KEY = "sk-ss-lab-client-0001"  # lab dummy, already committed in lab.py
SESSION_KEY = "3a5dde678b895d76e244397deac58c4eac0199d751ee0c168e4ef022d62e9c2e"
UP_KEYS = {"a": "lab-key-a", "b": "lab-key-b", "c": "lab-key-c"}  # dummy

MODEL_DUP = "glm-5.3"          # the duplicated public/internal name
MODEL_K = "glm-5.3#k{n}"       # T1b alias form
VM_NAME = "vm-e18"
N_SPLIT = 60                   # T2/T4 request count
N_FAILOVER = 10                # T3 trial count
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


def prov(name: str, base_url: str, key_file: str) -> dict:
    return {"name": name, "provider": "openAI",
            "params": {"baseUrl": base_url, "apiKey": {"file": key_file}}}


def mdl(name: str, ref: str, up_model: str, visibility: str = "public",
        health: dict | None = None) -> dict:
    e = {"name": name, "provider": {"reference": ref},
         "visibility": visibility, "params": {"model": up_model}}
    if health is not None:
        e["health"] = dict(health)
    return e


def vmodel(name: str, targets: list[tuple[str, int]]) -> dict:
    return {"name": name,
            "routing": {"failover": {"targets": [
                {"model": m, "priority": p} for m, p in targets]}}}


def llm_block(cfg: dict, providers: list, models: list, vms: list | None = None,
              retry: list | None = None) -> dict:
    llm = {"gateways": "default", "providers": providers, "models": models}
    if vms:
        llm["virtualModels"] = vms
    llm["policies"] = {"apiKey": {"mode": "strict", "keys": [
        {"key": CLIENT_KEY, "metadata": {"name": "lab-client"}}]}}
    cfg["llm"] = llm
    if retry:
        cfg["policies"] = retry
    return cfg


def dup_providers(key_paths: dict, base_url: str) -> list:
    """One logical upstream expanded into key-providers: same baseUrl, one
    key_file each (ADR-026 shape)."""
    return [prov("up-ka", base_url, key_paths["a"]),
            prov("up-kb", base_url, key_paths["b"]),
            prov("up-kc", base_url, key_paths["c"])]


def cfg_t1_dup2(key_paths: dict, internal: bool = False,
                with_vm: bool = False) -> dict:
    vis = "internal" if internal else "public"
    cfg = llm_block(base_cfg(), dup_providers(key_paths, _mock_url(MOCK_A_PORT))[:2], [
        mdl(MODEL_DUP, "up-ka", "up-a", vis),
        mdl(MODEL_DUP, "up-kb", "up-b", vis),
    ], [vmodel(VM_NAME, [(MODEL_DUP, 1)])] if with_vm else None)
    return cfg


def cfg_t1_dup3(key_paths: dict) -> dict:
    return llm_block(base_cfg(), dup_providers(key_paths, _mock_url(MOCK_A_PORT)), [
        mdl(MODEL_DUP, "up-ka", "up-a", "public"),
        mdl(MODEL_DUP, "up-kb", "up-b", "public"),
        mdl(MODEL_DUP, "up-kc", "up-c", "public"),
    ])


def cfg_t1_ctrl(key_paths: dict) -> dict:
    return llm_block(base_cfg(), dup_providers(key_paths, _mock_url(MOCK_A_PORT)), [
        mdl("glm-a", "up-ka", "up-a"),
        mdl("glm-b", "up-kb", "up-b"),
        mdl("glm-c", "up-kc", "up-c"),
    ])


def cfg_t1_kn(key_paths: dict, count: int) -> dict:
    """T1b alias form: glm-5.3#kN names + virtualModel same-priority targets."""
    refs = ["up-ka", "up-kb", "up-kc"][:count]
    seqs = ["a", "b", "c"][:count]
    models = [mdl(MODEL_K.format(n=i + 1), ref, f"up-{s}", "internal")
              for i, (ref, s) in enumerate(zip(refs, seqs))]
    targets = [(MODEL_K.format(n=i + 1), 1) for i in range(count)]
    return llm_block(base_cfg(),
                     dup_providers(key_paths, _mock_url(MOCK_A_PORT))[:count],
                     models, [vmodel(VM_NAME + "kn", targets)])


def cfg_t3(key_paths: dict, same_group: bool,
           use_kn: bool) -> tuple[dict, str]:
    """Provider-A always 500 (mock model code-500), provider-B always 200.
    same_group=True: both key-providers share one baseUrl (multi-key shape).
    same_group=False: each provider gets its own mock (cross-upstream shape)."""
    url_a = _mock_url(MOCK_A_PORT)
    url_b = _mock_url(MOCK_A_PORT) if same_group else _mock_url(MOCK_B_PORT)
    providers = [prov("up-ka", url_a, key_paths["a"]),
                 prov("up-kb", url_b, key_paths["b"])]
    if use_kn:
        models = [mdl(MODEL_K.format(n=1), "up-ka", "code-500", "internal", HEALTH_TRIO),
                  mdl(MODEL_K.format(n=2), "up-kb", "ok-b", "internal", HEALTH_TRIO)]
        vms = [vmodel(VM_NAME + "kn", [(MODEL_K.format(n=1), 1),
                                       (MODEL_K.format(n=2), 1)])]
        client_model = VM_NAME + "kn"
    else:
        models = [mdl(MODEL_DUP, "up-ka", "code-500", "public", HEALTH_TRIO),
                  mdl(MODEL_DUP, "up-kb", "ok-b", "public", HEALTH_TRIO)]
        vms = None
        client_model = MODEL_DUP
    cfg = llm_block(base_cfg(), providers, models, vms, retry=RETRY_500)
    return cfg, client_model


def _mock_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/v1"


# ------------------------------------------------------------------ processes
class MockProc:
    """mock_upstream.py subprocess (ag-lab standard mock) + incremental log reader."""

    def __init__(self, port: int, tag: str):
        self.port = port
        self.log_path = EVID / f"mock-E18-{tag}.jsonl"
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
          auth: str | None = CLIENT_KEY, timeout: float = 30.0) -> dict:
    url = f"http://127.0.0.1:{port}{path}"
    headers = {"Content-Type": "application/json"}
    if auth:
        headers["Authorization"] = "Bearer " + auth
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
    """Per-scenario AG process with its own workdir/data.db (e17 harness style)."""

    def __init__(self, tag: str):
        self.tag = tag
        self.workdir = TMPROOT / tag
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.run_cfg = self.workdir / "run-config.yaml"
        self.log_path = EVID / f"ag-E18-{tag}.log"
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

    def chat(self, model: str, timeout: float = 30.0) -> dict:
        payload = {"model": model,
                   "messages": [{"role": "user", "content": "hi"}],
                   "max_tokens": 32}
        started = time.time()
        result = _http("POST", AG_PORT, "/v1/chat/completions", payload,
                       timeout=timeout)
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
    path = EVID / f"cfg-E18-{tag}.yaml"
    path.write_text(text + "\n", encoding="utf-8")
    return path.name


def save(tag: str, payload: dict) -> Path:
    # E18 never reads .env.e15; the only keys in play are the dummy lab values
    # (lab-key-a/b/c, defined above) that double as per-provider attribution
    # markers, so they are intentionally kept in the evidence JSON.
    payload = dict(payload)
    payload["binary"] = BINARY_META
    text = json.dumps(payload, indent=2, ensure_ascii=False, default=str)
    path = EVID / f"E18-{tag}.json.md"
    path.write_text(text + "\n", encoding="utf-8")
    print(f"[e18] saved evidence/E18-{tag}.json.md")
    return path


def split_counts(hits: list[dict]) -> dict:
    """Attribute hits to key-providers via the Authorization prefix (each
    provider carries its own dummy key) and via the upstream model name."""
    by_auth: dict[str, int] = {}
    by_model: dict[str, int] = {}
    for hit in hits:
        auth = str(hit.get("auth") or "(none)")
        by_auth[auth] = by_auth.get(auth, 0) + 1
        model = str(hit.get("model") or "(none)")
        by_model[model] = by_model.get(model, 0) + 1
    return {"total_hits": len(hits), "by_auth": by_auth, "by_model": by_model}


# ------------------------------------------------------------------ T1
def run_t1() -> dict:
    key_paths = write_keys()
    scenarios = {
        "T1-dup2": cfg_t1_dup2(key_paths),
        "T1-dup3": cfg_t1_dup3(key_paths),
        "T1-ctrl": cfg_t1_ctrl(key_paths),
        "T1-dup2-vm": cfg_t1_dup2(key_paths, internal=True, with_vm=True),
        "T1-kn2-vm": cfg_t1_kn(key_paths, 2),
        "T1-kn3-vm": cfg_t1_kn(key_paths, 3),
    }
    ag = AGProc("t1")
    results = {}
    for tag, cfg in scenarios.items():
        val = ag.validate(cfg)
        cfg_file = save_cfg(tag, cfg)
        results[tag] = {"validate": val, "config_file": cfg_file}
        print(f"[e18] T1 {tag}: validate exit={val['exit']}"
              + ("" if val["exit"] == 0 else " stderr=" + val["stderr"][:200]))
    ag.stop()
    save("T1-validate", {"scenarios": results})
    return results


# ------------------------------------------------------------------ T2
def run_split_scenario(tag: str, cfg: dict, client_model: str,
                       n: int = N_SPLIT) -> dict:
    """Start AG + one mock, fire n sequential requests, attribute each hit.
    AG refusing to load the config (e.g. duplicate-name rejection at startup)
    is recorded as evidence instead of aborting the run."""
    key_paths = write_keys()
    mock = MockProc(MOCK_A_PORT, tag)
    ag = AGProc(tag)
    out: dict = {"client_model": client_model, "n": n}
    try:
        mock.start()
        try:
            ag.start(cfg)
        except RuntimeError as exc:
            out["startup_error"] = str(exc)[:1500]
            out["split_ok"] = False
            save(tag, {"config": {"file": save_cfg(tag, cfg)}, **out})
            return out
        out["models_listing"] = ag.models_listing()
        mock.reset()
        trials = []
        for _ in range(n):
            r = ag.chat(client_model)
            trials.append({"status": r.get("status"),
                           "resp_model": r.get("resp_model"),
                           "duration_ms": r["duration_ms"],
                           "error": r.get("error")})
        time.sleep(0.3)
        hits = mock.new_hits()
        out["trials"] = trials
        out["split"] = split_counts(hits)
        out["mock_stats"] = mock.stats()
        statuses: dict[int | None, int] = {}
        for t in trials:
            statuses[t["status"]] = statuses.get(t["status"], 0) + 1
        out["client_status_counts"] = {str(k): v for k, v in statuses.items()}
        out["ag_log"] = ag.log_head_tail(25)
        out["request_logs"] = ag.db_dump()
        auth_counts = out["split"]["by_auth"]
        key_a = sum(v for k, v in auth_counts.items() if "lab-key-a" in k)
        key_b = sum(v for k, v in auth_counts.items() if "lab-key-b" in k)
        key_c = sum(v for k, v in auth_counts.items() if "lab-key-c" in k)
        ok_statuses = sum(v for k, v in statuses.items() if k == 200)
        out["split_ok"] = (key_a > 0 and key_b > 0 and ok_statuses == n
                           and out["split"]["total_hits"] == n)
        save(tag, {"config": {"file": save_cfg(tag, cfg)}, **out})
    finally:
        ag.stop()
        mock.stop()
    return out


def run_t2(use_kn: bool = False) -> dict:
    """Splitting probes. use_kn=True runs only the T1b alias form."""
    key_paths = write_keys()
    summary: dict = {"use_kn": use_kn}
    if use_kn:
        cfg = cfg_t1_kn(key_paths, 2)
        summary["kn2"] = run_split_scenario("T1b-kn2", cfg, VM_NAME + "kn")
        # ADR-026 faithful shape: every key-provider serves the SAME upstream
        # model name (they are keys of one upstream); attribution falls back
        # to the per-key Authorization header.
        faithful = llm_block(base_cfg(),
                             dup_providers(key_paths, _mock_url(MOCK_A_PORT))[:2], [
            mdl(MODEL_K.format(n=1), "up-ka", MODEL_DUP, "internal"),
            mdl(MODEL_K.format(n=2), "up-kb", MODEL_DUP, "internal"),
        ], [vmodel(VM_NAME + "kn", [(MODEL_K.format(n=1), 1),
                                    (MODEL_K.format(n=2), 1)])])
        summary["kn2_faithful"] = run_split_scenario(
            "T1b-kn2-faithful", faithful, VM_NAME + "kn", n=20)
        return summary
    direct = run_split_scenario("T2-direct", cfg_t1_dup2(key_paths), MODEL_DUP)
    summary["direct"] = direct
    vm = run_split_scenario("T2-vm", cfg_t1_dup2(key_paths, internal=True,
                                                 with_vm=True), VM_NAME)
    summary["vm"] = vm
    if direct.get("split_ok") or vm.get("split_ok"):
        # ADR-026-faithful shape: identical upstream model name for both
        # key-providers (attribution falls back to the per-key auth header).
        faithful_cfg = llm_block(base_cfg(), dup_providers(key_paths,
                                 _mock_url(MOCK_A_PORT))[:2], [
            mdl(MODEL_DUP, "up-ka", MODEL_DUP),
            mdl(MODEL_DUP, "up-kb", MODEL_DUP)])
        summary["faithful"] = run_split_scenario("T2-faithful", faithful_cfg,
                                                 MODEL_DUP, n=20)
    summary["same_name_ok"] = bool(direct.get("split_ok") or vm.get("split_ok"))
    return summary


# ------------------------------------------------------------------ T3
def run_t3_scenario(tag: str, same_group: bool, use_kn: bool) -> dict:
    key_paths = write_keys()
    cfg, client_model = cfg_t3(key_paths, same_group=same_group, use_kn=use_kn)
    mock_a = MockProc(MOCK_A_PORT, tag + ("-sg" if same_group else "-xu") + "-a")
    mock_b = MockProc(MOCK_B_PORT, tag + ("-sg" if same_group else "-xu") + "-b")
    ag = AGProc(tag)
    out: dict = {"client_model": client_model, "same_group": same_group,
                 "use_kn": use_kn, "retry": "attempts=2 codes=[500] backoff=100ms",
                 "health": HEALTH_TRIO}
    try:
        mock_a.start()
        if not same_group:
            mock_b.start()
        ag.start(cfg)
        out["models_listing"] = ag.models_listing()
        mock_a.reset()
        if not same_group:
            mock_b.reset()
        trials = []
        for _ in range(N_FAILOVER):
            r = ag.chat(client_model, timeout=60.0)
            hits_a = mock_a.new_hits()
            hits_b = mock_b.new_hits() if not same_group else []
            trials.append({
                "status": r.get("status"),
                "duration_ms": r["duration_ms"],
                "error": r.get("error"),
                "hits_a": [{"auth": h.get("auth"), "model": h.get("model")}
                           for h in hits_a],
                "hits_b": [{"auth": h.get("auth"), "model": h.get("model")}
                           for h in hits_b],
            })
        time.sleep(0.3)
        out["trials"] = trials
        out["mock_a_stats"] = mock_a.stats()
        if not same_group:
            out["mock_b_stats"] = mock_b.stats()
        statuses: dict[int | None, int] = {}
        for t in trials:
            statuses[t["status"]] = statuses.get(t["status"], 0) + 1
        out["client_status_counts"] = {str(k): v for k, v in statuses.items()}
        out["durations_ms"] = [t["duration_ms"] for t in trials]
        out["ag_log"] = ag.log_head_tail(40)
        out["request_logs"] = ag.db_dump()
        save(tag, {"config": {"file": save_cfg(tag, cfg)}, **out})
    finally:
        ag.stop()
        mock_a.stop()
        mock_b.stop()
    return out


def run_t3(use_kn: bool) -> dict:
    return {
        "s1_same_group": run_t3_scenario("T3-s1-samegroup", True, use_kn),
        "s2_cross_upstream": run_t3_scenario("T3-s2-crossup", False, use_kn),
    }


# ------------------------------------------------------------------ T4
def run_t4() -> dict:
    key_paths = write_keys()
    cfg = cfg_t1_kn(key_paths, 3)
    out = run_split_scenario("T4-kn3", cfg, VM_NAME + "kn")
    return out


# ------------------------------------------------------------------ main
def t1_dup_validate_legal() -> bool:
    t1_file = EVID / "E18-T1-validate.json.md"
    if not t1_file.exists():
        return True
    t1 = json.loads(t1_file.read_text(encoding="utf-8"))
    return all(t1["scenarios"][k]["validate"]["exit"] == 0
               for k in ("T1-dup2", "T1-dup2-vm"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("part", choices=["t1", "t2", "t2kn", "t3", "t4", "all"],
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
        run_t2(use_kn=not t1_dup_validate_legal())
        return 0
    if args.part == "t2kn":
        run_t2(use_kn=True)
        return 0
    if args.part == "t3":
        run_t3(use_kn=True)  # standalone: safe alias form
        return 0
    if args.part == "t4":
        run_t4()
        return 0
    # all: T1 -> form decision -> T2 -> T3 (winning form) -> T4
    run_t1()
    if not t1_dup_validate_legal():
        print("[e18] T1: duplicate names rejected by validate -> T1b alias form")
        run_t2(use_kn=True)
        run_t3(use_kn=True)
    else:
        t2 = run_t2()
        if t2.get("same_name_ok"):
            run_t3(use_kn=False)
        else:
            print("[e18] T2: duplicates validate-legal but functionally dead "
                  "-> T1b alias form")
            run_t2(use_kn=True)
            run_t3(use_kn=True)
    run_t4()
    return 0


if __name__ == "__main__":
    sys.exit(main())
