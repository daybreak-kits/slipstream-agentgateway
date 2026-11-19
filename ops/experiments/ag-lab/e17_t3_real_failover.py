"""E17 T3: real upstream + retry group failover chain (full form).

Intended topology (per task): primary = real NVIDIA with a wrong key (401),
backup = real OpenRouter :free.  OpenRouter :free is BLOCKED today (429 daily
free-tier quota exhausted, see evidence/E17-T1-openrouter.json.md), so the
backup is a second real NVIDIA provider with the good key, fronted by a second
counting proxy; both upstreams are real and network-reachable. This substitution
(and the AG panic seen when OpenRouter was reached) is recorded as evidence.

Topology per trial:
  client -> AG route (retry codes=[401,429,500,502,503]) -> group1: provider
  nvidia-bad  -> 127.0.0.1 proxy A (plain in / TLS out) -> integrate.api.nvidia.com
                     -> group2: provider nvidia-good -> proxy B -> real NVIDIA
Hit matrix = proxy A hits vs proxy B hits. Client result recorded both ways.
Variants: codes-only (attempts=2) and codes+health+eviction triple.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))
import e17_common as C

ENV = C.load_env()
NVIDIA_HOST = "integrate.api.nvidia.com"
NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"
BAD_401_KEY = "sk-e17-invalid-key-0000"
OUT = {"title": "E17 T3 real upstream retry group failover", "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z")}


def main():
    h = C.Harness("t3", "T3", port=3692, admin=(3921, 3922, 3923))
    key_good = C.write_key(h.workdir, "nvidia_good", ENV["NVIDIA_API_KEY"])
    key_bad = C.write_key(h.workdir, "nvidia_bad401", BAD_401_KEY)
    p_bad = C.Proxy(NVIDIA_HOST, 443, tls=True, kills=0, name="nv-primary").start()
    p_good = C.Proxy(NVIDIA_HOST, 443, tls=True, kills=0, name="nv-backup").start()
    out = OUT
    out["topology"] = {
        "primary": {"provider": "nvidia-bad", "hostOverride": p_bad.host(),
                    "key": "wrong key (401 shape)", "path": "proxy A TLS->integrate.api.nvidia.com"},
        "backup": {"provider": "nvidia-good", "hostOverride": p_good.host(),
                   "key": "real NVIDIA key", "path": "proxy B TLS->integrate.api.nvidia.com"},
        "openrouter_blocked": "OR :free daily quota exhausted (429); AG panicked when OR was reached in probe (outlierdetection.rs overflow)",
        "model": NVIDIA_MODEL,
        "retry": "codes=[401,429,500,502,503] attempts=2 backoff=50ms (route-level)"}

    prov_bad = C.prov("nvidia-bad", p_bad.host(), NVIDIA_MODEL, key_file=key_bad, auth="bare")
    prov_good = C.prov("nvidia-good", p_good.host(), NVIDIA_MODEL, key_file=key_good, auth="bare")
    cfg_s1 = C.full_form_config(h, [[prov_bad], [prov_good]],
                                retry=C.retry_policy([401, 429, 500, 502, 503],
                                                      attempts=2, backoff="50ms"))
    cfg_s2 = C.full_form_config(h, [[prov_bad], [prov_good]],
                                retry=C.retry_policy([401, 429, 500, 502, 503],
                                                      attempts=2, backoff="50ms"),
                                health=C.health_policy("response.code >= 400", 1))
    val = {"s1_codes_only": h.validate(cfg_s1, "T3-s1"),
           "s2_codes_health_eviction": h.validate(cfg_s2, "T3-s2")}
    out["validate"] = {k: {"exit": v["exit"], "stderr": v["stderr"]} for k, v in val.items()}
    if val["s1_codes_only"]["exit"] != 0 or val["s2_codes_health_eviction"]["exit"] != 0:
        print(json.dumps({"FATAL": "schema rejected", "validate": out["validate"]}, indent=1)[:2000])
        return 2

    def hit_delta(before):
        return {"primary_proxy_hits": p_bad.stats()["total"] - before[0],
                "backup_proxy_hits": p_good.stats()["total"] - before[1]}

    def rows_since(n):
        db = h.db_dump()
        return db, db["rows"][n:] if len(db["rows"]) > n else []

    def run_variant(cfg, tag, n_nonstream, n_stream):
        variant = {"tag": tag, "validate": out["validate"][tag] if tag in out["validate"] else None,
                   "trials": [], "db_rows_total": None}
        h.start(cfg, tag)
        try:
            n_before = len(h.db_dump()["rows"])
            for i in range(n_nonstream):
                before = (p_bad.stats()["total"], p_good.stats()["total"])
                r = h.post(timeout=45)
                variant["trials"].append({
                    "kind": "non-stream", "trial": i + 1,
                    "client": {k: r.get(k) for k in ("status", "body", "duration_s", "error")},
                    "hits": hit_delta(before)})
            for i in range(n_stream):
                before = (p_bad.stats()["total"], p_good.stats()["total"])
                s = h.stream(timeout=45)
                variant["trials"].append({
                    "kind": "stream", "trial": i + 1,
                    "client_sse": {k: s.get(k) for k in
                                   ("chunks", "first_token_s", "done", "duration_s", "error", "raw_sample")},
                    "hits": hit_delta(before)})
            db = h.db_dump()
            variant["db_rows_total"] = db["row_count"]
            variant["request_logs"] = db["rows"]
            variant["proxy_stats"] = {"primary": p_bad.stats(), "backup": p_good.stats()}
        finally:
            h.stop()
        variant["ag_log_tail"] = h.tail_log(40)
        return variant

    out["s1_codes_only"] = run_variant(cfg_s1, "T3-s1", 3, 3)
    h.save("T3-s1", {"section": "T3 codes-only retry real-upstream failover",
                     "topology": out["topology"], "result": out["s1_codes_only"],
                     "config": C._strip_key_files(cfg_s1)})
    out["s2_health_eviction"] = run_variant(cfg_s2, "T3-s2", 3, 3)
    h.save("T3-s2", {"section": "T3 codes+health+eviction real-upstream failover",
                     "topology": out["topology"], "result": out["s2_health_eviction"],
                     "config": C._strip_key_files(cfg_s2)})
    print(json.dumps({
        "validate": out["validate"],
        "s1": [{"kind": t["kind"], "trial": t["trial"],
                "status": (t.get("client") or {}).get("status"),
                "sse_chunks": (t.get("client_sse") or {}).get("chunks"),
                "sse_done": (t.get("client_sse") or {}).get("done"),
                "hits": t["hits"]} for t in out["s1_codes_only"]["trials"]],
        "s1_proxy": out["s1_codes_only"]["proxy_stats"],
        "s2": [{"kind": t["kind"], "trial": t["trial"],
                "status": (t.get("client") or {}).get("status"),
                "sse_chunks": (t.get("client_sse") or {}).get("chunks"),
                "sse_done": (t.get("client_sse") or {}).get("done"),
                "hits": t["hits"]} for t in out["s2_health_eviction"]["trials"]],
        "s2_proxy": out["s2_health_eviction"]["proxy_stats"]}, indent=1,
        ensure_ascii=False, default=str)[:6000])
    return 0


if __name__ == "__main__":
    try:
        code = main()
    finally:
        C.cleanup_keys(C.TMPROOT / "t3")
    sys.exit(code or 0)
