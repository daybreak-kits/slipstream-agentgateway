"""E14a: per-status-code gateway behaviour (in-request retry vs pass-through, eviction)
and E14b: non-chat endpoint passthrough via the LLM listener.

Scenario A: no retry config anywhere; virtualModel = code target (p1) + m-ok (p2).
Scenario B: route-layer FilterOrPolicy.retry on a plain-HTTP gateway (port 3694);
            same LLM probes repeated to see whether route retry reaches LLM traffic.

Run inside the isolation lab (ports 3692/3921-3923/3694, mock 8099):
    python e14_retry_status.py
"""
from __future__ import annotations

import copy
import json
import sqlite3
import time
import urllib.error
import urllib.request

import lab as L

CODES = [200, 400, 401, 403, 404, 408, 429, 499, 500, 502, 503, 504, 505, 520, 599]
RETRY_CODES = [429, 500, 502, 503]
STALL_SECONDS = 40
CLIENT_TIMEOUT = 30.0
BINARY_SHA256 = "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c"


def e14_cfg(retry_layer: bool) -> dict:
    """base lab config + per-code status targets (+ optional routes/gateways retry layer)."""
    cfg = L.base_cfg()
    providers = cfg["llm"]["providers"]
    models = cfg["llm"]["models"]
    vms = cfg["llm"]["virtualModels"]
    for code in CODES:
        providers.append({"name": f"mock-sc{code}", "provider": "openAI",
                          "params": {"baseUrl": f"http://127.0.0.1:8099/sc{code}/v1",
                                     "apiKey": "test-key"}})
        models.append({"name": f"m-code-{code}", "visibility": "internal",
                       "provider": {"reference": f"mock-sc{code}"},
                       "params": {"model": f"code-{code}"}})
        vms.append({"name": f"vm-e14-{code}", "routing": {"failover": {"targets": [
            {"model": f"m-code-{code}", "priority": 1}, {"model": "m-ok", "priority": 2}]}}})
    providers.append({"name": "mock-sctimeout", "provider": "openAI",
                      "params": {"baseUrl": "http://127.0.0.1:8099/sctimeout/v1",
                                 "apiKey": "test-key"}})
    models.append({"name": "m-code-timeout", "visibility": "internal",
                   "provider": {"reference": "mock-sctimeout"},
                   "params": {"model": f"code-timeout-{STALL_SECONDS}"}})
    vms.append({"name": "vm-e14-timeout", "routing": {"failover": {"targets": [
        {"model": "m-code-timeout", "priority": 1}, {"model": "m-ok", "priority": 2}]}}})
    providers.append({"name": "mock-dead", "provider": "openAI",
                      "params": {"baseUrl": "http://127.0.0.1:8098/v1", "apiKey": "test-key"}})
    models.append({"name": "m-dead", "visibility": "internal",
                   "provider": {"reference": "mock-dead"}, "params": {"model": "code-200"}})
    vms.append({"name": "vm-e14-dead", "routing": {"failover": {"targets": [
        {"model": "m-dead", "priority": 1}, {"model": "m-ok", "priority": 2}]}}})
    vms.append({"name": "vm-e14b", "routing": {"failover": {"targets": [
        {"model": "m-ok", "priority": 1}]}}})
    if retry_layer:
        cfg["gateways"] = {"gw-lab": {"port": 3694, "bindAddress": "127.0.0.1"}}
        cfg["routes"] = [{"name": "retry-e14", "gateways": "gw-lab",
                          "matches": [{"path": {"pathPrefix": "/"}}],
                          "policies": {"retry": {"attempts": 2, "codes": RETRY_CODES,
                                                 "backoff": "100ms"}},
                          "backends": [{"host": "127.0.0.1:8099"}]}]
    return cfg


def post_plain(path: str, port: int = 3694, timeout: float = 30.0) -> dict:
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}",
                                 data=json.dumps({"ping": 1}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"status": resp.status, "body": resp.read().decode("utf-8", "replace")}
    except urllib.error.HTTPError as exc:
        return {"status": exc.code, "body": exc.read().decode("utf-8", "replace")}
    except Exception as exc:  # noqa: BLE001
        return {"status": None, "error": repr(exc)[:300]}


def post_llm_path(path: str, payload: dict, timeout: float = 30.0) -> dict:
    req = urllib.request.Request(L.LLM + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": f"Bearer {L.KEY}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"status": resp.status, "body": resp.read().decode("utf-8", "replace")}
    except urllib.error.HTTPError as exc:
        return {"status": exc.code, "body": exc.read().decode("utf-8", "replace")}
    except Exception as exc:  # noqa: BLE001
        return {"status": None, "error": repr(exc)[:300]}


def db_dump(attr_samples: int = 3) -> list[dict]:
    cols = ("id, trace_id, span_id, http_status, error, gen_ai_operation_name, "
            "gen_ai_provider_name, gen_ai_request_model, gen_ai_response_model, "
            "input_tokens, output_tokens, duration_ms, agentgateway_user")
    con = sqlite3.connect(f"file:{L.DB}?mode=ro", uri=True)
    names = [d[0] for d in con.execute(f"select {cols} from request_logs limit 1").description]
    rows = [dict(zip(names, map(str, r)))
            for r in con.execute(f"select {cols} from request_logs order by started_at").fetchall()]
    attrs = [str(r[0])[:220] for r in
             con.execute("select attributes_json from request_logs order by started_at "
                         f"limit {attr_samples}").fetchall()]
    con.close()
    for row in rows:
        row["trace_id"] = row["trace_id"][:18] or ""
        row["span_id"] = row["span_id"][:18] or ""
        row["id"] = row["id"][:36]
    return {"rows": rows, "attribute_samples": attrs}


def scenario_a() -> dict:
    cfg = e14_cfg(retry_layer=False)
    log = L.start_ag(cfg, fresh_db=True, tag="e14-a")
    matrix: dict = {}
    for code in CODES:
        L.mock_reset()
        trials = []
        for n in range(3):
            resp = L.post_json(f"vm-e14-{code}")
            time.sleep(0.15)
            trials.append({"n": n + 1, "status": resp.get("status"),
                           "body": (resp.get("body") or "")[:200],
                           "counters": L.mock_stats()})
        matrix[str(code)] = trials
    L.mock_reset()
    started = time.time()
    stall_resp = L.post_json("vm-e14-timeout", timeout=CLIENT_TIMEOUT)
    stall = {"client_wait_s": round(time.time() - started, 1), "result": stall_resp,
             "counters": L.mock_stats()}
    L.mock_reset()
    refused = []
    for n in range(3):
        resp = L.post_json("vm-e14-dead")
        time.sleep(0.15)
        refused.append({"n": n + 1, "status": resp.get("status"),
                        "body": (resp.get("body") or "")[:200], "counters": L.mock_stats()})
    time.sleep(1.5)
    logs = db_dump()
    tail = L.tail_log(log, 120)
    L.stop_ag()
    return {"matrix": matrix, "stall": stall, "conn_refused": refused,
            "request_logs": logs, "ag_log_tail": tail}


def scenario_b() -> dict:
    cfg = e14_cfg(retry_layer=True)
    val = L.validate(cfg, "e14-retry-layer")
    result: dict = {"validate": val,
                    "route_policies": {"retry": {"attempts": 2, "codes": RETRY_CODES,
                                                 "backoff": "100ms"}}}
    if val["exit"] != 0:
        return result
    log = L.start_ag(cfg, fresh_db=True, tag="e14-b")
    plain = {}
    for code in RETRY_CODES + [504]:
        L.mock_reset()
        resp = post_plain(f"/plain/{code}")
        time.sleep(0.4)
        plain[str(code)] = {"client": resp, "counters": L.mock_stats()}
    L.mock_reset()
    seq_resp = post_plain("/plain/seq-500-200")
    time.sleep(0.4)
    plain_seq = {"client": seq_resp, "counters": L.mock_stats()}
    llm = {}
    for code in RETRY_CODES + [504]:
        L.mock_reset()
        resp = L.post_json(f"vm-e14-{code}")
        time.sleep(0.4)
        llm[str(code)] = {"client": {"status": resp.get("status"),
                                     "body": (resp.get("body") or "")[:200]},
                          "counters": L.mock_stats()}
    time.sleep(1.5)
    logs = db_dump()
    tail = L.tail_log(log, 120)
    L.stop_ag()
    result.update({"plain": plain, "plain_seq": plain_seq, "llm_via_3692": llm,
                   "request_logs": logs, "ag_log_tail": tail})
    return result


def e14b() -> dict:
    cfg = e14_cfg(retry_layer=False)
    log = L.start_ag(cfg, fresh_db=True, tag="e14-nonchat")
    payloads = {
        "/v1/embeddings": {"model": "vm-e14b", "input": ["hello world"]},
        "/v1/images/generations": {"model": "vm-e14b", "prompt": "a cat", "n": 1},
        "/v1/systemone": {"model": "vm-e14b", "op": "query", "id": 7},
    }
    probes = []
    for path, payload in payloads.items():
        L.mock_reset()
        resp = post_llm_path(path, payload)
        time.sleep(0.4)
        entry = {"path": path, "model": "vm-e14b", "client": resp,
                 "counters": L.mock_stats()}
        if resp.get("status") not in (200, None):
            L.mock_reset()
            fallback = copy.deepcopy(payload)
            fallback["model"] = "m-ok"
            entry["fallback_model_m_ok"] = {"client": post_llm_path(path, fallback)}
            time.sleep(0.4)
            entry["fallback_counters"] = L.mock_stats()
        probes.append(entry)
    time.sleep(1.5)
    logs = db_dump()
    tail = L.tail_log(log, 80)
    L.stop_ag()
    return {"probes": probes, "request_logs": logs, "ag_log_tail": tail}


def main() -> int:
    L.ensure_mock()
    binary_meta = {"binary": str(L.AG), "version": "v1.7.0 (upstream --version prints 'True')",
                   "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
                   "sha256": BINARY_SHA256, "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"}
    try:
        a = scenario_a()
        a["binary"] = binary_meta
        L.save("E14a-status-matrix", a)
        b = scenario_b()
        b["binary"] = binary_meta
        L.save("E14a-route-retry-layer", b)
        c = e14b()
        c["binary"] = binary_meta
        L.save("E14b-nonchat-passthrough", c)
    finally:
        L.stop_ag()
    summary = {
        "scenario_a_codes": {c: [t["status"] for t in a["matrix"][c]]
                             for c in a["matrix"]},
        "scenario_a_request_log_rows": len(a["request_logs"]["rows"]),
        "scenario_b_validate_exit": b.get("validate", {}).get("exit"),
        "scenario_b_plain": {k: v["client"].get("status") for k, v in b.get("plain", {}).items()},
        "scenario_b_plain_seq": b.get("plain_seq", {}).get("client"),
        "scenario_b_llm": {k: v["client"].get("status") for k, v in b.get("llm_via_3692", {}).items()},
        "e14b": [{p["path"]: p["client"].get("status")} for p in c["probes"]],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
