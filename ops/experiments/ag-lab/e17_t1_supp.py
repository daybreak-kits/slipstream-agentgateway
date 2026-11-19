"""E17 T1 supplement: full validate matrix, client apiKey (mode strict), 401-format wrong key."""
from __future__ import annotations

import json
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
BAD_401 = "sk-e17-invalid-key-0000"
FAKE_BAD = "nvapi-e17-invalid-key-0000"
FAKE_SYNTH = "sk-e17-synthetic-shape-key-1234"


def direct_post(url, key, model, timeout=60):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": "hi"}],
                       "max_tokens": 8}).encode()
    req = urllib.request.Request(url, data=body,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {"status": r.status,
                    "body": C.mask_text(r.read().decode("utf-8", "replace"))[:800]}
    except urllib.error.HTTPError as e:
        return {"status": e.code,
                "body": C.mask_text(e.read().decode("utf-8", "replace"))[:800]}
    except Exception as e:  # noqa: BLE001
        return {"status": None, "error": C.mask_text(repr(e))[:300]}


def main():
    h = C.Harness("t1", "T1", port=3692, admin=(3921, 3922, 3923))
    key_nv = C.write_key(h.workdir, "nvidia_good", ENV["NVIDIA_API_KEY"])
    key_bad = C.write_key(h.workdir, "nvidia_bad", FAKE_BAD)
    key_401 = C.write_key(h.workdir, "nvidia_401", BAD_401)
    key_syn = C.write_key(h.workdir, "synthetic", FAKE_SYNTH)
    mock = C.MockServer("t1-supp-mock", {"/api-key": "ok"}).start()
    out = {}

    def cfg_real(auth, key_file, tls=True, host=NVIDIA_HOST + ":443"):
        pr = C.prov("nvidia", host, NVIDIA_MODEL, key_file=key_file,
                    tls_hostname=NVIDIA_HOST if tls else None, auth=auth)
        return C.full_form_config(h, [[pr]])

    cfg_bare = cfg_real("bare", key_nv)
    val = {
        "real_bare_tls": h.validate(cfg_bare, "supp-real-bare"),
        "real_cred_bearer": h.validate(cfg_real("cred_bearer", key_nv), "supp-real-cred"),
        "real_badkey_403shape": h.validate(cfg_real("bare", key_bad), "supp-real-bad403"),
        "real_badkey_401shape": h.validate(cfg_real("bare", key_401), "supp-real-bad401"),
        "host_no_port": h.validate(
            C.full_form_config(h, [[C.prov("nvidia", NVIDIA_HOST, NVIDIA_MODEL,
                                          key_file=key_nv, tls_hostname=NVIDIA_HOST)]]),
            "supp-host-noport"),
        "plain_http_no_tls": h.validate(cfg_real("bare", key_nv, tls=False), "supp-notls"),
        "tls_without_hostname": h.validate(
            C.full_form_config(h, [[C.prov("nvidia", NVIDIA_HOST + ":443", NVIDIA_MODEL,
                                          key_file=key_nv)]]), "supp-tls-nohost"),
    }
    out["validate"] = {k: {"exit": v["exit"], "stderr": v["stderr"]} for k, v in val.items()}
    h.save("T1-validate", {"section": "T1-A0 validate-only matrix",
                           "validate": out["validate"],
                           "config": C._strip_key_files(cfg_bare),
                           "schema_facts": {
                               "provider_auth": "LocalNamedAIProvider has NO auth field; upstream auth = policies.backendAuth (BackendAuthCompat)",
                               "backendAuth_bare": "{key:{file}} -> Authorization: Bearer <key>",
                               "backendAuth_credentials": "{credentials:[{location:{header:{name,prefix}}, key:{file}}]}",
                               "hostOverride": "must be host:port (schema regex/enforcement); no scheme",
                               "backendTLS": "presence switches dial to TLS; hostname used as SNI/verify",
                               "route_client_apiKey_mode_enum": ["strict", "optional", "permissive"],
                               "retry": "route-level FilterOrPolicy.retry only (attempts/codes/backoff/...)",
                               "health": "unhealthyExpression + eviction.consecutiveFailures together"}})

    # client apiKey with mode strict
    cfg_apikey = C.full_form_config(
        h, [[C.prov("mock", mock.host(), "mock-model", key_file=key_syn,
                    path_prefix="/api-key", auth="bare")]])
    cfg_apikey["routes"][0]["policies"] = {
        "apiKey": {"keys": [{"key": C.CLIENT_KEY}], "mode": "strict"}}
    v = h.validate(cfg_apikey, "supp-client-apikey")
    client_auth = {"validate": {"exit": v["exit"], "stderr": v["stderr"]}}
    if v["exit"] == 0:
        h.start(cfg_apikey, "T1-client-apikey-strict")
        try:
            ok = h.post()
            bad = h.post(client_key="sk-wrong-client-key")
            none = h.post(client_key=None)
            client_auth["run"] = {
                "valid_client_key": {k: ok.get(k) for k in ("status", "body", "error")},
                "wrong_client_key": {k: bad.get(k) for k in ("status", "body", "error")},
                "no_client_key": {k: none.get(k) for k in ("status", "body", "error")},
                "mock_stats": mock.stats()}
        finally:
            h.stop()
    h.save("T1-clientauth2", {"section": "T1-A5b route-level client apiKey (mode strict)",
                              "schema_accepted": v["exit"] == 0,
                              **client_auth,
                              "config": C._strip_key_files(cfg_apikey)})

    # wrong key 401 shape: AG passthrough vs direct
    cfg_401 = cfg_real("bare", key_401)
    h.start(cfg_401, "T1-real-bad401")
    try:
        r = h.post()
        ag = {k: r.get(k) for k in ("status", "body", "error", "duration_s")}
        rows = h.db_dump()
    finally:
        h.stop()
    direct = direct_post("https://" + NVIDIA_HOST + "/v1/chat/completions", BAD_401, NVIDIA_MODEL)
    verbatim = bool(ag.get("body")) and (ag["body"] or "").strip() == (direct.get("body") or "").strip()
    h.save("T1-wrongkey2", {"section": "T1-A4b wrong key (401 shape) passthrough verbatim",
                            "ag_client": ag, "direct_upstream": direct,
                            "status_equal": ag.get("status") == direct.get("status"),
                            "verbatim_equal": verbatim,
                            "request_logs": rows,
                            "config": C._strip_key_files(cfg_401)})
    out["wrongkey2"] = {"ag_status": ag.get("status"), "direct_status": direct.get("status"),
                        "verbatim_equal": verbatim, "ag_body": ag.get("body")}
    # evidence-wide key leak scan (json.md + yaml + ag logs)
    leaked = []
    for p in sorted(C.EVID.glob("*E17-T1*")):
        if p.is_file() and C.has_secret(p.read_text(encoding="utf-8", errors="replace")):
            leaked.append(p.name)
    out["key_leak_scan_all_evidence"] = {"clean": not leaked, "leaked": leaked,
                                         "scanned": len(list(C.EVID.glob("*E17-T1*")))}
    print(json.dumps(out, indent=1, ensure_ascii=False, default=str)[:5000])
    return 0


if __name__ == "__main__":
    try:
        code = main()
    finally:
        C.cleanup_keys(C.TMPROOT / "t1")
    sys.exit(code or 0)
