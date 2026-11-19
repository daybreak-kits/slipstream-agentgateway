"""E17 T1: real-upstream auth channel in AG v1.7 full form.

Matrix
  A0 validate-only for every config shape (schema acceptance recorded as-is)
  A1 mock header-shape matrix: backendAuth bare / credentials no-prefix /
     credentials prefix / absent -> what AG actually sends upstream
  A2 real NVIDIA key via backendAuth {key:{file}} + backendTLS -> 200 + rows
  A3 real NVIDIA key via credentials header prefix Bearer -> 200
  A4 wrong key -> upstream 401 body compared verbatim with a direct upstream call
  A5 route-level client apiKey (FilterOrPolicy.apiKey, LocalAPIKeys) sanity
  A6 dial hazard: hostOverride host:port without backendTLS (plain HTTP to :443)
  A7 OpenRouter :free availability direct (blocked today) + prior full-form panic
"""
from __future__ import annotations

import json
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))
import e17_common as C

ENV = C.load_env()
T1 = C.TMPROOT / "t1"
NVIDIA_HOST = "integrate.api.nvidia.com"
NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"
NVIDIA_MODEL_CANDIDATES = [NVIDIA_MODEL, "meta/llama-3.1-8b-instruct",
                           "nvidia/llama-3.1-nemotron-70b-instruct"]
OR_MODEL = "nvidia/nemotron-3.5-lightning:free"
FAKE_BAD_KEY = "nvapi-e17-invalid-key-0000"
FAKE_SYNTH = "sk-e17-synthetic-shape-key-1234"
OUT = {"title": "E17 T1 real-upstream auth in full form", "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z")}


def direct_post(url, key, model, timeout=60):
    body = json.dumps({"model": model,
                       "messages": [{"role": "user", "content": "hi"}],
                       "max_tokens": 8}).encode()
    req = urllib.request.Request(url, data=body,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {"status": r.status,
                    "headers": {k.lower(): v for k, v in dict(r.headers).items()},
                    "body": C.mask_text(r.read().decode("utf-8", "replace"))[:800]}
    except urllib.error.HTTPError as e:
        return {"status": e.code,
                "headers": {k.lower(): v for k, v in dict(e.headers).items()},
                "body": C.mask_text(e.read().decode("utf-8", "replace"))[:800]}
    except Exception as e:  # noqa: BLE001
        return {"status": None, "error": C.mask_text(repr(e))[:300]}


def main():
    mock = C.MockServer("t1-mock", {
        "/shape-bare": "echo", "/shape-cred": "echo",
        "/shape-cred-bearer": "echo", "/shape-none": "echo",
        "/api-key": "ok"}).start()
    h = C.Harness("t1", "T1", port=3692, admin=(3921, 3922, 3923))
    key_nv = C.write_key(h.workdir, "nvidia_good", ENV["NVIDIA_API_KEY"])
    key_or = C.write_key(h.workdir, "openrouter", ENV["OPENROUTER_API_KEY"])
    key_bad = C.write_key(h.workdir, "nvidia_bad", FAKE_BAD_KEY)
    key_syn = C.write_key(h.workdir, "synthetic", FAKE_SYNTH)
    out = OUT
    out["env"] = {
        "nvidia_base_url": ENV.get("NVIDIA_BASE_URL"),
        "openrouter_base_url": ENV.get("OPENROUTER_BASE_URL"),
        "client_key_shape": "Bearer sk-ss-lab-client-0001 (lab synthetic)",
        "key_facts": {
            "nvidia_len": len(ENV["NVIDIA_API_KEY"]),
            "nvidia_prefix_ok": ENV["NVIDIA_API_KEY"].startswith("nvapi-"),
            "nvidia_dots": ENV["NVIDIA_API_KEY"].count("."),
            "openrouter_len": len(ENV["OPENROUTER_API_KEY"]),
            "openrouter_prefix_ok": ENV["OPENROUTER_API_KEY"].startswith("sk-or-")}}
    # direct preflight: is the NVIDIA key + model valid outside AG?
    pre = []
    chosen_model = None
    for model in NVIDIA_MODEL_CANDIDATES:
        r = direct_post("https://" + NVIDIA_HOST + "/v1/chat/completions",
                        ENV["NVIDIA_API_KEY"], model)
        pre.append({"model": model, "status": r.get("status"),
                    "body_head": r.get("body", "")[:160]})
        if r.get("status") == 200:
            chosen_model = model
            break
    out["nvidia_direct_preflight"] = {"model_chosen": chosen_model, "attempts": pre}
    if not chosen_model:
        print("FATAL: no NVIDIA model works directly", json.dumps(pre)[:500])
        return 2
    out["models_used"] = {"nvidia": chosen_model, "openrouter": OR_MODEL}

    def cfg_real(auth, key_file, tls=True, host=NVIDIA_HOST + ":443", model=None):
        pr = C.prov("nvidia", host, model or chosen_model, key_file=key_file,
                    tls_hostname=NVIDIA_HOST if tls else None, auth=auth)
        return C.full_form_config(h, [[pr]])

    # ---------------- A0 validate-only matrix
    val = {}
    cfg_bare = cfg_real("bare", key_nv)
    val["real_bare_tls"] = h.validate(cfg_bare, "t1-real-bare")
    val["real_cred_bearer"] = h.validate(cfg_real("cred_bearer", key_nv), "t1-real-cred")
    val["real_badkey"] = h.validate(cfg_real("bare", key_bad), "t1-real-badkey")
    val["host_no_port"] = h.validate(
        C.full_form_config(h, [[C.prov("nvidia", NVIDIA_HOST, chosen_model,
                                      key_file=key_nv, tls_hostname=NVIDIA_HOST)]]),
        "t1-host-noport")
    val["plain_http_no_tls"] = h.validate(cfg_real("bare", key_nv, tls=False), "t1-notls")
    shape_cfgs = {}
    for case, auth, prefix in [("bare", "bare", "/shape-bare"),
                               ("cred", "cred", "/shape-cred"),
                               ("cred_bearer", "cred_bearer", "/shape-cred-bearer"),
                               ("none", None, "/shape-none")]:
        p = C.prov("mock-" + case, mock.host(), "mock-model", key_file=key_syn,
                   path_prefix=prefix, auth=auth)
        shape_cfgs[case] = C.full_form_config(h, [[p]])
        val["shape_" + case] = h.validate(shape_cfgs[case], "t1-shape-" + case)
    # route-level client apiKey config
    cfg_apikey = C.full_form_config(
        h, [[C.prov("mock", mock.host(), "mock-model", key_file=key_syn,
                    path_prefix="/api-key", auth="bare")]])
    cfg_apikey["routes"][0]["policies"] = {
        "apiKey": {"keys": [{"key": C.CLIENT_KEY}], "mode": "required"}}
    val["client_apikey"] = h.validate(cfg_apikey, "t1-client-apikey")
    out["validate"] = val

    # ---------------- A1 mock header shape matrix
    shape_rows = []
    for case, auth, prefix in [("bare", "bare", "/shape-bare"),
                               ("cred", "cred", "/shape-cred"),
                               ("cred_bearer", "cred_bearer", "/shape-cred-bearer"),
                               ("none", None, "/shape-none")]:
        h.start(shape_cfgs[case], "T1-shape-" + case)
        try:
            r = h.post()
        finally:
            h.stop()
        hit = mock.hits[-1] if mock.hits else {}
        shape_rows.append({
            "case": case,
            "expected": {
                "bare": "Authorization: Bearer <provider key>",
                "cred": "Authorization: <raw provider key>",
                "cred_bearer": "Authorization: Bearer <provider key>",
                "none": "client Authorization forwarded upstream (security note)"}[case],
            "client_status": r.get("status"),
            "upstream_path": hit.get("path"),
            "upstream_auth_observed": hit.get("auth"),
            "hit_prefix": hit.get("prefix")})
    out["shape_matrix"] = {"rows": shape_rows,
                           "mock_stats": mock.stats(),
                           "configs": {k: C._strip_key_files(v) for k, v in shape_cfgs.items()}}

    # ---------------- A2 real NVIDIA bare key -> 200
    real_bare = {}
    h.start(cfg_bare, "T1-real-bare")
    try:
        r = h.post()
        real_bare["client"] = {k: r.get(k) for k in ("status", "body", "duration_s", "error")}
        real_bare["request_logs"] = h.db_dump()
    finally:
        h.stop()
    out["real_bare_200"] = real_bare

    # ---------------- A3 real NVIDIA cred_bearer -> 200
    real_cred = {}
    h.start(cfg_real("cred_bearer", key_nv), "T1-real-cred")
    try:
        r = h.post()
        real_cred["client"] = {k: r.get(k) for k in ("status", "body", "duration_s", "error")}
        real_cred["request_logs"] = h.db_dump()
    finally:
        h.stop()
    out["real_cred_bearer_200"] = real_cred

    # ---------------- A4 wrong key -> 401 verbatim
    wrong = {}
    cfg_bad = cfg_real("bare", key_bad)
    h.start(cfg_bad, "T1-real-badkey")
    try:
        r = h.post()
        wrong["client"] = {k: r.get(k) for k in ("status", "body", "duration_s", "error")}
        wrong["request_logs"] = h.db_dump()
    finally:
        h.stop()
    direct401 = direct_post("https://" + NVIDIA_HOST + "/v1/chat/completions",
                            FAKE_BAD_KEY, chosen_model)
    wrong["direct_upstream"] = {"status": direct401.get("status"),
                                "body": direct401.get("body")}
    cb = (wrong["client"].get("body") or "").strip()
    db = (direct401.get("body") or "").strip()
    wrong["verbatim_equal"] = bool(cb) and cb == db
    wrong["status_equal"] = wrong["client"].get("status") == direct401.get("status")
    out["wrong_key_401"] = {"config": C._strip_key_files(cfg_bad), **wrong}

    # ---------------- A5 route-level client apiKey
    client_auth = {}
    if val.get("client_apikey", {}).get("exit") == 0:
        h.start(cfg_apikey, "T1-client-apikey")
        try:
            ok = h.post()
            bad = h.post(client_key="sk-wrong-client-key")
            noauth = h.post(client_key=None)
            client_auth = {
                "with_valid_client_key": {k: ok.get(k) for k in ("status", "body", "error")},
                "with_wrong_client_key": {k: bad.get(k) for k in ("status", "body", "error")},
                "without_client_key": {k: noauth.get(k) for k in ("status", "body", "error")},
                "mock_stats": mock.stats()}
        finally:
            h.stop()
    out["client_apikey"] = {"config": C._strip_key_files(cfg_apikey),
                            "schema_accepted": val.get("client_apikey", {}).get("exit") == 0,
                            **client_auth}

    # ---------------- A6 dial hazard: plain HTTP to TLS port
    dial = {}
    cfg_notls = cfg_real("bare", key_nv, tls=False)
    h.start(cfg_notls, "T1-notls")
    try:
        r = h.post()
        dial["client"] = {k: r.get(k) for k in ("status", "body", "error", "duration_s")}
    finally:
        h.stop()
    dial["config"] = C._strip_key_files(cfg_notls)
    dial["note"] = "hostOverride host:port without policies.backendTLS => plain HTTP dial to :443; upstream rejects"
    out["dial_hazard_plain_http"] = dial

    # ---------------- A7 OpenRouter :free direct availability today
    orr = direct_post("https://openrouter.ai/api/v1/chat/completions",
                      ENV["OPENROUTER_API_KEY"], OR_MODEL, timeout=90)
    rl = {k: v for k, v in (orr.get("headers") or {}).items()
          if k.startswith("x-ratelimit") or k == "retry-after"}
    out["openrouter_direct"] = {"status": orr.get("status"), "body": orr.get("body"),
                                "ratelimit_headers": rl,
                                "note": "if 429 daily-free quota -> T3 cannot use OR as real backup today"}
    prior = []
    for log_name, label in [("ag-probe3-api_bare.log", "pathPrefix=/api"),
                            ("ag-probe4-apiv1_bare.log", "pathPrefix=/api/v1")]:
        p = T1 / log_name
        if p.exists():
            txt = C.mask_text(p.read_text(errors="replace"))
            lines = [ln for ln in txt.splitlines()
                     if "panic" in ln.lower() or "overflow" in ln.lower()
                     or "outlierdetection" in ln.lower() or "429" in ln]
            prior.append({"log": log_name, "label": label, "hits": lines[:12]})
    out["openrouter_prior_probe"] = prior

    # ---------------- save evidence + key-leak self check
    out["key_leak_scan"] = {"files": [], "clean": True}
    h.save("T1-shape", {"section": "T1-A1 mock header shape matrix",
                        "rows": shape_rows, "validate": {k: val[k] for k in val if k.startswith("shape_")},
                        "configs": {k: C._strip_key_files(v) for k, v in shape_cfgs.items()}})
    h.save("T1-real", {"section": "T1-A2/A3 real NVIDIA upstream auth 200",
                       "bare": real_bare, "cred_bearer": real_cred,
                       "config": C._strip_key_files(cfg_bare),
                       "config_cred": C._strip_key_files(cfg_real("cred_bearer", key_nv))})
    h.save("T1-wrongkey", {"section": "T1-A4 wrong key 401 passthrough", **out["wrong_key_401"]})
    h.save("T1-dial", {"section": "T1-A6 hostOverride/TLS dial hazards",
                       "host_no_port_validate": val["host_no_port"],
                       "plain_http_run": dial,
                       "config": C._strip_key_files(cfg_notls)})
    h.save("T1-clientauth", {"section": "T1-A5 route-level client apiKey",
                             "schema_accepted": out["client_apikey"].get("schema_accepted"),
                             "validate": val["client_apikey"],
                             "run": {k: v for k, v in out["client_apikey"].items()
                                     if k not in ("config", "schema_accepted")},
                             "config": C._strip_key_files(cfg_apikey)})
    h.save("T1-openrouter", {"section": "T1-A7 OpenRouter availability + AG panic seen in probe",
                             "direct": out["openrouter_direct"],
                             "prior_probe": prior,
                             "impact_on_T3": "if 429 daily free quota exhausted, OR cannot be the real backup today; T3 substitutes a second real NVIDIA provider"})
    # scan evidence for real key material
    leaked = []
    for p in sorted(C.EVID.glob("E17-T1*.json.md")) + sorted(C.EVID.glob("cfg-E17-T1*.yaml")):
        txt = p.read_text(encoding="utf-8")
        if C.has_secret(txt):
            leaked.append(str(p))
    out["key_leak_scan"] = {"files": [p.name for p in C.EVID.glob("*E17-T1*")],
                            "clean": not leaked, "leaked": leaked}
    print(json.dumps({
        "validate_exits": {k: v.get("exit") for k, v in val.items()},
        "shape": [{"case": r["case"], "status": r["client_status"],
                   "auth": r["upstream_auth_observed"]} for r in shape_rows],
        "real_bare": {"status": real_bare["client"]["status"],
                      "body": real_bare["client"]["body"][:200],
                      "rows": real_bare["request_logs"]["row_count"],
                      "row0": real_bare["request_logs"]["rows"][:1]},
        "cred_bearer": {"status": real_cred["client"]["status"]},
        "wrong_key": {"ag_status": wrong["client"].get("status"),
                      "direct_status": direct401.get("status"),
                      "verbatim_equal": wrong["verbatim_equal"],
                      "ag_body": wrong["client"].get("body")},
        "client_apikey": {k: v.get("status") for k, v in client_auth.items() if isinstance(v, dict)},
        "dial": {"status": dial["client"].get("status"),
                 "body": (dial["client"].get("body") or dial["client"].get("error") or "")[:200]},
        "openrouter": {"status": orr.get("status"), "body": (orr.get("body") or "")[:300],
                       "rl": rl},
        "leak": out["key_leak_scan"]}, indent=1, ensure_ascii=False, default=str)[:6000])
    return 0


if __name__ == "__main__":
    try:
        code = main()
    finally:
        C.cleanup_keys(C.TMPROOT / "t1")
    sys.exit(code or 0)
