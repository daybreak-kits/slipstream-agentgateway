"""E12 follow-ups: apiKey flattening, reload bucket persistence, LRU capacity."""
from __future__ import annotations

import copy
import json
import time
from concurrent.futures import ThreadPoolExecutor

import lab as L
from e12_ratelimit_retry import call, cfg_with, run_seq, wait_reload

OUT: dict = {}


def flatten_probe() -> None:
    keys = [
        {"key": L.KEY, "metadata": {"name": "lab-client", "user_id": "u1"}},
        {"key": L.KEY2, "metadata": {"name": "lab-client-2", "user_id": "u1"}},
    ]
    for tag, expr in (("apiKey_user_id_same_user", 'apiKey.user_id'),
                      ("apiKey_missing_field", 'apiKey.no_such_field')):
        cfg = cfg_with(keys=keys, local_rate_limit=[{
            "maxTokens": 2, "tokensPerFill": 0, "fillInterval": "1h",
            "type": "requests", "key": expr}])
        val = L.validate(cfg, f"e12-followup-{tag}")
        entry = {"expr": expr, "validate_exit": val["exit"], "stderr": val["stderr"][:400]}
        if val["exit"] == 0:
            L.start_ag(cfg, fresh_db=True, tag=f"e12-followup-{tag}")
            entry["key1"] = run_seq("vm-e12", 3)
            entry["key2_same_value"] = run_seq("vm-e12", 1, key=L.KEY2)
            L.stop_ag()
        OUT[tag] = entry


def reload_persistence() -> None:
    keys = [{"key": L.KEY, "metadata": {"name": "lab-client"}}]
    cfg = cfg_with(keys=keys, local_rate_limit=[{
        "maxTokens": 2, "tokensPerFill": 0, "fillInterval": "1h", "type": "requests"}])
    log = L.start_ag(cfg, fresh_db=True, tag="e12-followup-reload")
    baseline = len(L.tail_log(log, 3000).splitlines())
    entry: dict = {"first_request": run_seq("vm-e12", 1)}
    changed = copy.deepcopy(cfg)
    changed["llm"]["virtualModels"].append(
        {"name": "vm-extra", "routing": {"failover": {"targets": [{"model": "m-ok", "priority": 1}]}}})
    L.write_cfg(changed)
    entry["reload_ok"] = wait_reload(log, baseline)
    entry["two_after_unrelated_reload"] = run_seq("vm-e12", 2)
    entry["ag_log_tail"] = L.tail_log(log, 12)
    L.stop_ag()
    OUT["reload_without_limit_change"] = entry


def lru_more() -> None:
    keys = [{"key": L.KEY, "metadata": {"name": "lab-client"}}]
    cfg = cfg_with(keys=keys, local_rate_limit=[{
        "maxTokens": 2, "tokensPerFill": 0, "fillInterval": "1h",
        "type": "requests", "key": 'request.headers["x-bucket"]'}])
    L.start_ag(cfg, fresh_db=True, tag="e12-followup-lru")

    def one(bucket: str) -> int | None:
        return call("vm-e12", headers={"x-bucket": bucket})["status"]

    entry: dict = {"old_bucket_exhaust": [one("old") for _ in range(3)]}
    buckets = [f"d{i}" for i in range(30000)]
    started = time.time()
    with ThreadPoolExecutor(max_workers=24) as pool:
        codes = list(pool.map(one, buckets))
    entry["flood"] = {"count": len(codes), "ok": codes.count(200),
                      "other": len(codes) - codes.count(200), "seconds": round(time.time() - started, 1)}
    entry["old_after_30k"] = [one("old") for _ in range(2)]
    L.stop_ag()
    OUT["lru_30k"] = entry


def main() -> int:
    L.ensure_mock()
    try:
        flatten_probe()
        reload_persistence()
        lru_more()
    finally:
        L.stop_ag()
    L.save("E12-followups", OUT)
    print(json.dumps(OUT, ensure_ascii=False, indent=2)[:20000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
