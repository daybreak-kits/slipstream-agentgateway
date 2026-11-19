"""E16: AG 1.7 full form (gateways/routes/backends[].ai) - in-request retry / group failover
for LLM traffic. Mock upstream reused (port 8099): primary = pathPrefix /sc<code> + model
code-<code> (mock returns that status), backup = pathPrefix /ok + model model-ok (200).

Scenarios:
  A0  baseline (no retry, no health): primary 500 -> client status? same-request group2 hit?
  A1  route-level retry (attempts=2, codes=[429,500,502,503]): primary 500 -> retry/failover?
      401 control: primary 401 (not in codes) -> pass-through expected.
  A2  backend-level retry: schema rejects (boundary evidence, --validate-only only).
  A3  group failover: covered by A0 (no retry) + A1 (retry) counters; own run for logs.
  A4  health.unhealthyExpression 'response.code >= 400': 4xx eviction vs default control.

Run:  python e16_full_form.py
"""
from __future__ import annotations

import json
import sqlite3
import time

import lab as L

RETRY_CODES = [429, 500, 502, 503]
BINARY_SHA256 = "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c"


def full_cfg(primary_model: str = "code-500", primary_prefix: str = "/sc500",
             retry: dict | None = None, health: dict | None = None,
             backend_policies: dict | None = None) -> dict:
    """gateways + one AI route: group1 = controllable-status provider, group2 = ok provider."""
    g1 = {"name": "p-fail", "hostOverride": "127.0.0.1:8099",
          "pathPrefix": primary_prefix, "provider": {"openAI": {"model": primary_model}}}
    g2 = {"name": "p-ok", "hostOverride": "127.0.0.1:8099",
          "pathPrefix": "/ok", "provider": {"openAI": {"model": "model-ok"}}}
    backend: dict = {"ai": {"groups": [{"providers": [g1]}, {"providers": [g2]}]}}
    if health or backend_policies:
        pol = dict(backend_policies or {})
        if health:
            pol["health"] = health
        backend["policies"] = pol
    route: dict = {"name": "ai-e16", "gateways": "gw-e16",
                   "matches": [{"path": {"pathPrefix": "/v1/chat/completions"}}],
                   "backends": [backend]}
    if retry:
        route["policies"] = {"retry": retry}
    return {
        "config": {"adminAddr": "127.0.0.1:3921", "statsAddr": "127.0.0.1:3922",
                   "readinessAddr": "127.0.0.1:3923",
                   "database": {"url": "sqlite://data.db"}, "storage": {"mode": "file"}},
        "gateways": {"gw-e16": {"port": 3692, "bindAddress": "127.0.0.1"}},
        "routes": [route],
        "frontendPolicies": {"accessLog": {"database": {"llm": "full"}}},
    }


def db_dump() -> dict:
    cols = ("id, trace_id, span_id, http_status, error, gen_ai_operation_name, "
            "gen_ai_provider_name, gen_ai_request_model, gen_ai_response_model, "
            "input_tokens, output_tokens, duration_ms, agentgateway_user")
    con = sqlite3.connect(f"file:{L.DB}?mode=ro", uri=True)
    names = [d[0] for d in con.execute(f"select {cols} from request_logs limit 1").description]
    rows = [dict(zip(names, map(str, r)))
            for r in con.execute(f"select {cols} from request_logs order by started_at").fetchall()]
    attrs = [str(r[0])[:260] for r in
             con.execute("select attributes_json from request_logs order by started_at "
                         "limit 4").fetchall()]
    con.close()
    for row in rows:
        row["id"] = row["id"][:8]
        row["trace_id"] = row["trace_id"][:12]
        row["span_id"] = row["span_id"][:12]
    return {"row_count": len(rows), "rows": rows, "attribute_samples": attrs}


def run_trials(cfg: dict, count: int, tag: str, sleep: float = 0.4) -> dict:
    """Start AG with cfg, run `count` single-request trials (reset counters before each),
    capture request_logs and log tail, stop AG. Returns evidence dict."""
    val = L.validate(cfg, tag)
    out = {"validate": val, "config": cfg}
    if val["exit"] != 0:
        return out
    log = L.start_ag(cfg, fresh_db=True, tag=tag)
    trials = []
    for n in range(count):
        L.mock_reset()
        resp = L.post_json("vm-e16")
        time.sleep(sleep)
        trials.append({"n": n + 1, "status": resp.get("status"),
                       "body": (resp.get("body") or "")[:200],
                       "counters": L.mock_stats()})
    time.sleep(1.5)
    out["trials"] = trials
    out["request_logs"] = db_dump()
    out["ag_log_tail"] = L.tail_log(log, 90)
    L.stop_ag()
    return out


def scenario_a0() -> dict:
    """Baseline: no retry, no health. primary 500 -> does group2 get hit in-request?"""
    return run_trials(full_cfg(), 4, "E16-A0-baseline")


def scenario_a1() -> dict:
    """Route-level retry. primary 500 (codes include 500) + 401 control (not in codes)."""
    retry = {"attempts": 2, "codes": RETRY_CODES, "backoff": "100ms"}
    out = {"retry_policy": retry}
    out["sc500"] = run_trials(full_cfg(retry=retry), 4, "E16-A1-route-retry")
    out["sc401_control"] = run_trials(
        full_cfg(primary_model="code-401", primary_prefix="/sc401", retry=retry),
        3, "E16-A1-401-control")
    out["sc401_in_codes"] = run_trials(
        full_cfg(primary_model="code-401", primary_prefix="/sc401c",
                 retry={"attempts": 2, "codes": [401, 429, 500, 502, 503],
                        "backoff": "100ms"}),
        4, "E16-A1-401-in-codes")
    out["sc429_in_codes"] = run_trials(
        full_cfg(primary_model="code-429", primary_prefix="/sc429",
                 retry={"attempts": 2, "codes": [429, 500, 502, 503],
                        "backoff": "100ms"}),
        4, "E16-A1-429-in-codes")
    return out


def scenario_a2() -> dict:
    """Backend-level retry: schema rejection evidence (validate-only, no run)."""
    retry = {"attempts": 2, "codes": RETRY_CODES, "backoff": "100ms"}
    cases = {
        "backend_policies_retry": full_cfg(backend_policies={"retry": retry}),
        "provider_policies_retry": full_cfg(),
    }
    cases["provider_policies_retry"]["routes"][0]["backends"][0]["ai"]["groups"][0][
        "providers"][0]["policies"] = {"retry": retry}
    report: dict = {}
    for name, cfg in cases.items():
        report[name] = L.validate(cfg, f"E16-A2-{name}")
    report["schema_note"] = (
        "LocalBackendPolicies has no retry field (schema check); retry exists only in "
        "FilterOrPolicy (route policies).")
    return report


def scenario_a3() -> dict:
    """Group failover without retry (same shape as A0, dedicated run with more trials)."""
    return run_trials(full_cfg(), 6, "E16-A3-group-failover")


def scenario_a4() -> dict:
    """health.unhealthyExpression probes on the AI route."""
    out: dict = {}
    out["no_health_control"] = run_trials(
        full_cfg(primary_model="code-401", primary_prefix="/sc401"), 3, "E16-A4-control")
    out["with_health_4xx"] = run_trials(
        full_cfg(primary_model="code-401", primary_prefix="/sc401",
                 health={"unhealthyExpression": "response.code >= 400"}),
        4, "E16-A4-health-4xx")
    out["expr_true_200"] = run_trials(
        full_cfg(primary_model="model-ok", primary_prefix="/ok2",
                 health={"unhealthyExpression": "true"}),
        3, "E16-A4-expr-true")
    out["expr_true_200_evict1"] = run_trials(
        full_cfg(primary_model="model-ok", primary_prefix="/ok3",
                 health={"unhealthyExpression": "true",
                         "eviction": {"consecutiveFailures": 1}}),
        3, "E16-A4-expr-true-evict1")
    out["expr_ge400_5xx"] = run_trials(
        full_cfg(primary_model="code-500", primary_prefix="/sc500b",
                 health={"unhealthyExpression": "response.code >= 400"}),
        4, "E16-A4-expr-5xx")
    out["expr_ge400_401_evict1"] = run_trials(
        full_cfg(primary_model="code-401", primary_prefix="/sc401b",
                 health={"unhealthyExpression": "response.code >= 400",
                         "eviction": {"consecutiveFailures": 1}}),
        4, "E16-A4-expr-401-evict1")
    return out


def scenario_a5() -> dict:
    """Route retry with BOTH providers in ONE group (same-group switch): fail + ok in group1."""
    retry = {"attempts": 2, "codes": RETRY_CODES, "backoff": "100ms"}
    cfg = full_cfg(retry=retry)
    cfg["routes"][0]["backends"][0]["ai"]["groups"] = [{"providers": [
        {"name": "p-fail", "hostOverride": "127.0.0.1:8099", "pathPrefix": "/sc500",
         "provider": {"openAI": {"model": "code-500"}}},
        {"name": "p-ok", "hostOverride": "127.0.0.1:8099", "pathPrefix": "/ok",
         "provider": {"openAI": {"model": "model-ok"}}},
    ]}]
    return run_trials(cfg, 6, "E16-A5-same-group-switch")


def main() -> int:
    L.ensure_mock()
    binary = {"binary": str(L.AG), "version": "v1.7.0 (upstream --version prints 'True')",
              "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
              "sha256": BINARY_SHA256,
              "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"}
    try:
        a0 = scenario_a0()
        a1 = scenario_a1()
        a2 = scenario_a2()
        a3 = scenario_a3()
        a4 = scenario_a4()
        a5 = scenario_a5()
    finally:
        L.stop_ag()
    for name, payload in (("E16-A0-baseline", a0), ("E16-A1-route-retry", a1),
                          ("E16-A2-backend-retry", a2), ("E16-A3-group-failover", a3),
                          ("E16-A4-health-4xx", a4), ("E16-A5-same-group-switch", a5)):
        payload["binary"] = binary
        L.save(name, payload)
    summary = {
        "A0": [(t["status"], t["counters"]) for t in a0.get("trials", [])],
        "A1_sc500": [(t["status"], t["counters"]) for t in a1.get("sc500", {}).get("trials", [])],
        "A1_401": [(t["status"], t["counters"]) for t in a1.get("sc401_control", {}).get("trials", [])],
        "A1_401_in_codes": [(t["status"], t["counters"]) for t in a1.get("sc401_in_codes", {}).get("trials", [])],
        "A1_429_in_codes": [(t["status"], t["counters"]) for t in a1.get("sc429_in_codes", {}).get("trials", [])],
        "A2": {k: v["exit"] for k, v in a2.items() if isinstance(v, dict) and "exit" in v},
        "A3": [(t["status"], t["counters"]) for t in a3.get("trials", [])],
        "A4_no_health": [(t["status"], t["counters"]) for t in a4.get("no_health_control", {}).get("trials", [])],
        "A4_with_health": [(t["status"], t["counters"]) for t in a4.get("with_health_4xx", {}).get("trials", [])],
        "A4_expr_true_200": [(t["status"], t["counters"]) for t in a4.get("expr_true_200", {}).get("trials", [])],
        "A4_expr_true_200_evict1": [(t["status"], t["counters"]) for t in a4.get("expr_true_200_evict1", {}).get("trials", [])],
        "A4_expr_ge400_5xx": [(t["status"], t["counters"]) for t in a4.get("expr_ge400_5xx", {}).get("trials", [])],
        "A4_expr_ge400_401_evict1": [(t["status"], t["counters"]) for t in a4.get("expr_ge400_401_evict1", {}).get("trials", [])],
        "A5": [(t["status"], t["counters"]) for t in a5.get("trials", [])],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())