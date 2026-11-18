"""E12 localRateLimit, E13 retry availability, E9-extra CEL string functions.

Run inside the isolation lab (ports 3692/3921-3923, mock 8099):
    python e12_ratelimit_retry.py
"""
from __future__ import annotations

import copy
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import lab as L

RESULTS: dict = {}


def cfg_with(**overrides) -> dict:
    """base config plus E12 models, virtual models and optional policy overrides."""
    cfg = copy.deepcopy(L.base_cfg())
    cfg["llm"]["models"].extend([
        {"name": "m-p100", "visibility": "internal",
         "provider": {"reference": "mock-ok"}, "params": {"model": "usage-p100"}},
        {"name": "m-c100", "visibility": "internal",
         "provider": {"reference": "mock-ok"}, "params": {"model": "usage-c100"}},
    ])
    cfg["llm"]["virtualModels"].extend([
        {"name": "vm-e12", "routing": {"failover": {"targets": [{"model": "m-ok", "priority": 1}]}}},
        {"name": "vm-e12p", "routing": {"failover": {"targets": [{"model": "m-p100", "priority": 1}]}}},
        {"name": "vm-e12c", "routing": {"failover": {"targets": [{"model": "m-c100", "priority": 1}]}}},
    ])
    keys = overrides.pop("keys", None)
    if keys is not None:
        cfg["llm"]["policies"]["apiKey"]["keys"] = keys
    policy = overrides.pop("local_rate_limit", None)
    if policy is not None:
        cfg["llm"]["policies"]["localRateLimit"] = policy
    extra_policies = overrides.pop("policies", None)
    if extra_policies:
        cfg["llm"]["policies"].update(extra_policies)
    for key, value in overrides.items():
        cfg[key] = value
    return cfg


def call(model: str, key: str = L.KEY, headers: dict | None = None,
         extra: dict | None = None) -> dict:
    resp = L.post_json(model, extra=extra, key=key, headers=headers)
    interesting = {k: v for k, v in (resp.get("headers") or {}).items()
                   if k.lower().startswith(("x-ratelimit", "retry-after", "x-request"))}
    return {"status": resp.get("status"), "body": (resp.get("body") or "")[:400],
            "headers": interesting}


def run_seq(model: str, count: int, key: str = L.KEY, headers: dict | None = None) -> list[dict]:
    out = []
    for _ in range(count):
        out.append(call(model, key=key, headers=headers))
        time.sleep(0.02)
    return out


def wait_reload(log_path, baseline_lines: int, timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        text = L.tail_log(log_path, 400).splitlines()
        newest = "\n".join(text[baseline_lines:])
        if "loaded config" in newest:
            return True
        time.sleep(0.2)
    return False


def stats_probe() -> dict:
    out = {}
    for name, url in (("stats", "http://127.0.0.1:3922/metrics"),
                      ("stats_root", "http://127.0.0.1:3922/"),
                      ("admin", "http://127.0.0.1:3921/")):
        try:
            body = urllib.request.urlopen(url, timeout=3).read().decode("utf-8", "replace")
            out[name] = body[:2500]
        except Exception as exc:  # noqa: BLE001
            out[name] = repr(exc)[:200]
    return out


def e12_users() -> None:
    """Q1: can the key expression read metadata / is it user-flattened / shared buckets."""
    keys = [
        {"key": L.KEY, "metadata": {"name": "lab-client", "user_id": "u1"}},
        {"key": L.KEY2, "metadata": {"name": "lab-client-2", "user_id": "u2"}},
    ]
    for tag, expr in (("metadata_user_id", 'apiKey.metadata.user_id'),
                      ("flattened_user_id", 'apiKey.user_id')):
        cfg = cfg_with(keys=keys, local_rate_limit=[{
            "maxTokens": 2, "tokensPerFill": 0, "fillInterval": "1h",
            "type": "requests", "key": expr}])
        val = L.validate(cfg, f"e12-{tag}")
        entry = {"key_expr": expr, "validate_exit": val["exit"], "validate_stderr": val["stderr"][:600]}
        if val["exit"] == 0:
            log = L.start_ag(cfg, fresh_db=True, tag=f"e12-{tag}")
            a = run_seq("vm-e12", 3)
            b = run_seq("vm-e12", 1, key=L.KEY2)
            entry.update({"key1_three": a, "key2_one_after_key1_exhausted": b})
            if tag == "metadata_user_id":
                RESULTS["stats_probe"] = stats_probe()
            L.stop_ag()
        RESULTS[tag] = entry

    shared_keys = [
        {"key": L.KEY, "metadata": {"name": "lab-client", "user_id": "u1"}},
        {"key": L.KEY2, "metadata": {"name": "lab-client-2", "user_id": "u1"}},
    ]
    cfg = cfg_with(keys=shared_keys, local_rate_limit=[{
        "maxTokens": 2, "tokensPerFill": 0, "fillInterval": "1h",
        "type": "requests", "key": 'apiKey.metadata.user_id'}])
    val = L.validate(cfg, "e12-shared-user")
    entry = {"validate_exit": val["exit"], "validate_stderr": val["stderr"][:600]}
    if val["exit"] == 0:
        L.start_ag(cfg, fresh_db=True, tag="e12-shared-user")
        entry["key1_three"] = run_seq("vm-e12", 3)
        entry["key2_one_same_user_id"] = run_seq("vm-e12", 1, key=L.KEY2)
        L.stop_ag()
    RESULTS["shared_user_id"] = entry


def e12_tokens() -> None:
    """Q2: does tokens mode deduct prompt+completion, or one side only."""
    keys = [{"key": L.KEY, "metadata": {"name": "lab-client"}}]

    cfg = cfg_with(keys=keys, local_rate_limit=[{
        "maxTokens": 13, "tokensPerFill": 0, "fillInterval": "1h", "type": "tokens"}])
    L.start_ag(cfg, fresh_db=True, tag="e12-tokens-13")
    RESULTS["tokens_max13_default_usage"] = {
        "mock_usage": "prompt=5 completion=3 total=8",
        "requests": run_seq("vm-e12", 5),
    }
    L.stop_ag()

    for tag, model, usage in (("prompt100", "vm-e12p", "prompt=100 completion=0 total=100"),
                              ("completion100", "vm-e12c", "prompt=0 completion=100 total=100")):
        cfg = cfg_with(keys=keys, local_rate_limit=[{
            "maxTokens": 100, "tokensPerFill": 0, "fillInterval": "1h", "type": "tokens"}])
        L.start_ag(cfg, fresh_db=True, tag=f"e12-tokens-{tag}")
        RESULTS[f"tokens_{tag}"] = {"mock_usage": usage, "requests": run_seq(model, 3)}
        L.stop_ag()


def e12_zero_fill() -> None:
    """Q3: tokensPerFill=0 after exhaustion: sustained reject, error, or unlimited."""
    keys = [{"key": L.KEY, "metadata": {"name": "lab-client"}}]
    cfg = cfg_with(keys=keys, local_rate_limit=[{
        "maxTokens": 2, "tokensPerFill": 0, "fillInterval": "1h", "type": "requests"}])
    L.start_ag(cfg, fresh_db=True, tag="e12-zero-fill")
    RESULTS["tokens_per_fill_zero"] = {"requests": run_seq("vm-e12", 8)}
    time.sleep(2.0)
    RESULTS["tokens_per_fill_zero"]["after_2s_wait"] = run_seq("vm-e12", 2)
    L.stop_ag()


def e12_reload() -> None:
    """Q4: raising maxTokens via hot reload: does the bucket keep 0 or gain capacity."""
    keys = [{"key": L.KEY, "metadata": {"name": "lab-client"}}]
    cfg = cfg_with(keys=keys, local_rate_limit=[{
        "maxTokens": 2, "tokensPerFill": 0, "fillInterval": "1h", "type": "requests"}])
    log = L.start_ag(cfg, fresh_db=True, tag="e12-reload")
    baseline = len(L.tail_log(log, 2000).splitlines())
    entry: dict = {"initial_2": run_seq("vm-e12", 3)}
    raised = copy.deepcopy(cfg)
    raised["llm"]["policies"]["localRateLimit"][0]["maxTokens"] = 5
    L.write_cfg(raised)
    entry["reload_ok"] = wait_reload(log, baseline)
    entry["after_max5"] = run_seq("vm-e12", 4)
    entry["ag_log_tail"] = L.tail_log(log, 25)
    L.stop_ag()
    RESULTS["reload_max_tokens"] = entry


def e12_restart() -> None:
    """Q5: process restart resets buckets."""
    keys = [{"key": L.KEY, "metadata": {"name": "lab-client"}}]
    cfg = cfg_with(keys=keys, local_rate_limit=[{
        "maxTokens": 2, "tokensPerFill": 0, "fillInterval": "1h", "type": "requests"}])
    L.start_ag(cfg, fresh_db=True, tag="e12-restart-before")
    entry: dict = {"before_restart": run_seq("vm-e12", 3)}
    L.start_ag(cfg, fresh_db=False, tag="e12-restart-after")
    entry["after_restart"] = run_seq("vm-e12", 2)
    entry["ag_log_tail"] = L.tail_log(L.EVID / "ag-e12-restart-after.log", 15)
    L.stop_ag()
    RESULTS["restart_reset"] = entry


def e12_lru() -> None:
    """Q5b: bucket eviction: fill many distinct buckets, then revisit the exhausted one."""
    keys = [{"key": L.KEY, "metadata": {"name": "lab-client"}}]
    cfg = cfg_with(keys=keys, local_rate_limit=[{
        "maxTokens": 2, "tokensPerFill": 0, "fillInterval": "1h",
        "type": "requests", "key": 'request.headers["x-bucket"]'}])
    L.start_ag(cfg, fresh_db=True, tag="e12-lru")

    def one(bucket: str) -> int | None:
        return call("vm-e12", headers={"x-bucket": bucket})["status"]

    entry: dict = {"old_bucket_exhaust": [one("old") for _ in range(3)]}
    entry["other_buckets_2k"] = _flood(one, [f"b{i}" for i in range(2000)])
    entry["old_after_2k"] = [one("old") for _ in range(2)]
    entry["other_buckets_12k"] = _flood(one, [f"c{i}" for i in range(12000)])
    entry["old_after_12k"] = [one("old") for _ in range(2)]
    entry["stats"] = stats_probe().get("stats_root", "")[:1500]
    L.stop_ag()
    RESULTS["lru_eviction"] = entry


def _flood(one, buckets: list[str]) -> dict:
    with ThreadPoolExecutor(max_workers=16) as pool:
        codes = list(pool.map(one, buckets))
    return {"count": len(codes), "ok": codes.count(200), "other": len(codes) - codes.count(200)}


def e13_retry() -> None:
    """E13: is a retry policy available for LLM traffic at all."""
    keys = [{"key": L.KEY, "metadata": {"name": "lab-client"}}]
    cfg = cfg_with(keys=keys)
    cfg["llm"]["policies"]["retry"] = {"attempts": 2, "codes": [500, 502, 503], "backoff": "50ms"}
    val = L.validate(cfg, "e13-llm-retry")
    RESULTS["e13_llm_policy_retry"] = {"validate_exit": val["exit"], "stderr": val["stderr"][:1200]}
    cfg2 = cfg_with(keys=keys)
    cfg2["llm"]["models"][0]["retry"] = {"attempts": 2, "codes": [500]}
    val2 = L.validate(cfg2, "e13-model-retry")
    RESULTS["e13_model_retry"] = {"validate_exit": val2["exit"], "stderr": val2["stderr"][:1200]}


def e9_extra() -> None:
    """E9 addendum: CEL string replace / case functions usable in transformations."""
    keys = [{"key": L.KEY, "metadata": {"name": "lab-client"}}]
    cfg = cfg_with(keys=keys)
    cfg["llm"]["policies"]["transformations"] = {"request": {"set": {
        "x-cel-regex": '"/id/1234/data".regexReplace("/id/[0-9]*/", "/id/{id}/")',
        "x-cel-regex-all": '"id=1 id=2".regexReplaceAll("id=[0-9]+", "[ID]")',
        "x-cel-upper": '"aBc".upperAscii()',
        "x-cel-lower": '"ABC".lowerAscii()',
        "x-cel-replace": '"a-b-c".replace("-", "_")',
        "x-cel-trim": '"  padded  ".trim()',
    }}}
    val = L.validate(cfg, "e9-cel-strings")
    entry = {"validate_exit": val["exit"], "validate_stderr": val["stderr"][:800]}
    if val["exit"] == 0:
        L.start_ag(cfg, fresh_db=True, tag="e9-cel-strings")
        L.mock_reset()
        resp = call("vm-e12")
        entry["response_status"] = resp["status"]
        entries = L.mock_entries(3)
        entry["mock_headers"] = (entries[-1] if entries else {}).get("headers")
        L.stop_ag()
    RESULTS["e9_cel_string_functions"] = entry


def main() -> int:
    L.ensure_mock()
    try:
        e12_users()
        e12_tokens()
        e12_zero_fill()
        e12_reload()
        e12_restart()
        e12_lru()
        e13_retry()
        e9_extra()
    finally:
        L.stop_ag()
    L.save("E12-local-rate-limit-and-retry", RESULTS)
    print(json.dumps(RESULTS, ensure_ascii=False, indent=2)[:60000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
