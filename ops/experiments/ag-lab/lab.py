"""agentgateway isolation lab: P0 behaviour experiments E1-E11.

Each experiment starts its own agentgateway process (lab ports 3692/3921/3922/3923)
against the local mock upstream on 8099, records raw evidence under evidence/, and
prints a one-line-per-finding JSON summary. Run one experiment at a time:

    python lab.py e1

Never touches production ports 3691 / 1900x or the binary's own directory.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
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


def _resolve_ag() -> Path:
    """Resolve the binary from $AG_EXE, else the lab-local bin-e14 download
    (v1.7.0, sha256-verified), else PATH."""
    env = os.environ.get("AG_EXE")
    if env:
        return Path(env)
    local = LAB / "bin-e14" / "agentgateway.exe"
    if local.exists():
        return local
    resolved = shutil.which("agentgateway")
    if resolved:
        return Path(resolved)
    raise SystemExit("agentgateway binary not found; set AG_EXE or install it on PATH")


AG = _resolve_ag()
RUN = LAB / "run-config.yaml"
DB = LAB / "data.db"
LLM = "http://127.0.0.1:3692"
MOCK = "http://127.0.0.1:8099"
KEY = "sk-ss-lab-client-0001"
KEY2 = "sk-ss-lab-client-0002"
PROVIDERS = [("mock-ok", "/ok"), ("mock-fail", "/fail"), ("mock-t1", "/t1"), ("mock-t2", "/t2"), ("mock-slow", "/slow")]
AG_PROC = None
AG_LOG = None


# ---------------------------------------------------------------- config builder
def base_cfg() -> dict:
    return {
        "config": {
            "adminAddr": "127.0.0.1:3921",
            "statsAddr": "127.0.0.1:3922",
            "readinessAddr": "127.0.0.1:3923",
            "database": {"url": "sqlite://data.db"},
            "storage": {"mode": "file"},
        },
        "llm": {
            "port": 3692,
            "providers": [
                {"name": name, "provider": "openAI",
                 "params": {"baseUrl": f"http://127.0.0.1:8099{prefix}/v1", "apiKey": "test-key"}}
                for name, prefix in PROVIDERS
            ],
            "models": [
                {"name": f"m-{prefix[1:]}", "visibility": "internal",
                 "provider": {"reference": name}, "params": {"model": f"model-{prefix[1:]}"}}
                for name, prefix in PROVIDERS
            ],
            "virtualModels": [
                {"name": "vm-e1", "routing": {"failover": {"targets": [
                    {"model": "m-fail", "priority": 1}, {"model": "m-ok", "priority": 1}]}}},
                {"name": "vm-e7a", "routing": {"failover": {"targets": [
                    {"model": "m-t1", "priority": 1}, {"model": "m-t2", "priority": 1}]}}},
                {"name": "vm-e7b", "routing": {"failover": {"targets": [
                    {"model": "m-t1", "priority": 1}, {"model": "m-t2", "priority": 2}]}}},
                {"name": "vm-e2", "routing": {"failover": {"targets": [
                    {"model": "m-slow", "priority": 1}]}}},
            ],
            "policies": {"apiKey": {"mode": "strict", "keys": [
                {"key": KEY, "metadata": {"name": "lab-client"}}]}},
        },
        "frontendPolicies": {"accessLog": {"database": {"llm": "full"}}},
    }


def write_cfg(cfg: dict) -> None:
    RUN.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


# ---------------------------------------------------------------- processes
def wait_port(port: int, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.3)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.2)
    return False


def stop_ag() -> None:
    global AG_PROC
    if AG_PROC is not None and AG_PROC.poll() is None:
        AG_PROC.terminate()
        try:
            AG_PROC.wait(timeout=10)
        except Exception:
            AG_PROC.kill()
    AG_PROC = None


def start_ag(cfg: dict, fresh_db: bool = True, tag: str = "run") -> Path:
    global AG_PROC, AG_LOG
    stop_ag()
    if fresh_db:
        for path in LAB.glob("data.db*"):
            path.unlink(missing_ok=True)
    write_cfg(cfg)
    AG_LOG = EVID / f"ag-{tag}.log"
    AG_LOG.write_text("", encoding="utf-8")
    AG_PROC = subprocess.Popen(
        [str(AG), "-f", str(RUN)], cwd=str(LAB),
        stdout=open(AG_LOG, "ab"), stderr=subprocess.STDOUT,
    )
    if not wait_port(3692):
        raise RuntimeError(f"agentgateway did not start; log: {AG_LOG.read_text(errors='replace')[-2000:]}")
    time.sleep(0.5)
    return AG_LOG


def ensure_mock() -> None:
    if wait_port(8099, timeout=1.0):
        return
    subprocess.Popen([sys.executable, str(LAB / "mock_upstream.py"), "--log-file", str(EVID / "mock.jsonl")],
                     cwd=str(LAB), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_port(8099):
        raise RuntimeError("mock upstream failed to start")


def validate(cfg: dict, name: str) -> dict:
    path = EVID / f"cfg-{name}.yaml"
    path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    proc = subprocess.run([str(AG), "--validate-only", "-f", str(path)], cwd=str(LAB),
                          capture_output=True, text=True, timeout=60)
    return {"exit": proc.returncode, "stdout": proc.stdout.strip(), "stderr": proc.stderr.strip()}


# ---------------------------------------------------------------- http helpers
def post_json(model: str, extra: dict | None = None, key: str | None = KEY,
              timeout: float = 30.0, headers: dict | None = None) -> dict:
    payload = {"model": model, "messages": [{"role": "user", "content": "hello"}], "max_tokens": 16}
    if extra:
        payload.update(extra)
    hdrs = {"Content-Type": "application/json"}
    if key:
        hdrs["Authorization"] = f"Bearer {key}"
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(LLM + "/v1/chat/completions", data=json.dumps(payload).encode(), headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"status": resp.status, "headers": dict(resp.headers),
                    "body": resp.read().decode("utf-8", "replace")}
    except urllib.error.HTTPError as exc:
        return {"status": exc.code, "headers": dict(exc.headers),
                "body": exc.read().decode("utf-8", "replace")}
    except Exception as exc:  # noqa: BLE001
        return {"status": None, "error": repr(exc)[:300]}


def stream_post(model: str, timeout: float = 90.0, headers: dict | None = None) -> dict:
    payload = {"model": model, "messages": [{"role": "user", "content": "hi"}], "stream": True, "max_tokens": 16}
    hdrs = {"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(LLM + "/v1/chat/completions", data=json.dumps(payload).encode(), headers=hdrs)
    started = time.time()
    first = None
    count = 0
    done = False
    error = None
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
                    count += 1
                    if first is None:
                        first = time.time() - started
    except Exception as exc:  # noqa: BLE001
        error = repr(exc)[:300]
    return {"chunks": count, "first_token_s": round(first, 3) if first else None,
            "done": done, "duration_s": round(time.time() - started, 3), "error": error}


# ---------------------------------------------------------------- mock helpers
def mock_reset() -> None:
    urllib.request.urlopen(urllib.request.MOCK("POST", MOCK + "/reset", data=b"{}",
                                              headers={"Content-Type": "application/json"}), timeout=5) \
        if False else None
    req = urllib.request.Request(MOCK + "/reset", data=b"{}", method="POST",
                                 headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=5).read()


def mock_stats() -> dict:
    return json.loads(urllib.request.urlopen(MOCK + "/stats", timeout=5).read())["counters"]


def mock_entries(limit: int = 200) -> list[dict]:
    path = EVID / "mock.jsonl"
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:  # noqa: BLE001
            continue
    return out


# ---------------------------------------------------------------- evidence
def save(name: str, payload: dict | list | str) -> None:
    text = payload if isinstance(payload, str) else json.dumps(payload, indent=2, ensure_ascii=False)
    (EVID / f"{name}.json.md").write_text(text + "\n", encoding="utf-8")


def tail_log(path: Path, lines: int = 40) -> str:
    if not path or not Path(path).exists():
        return ""
    return "\n".join(Path(path).read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])


# ---------------------------------------------------------------- experiments
def exp_e1() -> list[str]:
    ensure_mock()
    log = start_ag(base_cfg(), fresh_db=True, tag="e1")
    trials = []
    for index in range(12):
        mock_reset()
        resp = post_json("vm-e1")
        time.sleep(0.25)
        trials.append({"trial": index + 1, "status": resp.get("status"),
                       "body": (resp.get("body") or "")[:160], "counters": mock_stats()})
    save("E1-same-layer-failover", {"trials": trials, "ag_log_tail": tail_log(log, 20)})
    same_request_retry = [t for t in trials if t["counters"].get("/fail") and t["counters"].get("/ok")]
    fail_only = [t for t in trials if t["counters"].get("/fail") and not t["counters"].get("/ok")]
    ok_only = [t for t in trials if t["counters"].get("/ok") and not t["counters"].get("/fail")]
    statuses = {}
    for trial in trials:
        statuses[str(trial["status"])] = statuses.get(str(trial["status"]), 0) + 1
    stop_ag()
    return [
        f"E1: 12 次请求到 vm-e1（fail 与 ok 同为 priority=1）；HTTP 状态分布 {statuses}",
        f"E1: 单次请求内先打 /fail 再打 /ok（同请求重试同层其它 target）次数 = {len(same_request_retry)}；只打 /fail 即返回 500 = {len(fail_only)}；只打 /ok = {len(ok_only)}",
        f"E1: 命中 /fail 后的客户端结果 {[(t['status'], (t['body'] or '')[:80]) for t in trials if t['counters'].get('/fail')]}",
    ]


def exp_e2() -> list[str]:
    ensure_mock()
    cfg = base_cfg()
    log = start_ag(cfg, fresh_db=True, tag="e2")
    control = stream_post("vm-e2")
    result: dict = {}

    def run_stream() -> None:
        result["stream"] = stream_post("vm-e2")

    thread = threading.Thread(target=run_stream)
    thread.start()
    time.sleep(1.5)
    reloaded = copy.deepcopy(cfg)
    reloaded["llm"]["virtualModels"][2]["routing"]["failover"]["targets"][1]["priority"] = 99
    write_cfg(reloaded)
    time.sleep(1.0)
    thread.join(timeout=120)
    mock_reset()
    for _ in range(6):
        post_json("vm-e7b")
    after = mock_stats()
    save("E2-reload-during-stream", {"control_stream": control, "reload_stream": result.get("stream"),
                                     "after_reload_vm_e7b_counters": after, "ag_log_tail": tail_log(log, 60)})
    stop_ag()
    return [
        f"E2: 无热加载对照流 chunks={control['chunks']} done={control['done']} dur={control['duration_s']}s err={control['error']}",
        f"E2: 流中途热加载 chunks={result.get('stream', {}).get('chunks')} done={result.get('stream', {}).get('done')} dur={result.get('stream', {}).get('duration_s')}s err={result.get('stream', {}).get('error')}",
        f"E2: 热加载后 vm-e7b（t2 优先级改 99）计数={after}（若 t2 仍被选说明同层选路不完全按 priority 或 reload 未生效）",
    ]


def exp_e3() -> list[str]:
    ensure_mock()
    cfg = base_cfg()
    cfg["llm"]["models"][1]["health"] = {"eviction": {"consecutiveFailures": 2, "duration": "45s"}}
    cfg["llm"]["virtualModels"].append({"name": "vm-e3", "routing": {"failover": {"targets": [
        {"model": "m-fail", "priority": 1}, {"model": "m-ok", "priority": 1}]}}})
    validate(cfg, "e3")
    log = start_ag(cfg, fresh_db=True, tag="e3")
    before = []
    for index in range(8):
        mock_reset()
        resp = post_json("vm-e3")
        time.sleep(0.15)
        before.append({"n": index + 1, "status": resp.get("status"), "counters": mock_stats()})
    stop_ag()
    log2 = start_ag(cfg, fresh_db=False, tag="e3-restart")
    after = []
    for index in range(4):
        mock_reset()
        resp = post_json("vm-e3")
        time.sleep(0.15)
        after.append({"n": index + 1, "status": resp.get("status"), "counters": mock_stats()})
    save("E3-health-across-restart", {"before_restart": before, "after_restart": after,
                                      "ag_log_tail": tail_log(log, 30) + "\n---restart---\n" + tail_log(log2, 30)})
    stop_ag()
    return [
        f"E3: 重启前 8 次计数 {[t['counters'] for t in before]}",
        f"E3: 重启后 4 次计数 {[t['counters'] for t in after]}（重启后若立刻又打 /fail，说明健康状态未跨重启持久）",
    ]


def exp_e4() -> list[str]:
    ensure_mock()
    log = start_ag(base_cfg(), fresh_db=True, tag="e4")
    internal = post_json("m-ok")
    no_key = post_json("vm-e7a", key=None)
    bad_key = post_json("vm-e7a", key="sk-not-a-real-key")
    save("E4-internal-visibility", {"direct_internal_model": internal, "no_key": no_key,
                                    "bad_key": bad_key, "ag_log_tail": tail_log(log, 20)})
    stop_ag()
    return [
        f"E4: 直连 internal 模型 m-ok 返回 status={internal.get('status')} body={internal.get('body', '')[:300]}",
        f"E4: 无 key 返回 status={no_key.get('status')} body={no_key.get('body', '')[:200]}",
        f"E4: 错 key 返回 status={bad_key.get('status')} body={bad_key.get('body', '')[:200]}",
    ]


def exp_e5() -> list[str]:
    ensure_mock()
    cfg = base_cfg()
    cfg["llm"]["virtualModels"].append({"name": "vm-e5", "routing": {"failover": {"targets": [
        {"model": "vm-e7a", "priority": 1}]}}})
    val = validate(cfg, "e5")
    result = {"validate": val}
    if val["exit"] == 0:
        log = start_ag(cfg, fresh_db=True, tag="e5")
        mock_reset()
        resp = post_json("vm-e5")
        result["request"] = resp
        result["counters"] = mock_stats()
        result["ag_log_tail"] = tail_log(log, 30)
        stop_ag()
    save("E5-virtualmodel-as-target", result)
    return [
        f"E5: failover target 指向另一 virtualModel 名（vm-e7a）时 --validate-only exit={val['exit']} stderr={val['stderr'][:300]}",
        f"E5: 运行时请求结果 {json.dumps(result.get('request'))[:400]} counters={result.get('counters')}",
    ]


def exp_e6() -> list[str]:
    ensure_mock()
    start_ag(base_cfg(), fresh_db=True, tag="e6")
    for _ in range(3):
        post_json("vm-e7a")
    stop_ag()
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    tables = [row[0] for row in con.execute("select name from sqlite_master where type='table' order by name")]
    schema = {}
    for table in tables:
        cols = con.execute(f"pragma table_info({table})").fetchall()
        schema[table] = [{"cid": c[0], "name": c[1], "type": c[2], "notnull": c[3], "pk": c[5]} for c in cols]
    samples = {}
    for table in tables:
        try:
            rows = con.execute(f"select * from {table} limit 2").fetchall()
            cols = [d[0] for d in con.execute(f"select * from {table} limit 1").description] if rows else []
            samples[table] = {"columns": cols, "rows": [list(map(lambda v: str(v)[:200], row)) for row in rows]}
        except Exception as exc:  # noqa: BLE001
            samples[table] = f"error: {exc!r}"
    con.close()
    save("E6-sqlite-schema", {"tables": tables, "schema": schema, "samples": samples})
    return [
        f"E6: 表清单 = {tables}",
        f"E6: request_logs 列 = {[c['name'] for c in schema.get('request_logs', [])]}",
        f"E6: 其余表列摘要 = { {t: [c['name'] for c in cols] for t, cols in schema.items() if t != 'request_logs'} }",
    ]


def exp_e7() -> list[str]:
    ensure_mock()
    start_ag(base_cfg(), fresh_db=True, tag="e7")
    mock_reset()
    for _ in range(60):
        post_json("vm-e7a")
    same_layer = mock_stats()
    mock_reset()
    for _ in range(30):
        post_json("vm-e7b")
    cross_layer = mock_stats()
    save("E7-distribution", {"vm_e7a_60_requests_same_priority": same_layer,
                             "vm_e7b_30_requests_t1_p1_t2_p2": cross_layer})
    stop_ag()
    return [
        f"E7: 同层两 target（都 p1）60 次分布 = {same_layer}",
        f"E7: 跨层（t1 p1, t2 p2）30 次分布 = {cross_layer}（t2 是否被用到）",
    ]


def exp_e8() -> list[str]:
    ensure_mock()
    cfg = base_cfg()
    log = start_ag(cfg, fresh_db=True, tag="e8")
    bad_cases = {
        "bad_yaml_syntax": "config:\n  adminAddr: [unclosed\n",
        "unknown_field": json.dumps({"config": {"adminAddr": "127.0.0.1:3921", "noSuchField": 1}}),
        "missing_provider_reference": json.dumps({"llm": {"port": 3692, "models": [
            {"name": "x", "provider": {"reference": "does-not-exist"}}]}}),
        "bad_priority": json.dumps({"llm": {"port": 3692, "models": [
            {"name": "x", "provider": "openAI"}], "virtualModels": [
            {"name": "v", "routing": {"failover": {"targets": [{"model": "x", "priority": 0}]}}}]}}),
    }
    report: dict = {}
    for name, text in bad_cases.items():
        path = EVID / f"cfg-bad-{name}.yaml"
        path.write_text(text, encoding="utf-8")
        proc = subprocess.run([str(AG), "--validate-only", "-f", str(path)], cwd=str(LAB),
                              capture_output=True, text=True, timeout=60)
        report[name] = {"exit": proc.returncode, "stdout": proc.stdout.strip()[:600],
                        "stderr": proc.stderr.strip()[:1200]}
    RUN.write_text("config:\n  adminAddr: [broken\n", encoding="utf-8")
    time.sleep(2.0)
    old_still_works = post_json("vm-e7a")
    report["reload_failure_old_config"] = {"status": old_still_works.get("status"),
                                           "body": (old_still_works.get("body") or "")[:200]}
    write_cfg(cfg)
    time.sleep(1.5)
    restored = post_json("vm-e7a")
    report["reload_restored"] = {"status": restored.get("status")}
    report["ag_log_tail"] = tail_log(log, 80)
    save("E8-config-errors", report)
    stop_ag()
    return [
        f"E8: 各坏配置 --validate-only 结果 " + json.dumps({k: v["exit"] for k, v in report.items() if isinstance(v, dict) and "exit" in v}, ensure_ascii=False),
        f"E8: 运行中写坏配置后旧配置仍服务 status={report['reload_failure_old_config']['status']} body={(report['reload_failure_old_config']['body'] or '')[:100]}",
        f"E8: 恢复配置后 status={report['reload_restored']['status']}",
        f"E8: AG 日志尾部片段 = {report['ag_log_tail'][-600:]}",
    ]


def exp_e9() -> list[str]:
    ensure_mock()
    cfg = base_cfg()
    cfg["llm"]["policies"]["transformations"] = {
        "request": {
            "set": {"x-lab-req": "'set-by-ag'",
                    "x-slipstream-trace": "request.headers['x-trace-in']"},
            "add": {"x-lab-added": "'add-val'"},
            "body": "'{\"model\": \"model-t1\", \"messages\": [{\"role\": \"user\", \"content\": \"rewritten-by-ag\"}], \"max_tokens\": 7}'",
        },
        "response": {
            "set": {"x-lab-resp": "'resp-set'"},
            "body": "'{\"rewritten_by\": \"ag\", \"model\": \"model-t1\"}'",
        },
    }
    val = validate(cfg, "e9")
    if val["exit"] != 0:
        save("E9-transformations", {"validate": val})
        stop_ag()
        return [f"E9: transformations 配置校验失败 stderr={val['stderr'][:600]}"]
    log = start_ag(cfg, fresh_db=True, tag="e9")
    mock_reset()
    resp = post_json("vm-e7a", headers={"x-trace-in": "trace-123"})
    entries = mock_entries(5)
    save("E9-transformations", {"validate": val, "client_response": resp,
                                "mock_entries": entries, "ag_log_tail": tail_log(log, 30)})
    stop_ag()
    upstream = entries[-1] if entries else {}
    return [
        f"E9: 客户端响应头 x-lab-resp={resp.get('headers', {}).get('x-lab-resp')}，响应体={resp.get('body', '')[:200]}",
        f"E9: mock 收到的请求头 x-lab-req={upstream.get('headers', {}).get('x-lab-req')} x-lab-added={upstream.get('headers', {}).get('x-lab-added')} x-slipstream-trace={upstream.get('headers', {}).get('x-slipstream-trace')}",
        f"E9: 上游收到的 body messages={json.dumps(upstream.get('messages'), ensure_ascii=False)[:260]} max_tokens={upstream.get('max_tokens')}",
    ]


def exp_e10() -> list[str]:
    ensure_mock()
    cfg = base_cfg()
    cfg["llm"]["policies"]["apiKey"]["keys"] = [
        {"key": KEY, "metadata": {"name": "tok-budget"},
         "budgets": [{"name": "tokens-100", "limit": {"unit": "Tokens", "amount": 100},
                      "window": {"rolling": "30d"}, "onBudgetExceeded": "Block"}]},
        {"key": KEY2, "metadata": {"name": "usd-budget"},
         "budgets": [{"name": "usd-budget", "limit": {"unit": "USD", "amount": 1},
                      "window": {"rolling": "30d"}, "onBudgetExceeded": "Block"}]},
    ]
    val = validate(cfg, "e10")
    if val["exit"] != 0:
        save("E10-budget", {"validate": val})
        return [f"E10: budget 配置校验失败 stderr={val['stderr'][:800]}"]
    log = start_ag(cfg, fresh_db=True, tag="e10")
    tokens = []
    for index in range(16):
        resp = post_json("vm-e7a")
        tokens.append({"n": index + 1, "status": resp.get("status"),
                       "body": (resp.get("body") or "")[:160]})
    usd = []
    for index in range(4):
        resp = post_json("vm-e7a", key=KEY2)
        usd.append({"n": index + 1, "status": resp.get("status"), "body": (resp.get("body") or "")[:160]})
    stop_ag()
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    usage_rows = {}
    for table in [row[0] for row in con.execute("select name from sqlite_master where type='table' order by name")]:
        if "budget" in table.lower():
            usage_rows[table] = [list(map(str, row)) for row in con.execute(f"select * from {table}").fetchall()]
    con.close()
    start_ag(cfg, fresh_db=False, tag="e10-restart")
    after_restart = [post_json("vm-e7a").get("status") for _ in range(3)]
    stop_ag()
    cfg2 = copy.deepcopy(cfg)
    start_ag(cfg2, fresh_db=True, tag="e10-reset")
    first = [post_json("vm-e7a").get("status") for _ in range(5)]
    write_cfg(cfg2)
    time.sleep(1.5)
    rest = []
    for index in range(12):
        resp = post_json("vm-e7a")
        rest.append({"n": index + 6, "status": resp.get("status"), "body": (resp.get("body") or "")[:120]})
    reset_probe = {"before_reload_statuses": first, "after_reload": rest,
                   "after_process_restart_statuses": after_restart,
                   "budget_usage_rows_after_tokens": usage_rows}
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    tables = [row[0] for row in con.execute("select name from sqlite_master where type='table' order by name")]
    budget_rows = {}
    for table in tables:
        if "budget" in table.lower() or "usage" in table.lower():
            try:
                rows = con.execute(f"select * from {table} limit 5").fetchall()
                names = [d[0] for d in con.execute(f"select * from {table} limit 1").description] if rows else []
                budget_rows[table] = {"columns": names, "rows": [list(map(str, r)) for r in rows]}
            except Exception as exc:  # noqa: BLE001
                budget_rows[table] = repr(exc)
    con.close()
    stop_ag()
    save("E10-budget", {"validate": val, "token_budget_requests": tokens, "usd_budget_requests": usd,
                        "reload_reset_probe": reset_probe, "budget_tables": budget_rows,
                        "ag_log_tail": tail_log(log, 40)})
    first_block = next((t["n"] for t in tokens if t["status"] != 200), None)
    return [
        f"E10: Tokens=100/30d/Block 时第 {first_block} 个请求开始非 200；样例状态 {[ (t['n'], t['status']) for t in tokens ]}",
        f"E10: 超额响应体 = {next((t['body'] for t in tokens if t['status'] != 200), '')[:300]}",
        f"E10: USD 预算（无 modelCatalog）4 次状态 = {[t['status'] for t in usd]}",
        f"E10: reload 前后额度计数：重载前 5 次 {reset_probe['before_reload_statuses']}，重载后 {[(t['n'], t['status']) for t in reset_probe['after_reload']]}",
        f"E10: 进程重启（同 data.db）后 3 次状态 = {reset_probe['after_process_restart_statuses']}（含 429 则额度跨进程持久）",
        f"E10: 超额后 budget_usage 表原始行 = {json.dumps(reset_probe['budget_usage_rows_after_tokens'], ensure_ascii=False)[:800]}",
        f"E10: 另一轮 budget_usage 行 = {json.dumps(budget_rows, ensure_ascii=False)[:400]}",
    ]


def exp_e11() -> list[str]:
    ensure_mock()
    hashed = hashlib.sha256(KEY2.encode()).hexdigest()
    cfg = base_cfg()
    cfg["llm"]["policies"]["apiKey"]["keys"] = [
        {"keyHash": f"sha256:{hashed}", "metadata": {"name": "hashed-key"}},
        {"key": KEY, "metadata": {"name": "plain-key"}},
    ]
    val = validate(cfg, "e11")
    result: dict = {"validate": val, "hash_value": hashed}
    if val["exit"] == 0:
        log = start_ag(cfg, fresh_db=True, tag="e11")
        result["hashed_key_request"] = post_json("vm-e7a", key=KEY2)
        result["plain_key_request"] = post_json("vm-e7a", key=KEY)
        result["unknown_key_request"] = post_json("vm-e7a", key="sk-unknown-0001")
        result["ag_log_tail"] = tail_log(log, 20)
        stop_ag()
    upper = base_cfg()
    upper["llm"]["policies"]["apiKey"]["keys"] = [
        {"keyHash": f"sha256:{hashed.upper()}", "metadata": {"name": "upper-hash"}}]
    result["uppercase_validate"] = validate(upper, "e11-upper")
    if result["uppercase_validate"]["exit"] == 0:
        start_ag(upper, fresh_db=True, tag="e11-upper")
        result["uppercase_request"] = post_json("vm-e7a", key=KEY2)
        stop_ag()
    malformed = base_cfg()
    malformed["llm"]["policies"]["apiKey"]["keys"] = [{"keyHash": "sha256:not-a-hex"}]
    result["malformed_validate"] = validate(malformed, "e11-malformed")
    save("E11-keyhash", result)
    return [
        f"E11: keyHash=sha256:<lower hex> 校验 exit={val['exit']}；用原 key 请求 status={result.get('hashed_key_request', {}).get('status')}",
        f"E11: 明文 key 仍可用 status={result.get('plain_key_request', {}).get('status')}；未知 key status={result.get('unknown_key_request', {}).get('status')}",
        f"E11: 大写 hex validate exit={result['uppercase_validate']['exit']} stderr={result['uppercase_validate']['stderr'][:300]}；大写 hash 请求 status={result.get('uppercase_request', {}).get('status')}",
        f"E11: 非法 hex validate exit={result['malformed_validate']['exit']} stderr={result['malformed_validate']['stderr'][:300]}",
    ]


def exp_e1_v2() -> list[str]:
    ensure_mock()
    start_ag(base_cfg(), fresh_db=True, tag="e1")
    same = []
    for index in range(12):
        mock_reset()
        resp = post_json("vm-e1")
        time.sleep(0.2)
        same.append({"trial": index + 1, "status": resp.get("status"), "counters": mock_stats()})
    stop_ag()
    cfg = base_cfg()
    cfg["llm"]["virtualModels"].append({"name": "vm-e1b", "routing": {"failover": {"targets": [
        {"model": "m-fail", "priority": 1}, {"model": "m-ok", "priority": 2}]}}})
    log = start_ag(cfg, fresh_db=True, tag="e1-cross-layer")
    cross = []
    for index in range(8):
        mock_reset()
        resp = post_json("vm-e1b")
        time.sleep(0.2)
        cross.append({"trial": index + 1, "status": resp.get("status"), "counters": mock_stats()})
    stop_ag()
    save("E1-same-layer-failover", {"same_layer": same, "cross_layer": cross, "ag_log_tail": tail_log(log, 30)})
    same_retry = sum(1 for t in same if t["counters"].get("/fail") and t["counters"].get("/ok"))
    fail_only = [t["trial"] for t in same if t["counters"].get("/fail") and not t["counters"].get("/ok")]
    cross_retry = sum(1 for t in cross if t["counters"].get("/fail") and t["counters"].get("/ok"))
    cross_fail_only = [t["trial"] for t in cross if t["counters"].get("/fail") and not t["counters"].get("/ok")]
    return [
        f"E1a 同层（fail p1 + ok p1）12 次单请求：单请求内同时打到 /fail 与 /ok 的次数 = {same_retry}；只打 /fail 且返回 500 的 trial = {fail_only}",
        f"E1a 序列 = " + json.dumps([(t["trial"], t["status"], t["counters"]) for t in same], ensure_ascii=False),
        f"E1b 跨层（fail p1 + ok p2，默认健康策略）8 次单请求：单请求内同时打到 /fail 与 /ok 的次数 = {cross_retry}；只打 /fail 返回 500 的 trial = {cross_fail_only}",
        f"E1b 序列 = " + json.dumps([(t["trial"], t["status"], t["counters"]) for t in cross], ensure_ascii=False),
    ]


def exp_e3_v2() -> list[str]:
    ensure_mock()
    cfg = base_cfg()
    cfg["llm"]["models"][1]["health"] = {"eviction": {"consecutiveFailures": 2, "duration": "45s"}}
    cfg["llm"]["virtualModels"].append({"name": "vm-e3", "routing": {"failover": {"targets": [
        {"model": "m-fail", "priority": 1}, {"model": "m-ok", "priority": 2}]}}})
    validate(cfg, "e3")
    start_ag(cfg, fresh_db=True, tag="e3")
    before = []
    for index in range(8):
        mock_reset()
        resp = post_json("vm-e3")
        time.sleep(0.15)
        before.append({"n": index + 1, "status": resp.get("status"), "counters": mock_stats()})
    stop_ag()
    log2 = start_ag(cfg, fresh_db=False, tag="e3-restart")
    after = []
    for index in range(3):
        mock_reset()
        resp = post_json("vm-e3")
        time.sleep(0.15)
        after.append({"n": index + 1, "status": resp.get("status"), "counters": mock_stats()})
    stop_ag()
    save("E3-health-across-restart", {"before_restart": before, "after_restart": after,
                                      "ag_log_tail": tail_log(log2, 40)})
    return [
        f"E3: 重启前 8 次（fail p1 only -> ok p2，eviction consecutiveFailures=2）序列 = " + json.dumps([(t["n"], t["status"], t["counters"]) for t in before], ensure_ascii=False),
        f"E3: 重启后 3 次序列 = " + json.dumps([(t["n"], t["status"], t["counters"]) for t in after], ensure_ascii=False),
    ]


def exp_e9_v2() -> list[str]:
    ensure_mock()
    results: dict = {}

    body_expr = "'{\"model\": \"vm-e9\", \"messages\": [{\"role\": \"user\", \"content\": \"rewritten-by-ag\"}], \"max_tokens\": 7}'"

    cfg = base_cfg()
    cfg["llm"]["virtualModels"].append({"name": "vm-e9", "routing": {"failover": {"targets": [
        {"model": "m-t1", "priority": 1}]}}})
    cfg["llm"]["policies"]["transformations"] = {
        "request": {
            "set": {"x-lab-req": "'set-by-ag'",
                    "x-slipstream-trace": "request.headers['x-trace-in']"},
            "add": {"x-lab-added": "'add-val'"},
        },
        "response": {"set": {"x-lab-resp": "'resp-set'"}},
    }
    val_a = validate(cfg, "e9-headers")
    if val_a["exit"] == 0:
        start_ag(cfg, fresh_db=True, tag="e9-headers")
        mock_reset()
        resp = post_json("vm-e9", headers={"x-trace-in": "trace-123"})
        results["headers_only"] = {
            "response_status": resp.get("status"),
            "response_headers": {k: v for k, v in resp.get("headers", {}).items() if k.lower().startswith("x-")},
            "mock_entry": (mock_entries(2) or [{}])[-1],
        }
        stop_ag()
    else:
        results["headers_only_validate"] = val_a

    cfg2 = base_cfg()
    cfg2["llm"]["virtualModels"].append({"name": "vm-e9", "routing": {"failover": {"targets": [
        {"model": "m-t1", "priority": 1}]}}})
    cfg2["llm"]["policies"]["transformations"] = {
        "request": {"set": {"x-lab-req": "'set-by-ag'"}, "body": body_expr},
        "response": {"set": {"x-lab-resp": "'resp-set'"},
                     "body": "'{\"rewritten_by\": \"ag\", \"model\": \"model-t1\"}'"},
    }
    val_b = validate(cfg2, "e9-body")
    if val_b["exit"] == 0:
        start_ag(cfg2, fresh_db=True, tag="e9-body")
        mock_reset()
        resp = post_json("vm-e9", headers={"x-trace-in": "trace-123"})
        entry = (mock_entries(2) or [{}])[-1]
        results["body_replace"] = {"response_status": resp.get("status"), "response_body": resp.get("body"),
                                   "mock_messages": entry.get("messages"),
                                   "mock_max_tokens": entry.get("max_tokens"),
                                   "mock_model": entry.get("model")}
        stop_ag()
    else:
        results["body_replace_validate"] = val_b

    cfg3 = base_cfg()
    cfg3["llm"]["virtualModels"].append({"name": "vm-e9", "routing": {"failover": {"targets": [
        {"model": "m-t1", "priority": 1}]}}})
    for model in cfg3["llm"]["models"]:
        if model["name"] == "m-t1":
            model["requestTransformation"] = {
                "set": {"x-lab-req": "'set-model-level'"},
                "add": {"x-lab-added": "'add-model-level'"},
                "body": "'{\"model\": \"model-t1\", \"messages\": [{\"role\": \"user\", \"content\": \"model-level-rewrite\"}], \"max_tokens\": 9}'",
            }
    val_c = validate(cfg3, "e9-model-level")
    if val_c["exit"] == 0:
        start_ag(cfg3, fresh_db=True, tag="e9-model-level")
        mock_reset()
        resp = post_json("vm-e9")
        entry = (mock_entries(2) or [{}])[-1]
        results["model_level_request_transformation"] = {
            "response_status": resp.get("status"), "response_body": resp.get("body"),
            "mock_headers": entry.get("headers"), "mock_messages": entry.get("messages"),
            "mock_max_tokens": entry.get("max_tokens")}
        stop_ag()
    else:
        results["model_level_validate"] = val_c

    save("E9-transformations", results)
    head = results.get("headers_only", {})
    body = results.get("body_replace", {})
    model = results.get("model_level_request_transformation", {})
    return [
        f"E9a policy 级 request set/add header：响应状态 {head.get('response_status')}；上游收到 x-* 头 = {json.dumps((head.get('mock_entry') or {}).get('headers'), ensure_ascii=False)}",
        f"E9b policy 级 request body 替换 + response header/body 替换：客户端状态 {body.get('response_status')} body={str(body.get('response_body'))[:140]}；上游 messages={json.dumps(body.get('mock_messages'), ensure_ascii=False)[:220]} max_tokens={body.get('mock_max_tokens')}",
        f"E9c model 级 requestTransformation：客户端状态 {model.get('response_status')}；上游 headers={json.dumps(model.get('mock_headers'), ensure_ascii=False)} messages={json.dumps(model.get('mock_messages'), ensure_ascii=False)[:220]} max_tokens={model.get('mock_max_tokens')}",
        f"E9 校验失败项 = {json.dumps({k: v.get('stderr', '')[:300] for k, v in results.items() if isinstance(v, dict) and 'stderr' in v}, ensure_ascii=False)}",
    ]


EXPERIMENTS = {"e1": exp_e1_v2, "e2": exp_e2, "e3": exp_e3_v2, "e4": exp_e4, "e5": exp_e5,
               "e6": exp_e6, "e7": exp_e7, "e8": exp_e8, "e9": exp_e9_v2, "e10": exp_e10, "e11": exp_e11}


def main() -> int:
    name = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
    if name not in EXPERIMENTS:
        print(json.dumps({"experiments": list(EXPERIMENTS)}, ensure_ascii=False))
        return 2
    ensure_mock()
    try:
        findings = EXPERIMENTS[name]()
    finally:
        stop_ag()
    print(json.dumps({"experiment": name, "findings": findings}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
