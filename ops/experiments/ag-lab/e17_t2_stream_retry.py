"""E17-T2: streaming x route-retry interaction + token accounting in AG v1.7.

FULL FORM config = gateways/routes/backends[].ai.groups[].providers (E16 shape).
SIMPLIFIED form = classic llm: block (E14/E15 shape: llm.port + providers + models +
virtualModels + policies.apiKey).

Scenarios
  (a) route retry codes=[500], attempts=2 + two backend groups: primary mock -> 500
      BEFORE first byte, backup mock -> healthy SSE stream. A streaming client request
      should fail over and receive the COMPLETE SSE (chunks>0, done=true, no error).
      Control: identical groups without retry -> 500, backup never hit.
      Records both upstream hit counts.
  (b) primary = slow SSE mock reached through a TCP Proxy(kills=1) that aborts the
      connection right after the first forwarded response chunk; backup = healthy SSE
      mock. Expect: client gets truncated/erreoneous stream and backup is NEVER hit
      (E14 theory: no failover after first byte). Records client outcome, proxy hits,
      both upstream mock hits.
  (c) request_logs accounting in full form: one non-stream + one stream request, dump
      input_tokens/output_tokens/total_tokens/time_to_first_token_ms/
      time_per_output_token_ms/duration_ms/http_status/gen_ai_provider_name/
      gen_ai_request_model/gen_ai_response_model. Then the SAME requests through the
      SIMPLIFIED config and compare column shapes.

Run from repo root:  python ops/experiments/ag-lab/e17_t2_stream_retry.py [a|b|c|all]
Evidence: evidence/E17-T2-{a,b,c}.json.md (+ cfg-E17-T2-*.yaml), AG logs
evidence/ag-E17-T2-*.log.  Result summary: ops/experiments/ag-lab/.e17-tmp/t2/RESULT2.md
"""
from __future__ import annotations

import json
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))

import e17_common as C  # noqa: E402

PORT = 3695
ADMIN = (3935, 3936, 3937)
FAKE_KEY = "sk-fake-backend-key-t2"
RESULT_DIR = C.TMPROOT / "t2"

# request_logs columns compared full-form vs simplified (per task brief)
COLS = [
    "input_tokens", "output_tokens", "total_tokens",
    "time_to_first_token_ms", "time_per_output_token_ms", "duration_ms",
    "http_status", "gen_ai_provider_name", "gen_ai_request_model",
    "gen_ai_response_model",
]


def _log(msg: str) -> None:
    print(msg, flush=True)


def _summ_stats(bundle: dict) -> dict:
    return {name: {"total": st["total"], "counts": st["counts"]} for name, st in bundle.items()}


def _extract_rows(dump: dict) -> list[dict]:
    """One compact dict per request_logs row with the comparison columns."""
    out = []
    for row in dump.get("rows", []):
        rec = {c: row.get(c) for c in COLS}
        rec["error"] = row.get("error")
        rec["started_at"] = row.get("started_at")
        out.append(rec)
    return out


def _row_at(dump: dict, idx: int = -1):
    rows = dump.get("rows", [])
    if not rows:
        return None
    return rows[idx]


# ------------------------------------------------------------------ scenario (a)
def scenario_a(h: C.Harness, key: str) -> dict:
    """retry codes=[500] two groups: primary 500 before first byte -> backup full SSE."""
    primary = C.MockServer("t2-a-primary", {"/fail": "fail500"},
                           log_path=h.workdir / "mock-a-primary.jsonl").start()
    backup = C.MockServer("t2-a-backup", {"/ok": "sse"},
                          log_path=h.workdir / "mock-a-backup.jsonl").start()
    out: dict = {
        "note": ("route retry codes=[500] attempts=2 backoff=100ms; group1 = primary mock "
                 "(500 before first byte), group2 = backup mock (8-chunk SSE). Streaming "
                 "client request; expect complete SSE from backup, primary hit>=1, backup=1."),
        "retry_policy": C.retry_policy([500]),
    }
    try:
        groups = [[C.prov("p-primary", primary.host(), "mock-fail", key, path_prefix="/fail")],
                  [C.prov("p-backup", backup.host(), "mock-stream", key, path_prefix="/ok")]]
        cfg = C.full_form_config(h, groups, retry=C.retry_policy([500]))
        out["config"] = cfg
        val = h.validate(cfg, "T2-a")
        out["validate"] = val
        if val["exit"] == 0:
            primary.reset()
            backup.reset()
            h.start(cfg, "T2-a")
            try:
                stream = h.stream()
                time.sleep(1.0)
                out["stream"] = stream
                out["hits"] = _summ_stats({"primary": primary.stats(),
                                           "backup": backup.stats()})
                out["request_logs"] = h.db_dump()
                out["request_log_rows"] = _extract_rows(out["request_logs"])
                out["ag_log_tail"] = h.tail_log(120)
            finally:
                h.stop()

        # control: same provider groups, NO route retry policy
        cfg_ctrl = C.full_form_config(h, groups, retry=None)
        out["control_no_retry"] = {
            "note": ("same two groups without route retry; non-stream request expected to "
                     "surface the primary 500 with zero backup hits (retry is what enables "
                     "in-request failover)"),
            "config": C._strip_key_files(cfg_ctrl),
        }
        val_ctrl = h.validate(cfg_ctrl, "T2-a-control")
        out["control_no_retry"]["validate"] = val_ctrl
        if val_ctrl["exit"] == 0:
            primary.reset()
            backup.reset()
            h.start(cfg_ctrl, "T2-a-control")
            try:
                resp = h.post()
                time.sleep(0.8)
                out["control_no_retry"]["response"] = resp
                out["control_no_retry"]["hits"] = _summ_stats(
                    {"primary": primary.stats(), "backup": backup.stats()})
                out["control_no_retry"]["request_log_rows"] = _extract_rows(h.db_dump())
            finally:
                h.stop()
    finally:
        primary.stop()
        backup.stop()
    return out


# ------------------------------------------------------------------ scenario (b)
def _chunked_sse_handler(holder: dict):
    """Tiny chunked-transfer SSE upstream used by the b2 control.

    The harness MockServer replies with Connection: close and neither
    Content-Length nor chunked framing, so AG reads a killed socket as a normal
    close-delimited body end. This upstream uses real HTTP/1.1 chunked framing, so
    a mid-body TCP kill leaves an unterminated chunked body: a protocol error that
    AG's HTTP layer must detect.
    """

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # keep the console quiet
            return

        def do_POST(self):
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if length:
                    self.rfile.read(length)
            except Exception:
                return
            with holder["lock"]:
                holder["hits"].append({"path": self.path,
                                       "ts": round(time.time(), 2)})
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            base = {"id": "chatcmpl-mock", "object": "chat.completion.chunk",
                    "created": 1700000000, "model": "mock-stream"}

            def emit(payload: bytes):
                self.wfile.write(("%x\r\n" % len(payload)).encode() + payload + b"\r\n")
                self.wfile.flush()

            try:
                time.sleep(0.15)
                for i in range(40):
                    ev = dict(base)
                    ev["choices"] = [{"index": 0,
                                      "delta": {"content": "tok%d " % i},
                                      "finish_reason": None}]
                    emit(("data: " + json.dumps(ev) + "\n\n").encode())
                    if i < 39:
                        time.sleep(0.2)
            except Exception:
                return  # the kill proxy aborted the connection; expected
    return Handler


def _run_killed_stream(h: C.Harness, key: str, proxy: C.Proxy,
                       backup: C.MockServer, tag: str, note: str,
                       extra_stats: dict | None = None) -> dict:
    """group1 = proxy -> primary (killed after first response chunk), group2 = SSE backup."""
    rec: dict = {"note": note, "retry_policy": C.retry_policy([500])}
    groups = [[C.prov("p-primary", proxy.host(), "mock-stream", key, path_prefix="/sse")],
              [C.prov("p-backup", backup.host(), "mock-stream", key, path_prefix="/ok")]]
    cfg = C.full_form_config(h, groups, retry=C.retry_policy([500]))
    rec["config"] = cfg
    val = h.validate(cfg, tag)
    rec["validate"] = val
    if val["exit"] == 0:
        for m in (extra_stats or {}).values():
            m.reset()
        backup.reset()
        proxy.reset()
        h.start(cfg, tag)
        try:
            rec["stream"] = h.stream(timeout=60.0)
            time.sleep(2.0)  # let AG log the mid-stream failure / mocks settle
            stats = {"proxy": proxy.stats(), "backup": backup.stats()}
            stats.update({name: m.stats() for name, m in (extra_stats or {}).items()})
            rec["hits"] = _summ_stats(stats)
            dump = h.db_dump()
            rec["request_logs_row_count"] = dump["row_count"]
            rec["request_log_rows"] = _extract_rows(dump)
            rec["ag_log_tail"] = h.tail_log(140)
        finally:
            h.stop()
    return rec


def scenario_b(h: C.Harness, key: str) -> dict:
    """slow SSE primary killed after first chunk; backup must stay unhit (b1 + b2)."""
    slow = C.MockServer("t2-b-slow", {"/sse": "sse_slow"},
                        log_path=h.workdir / "mock-b-slow.jsonl").start()
    backup = C.MockServer("t2-b-backup", {"/ok": "sse"},
                          log_path=h.workdir / "mock-b-backup.jsonl").start()
    out: dict = {
        "note": ("primary = slow SSE stream behind Proxy(kills=1, kill_after_bytes=300) "
                 "which aborts the TCP connection right after the first forwarded response "
                 "chunk; backup = healthy SSE mock in group2; route retry codes=[500] "
                 "attempts=2. E14 theory: no failover after first byte, so the backup must "
                 "never be hit. b1 uses the prescribed harness mock; b2 is a chunked-framing "
                 "control where the truncation is a detectable protocol error instead of a "
                 "clean close-delimited EOF."),
        "theory": "E14: no failover after the first byte was forwarded to the client",
    }
    try:
        # ---- b1: prescribed setup (harness MockServer, close-delimited SSE) ----
        proxy = C.Proxy("127.0.0.1", slow.port, kills=1, kill_after_bytes=300,
                        name="t2-b-killproxy").start()
        try:
            b1 = _run_killed_stream(
                h, key, proxy, backup, "T2-b",
                "b1: primary = slow SSE harness mock behind the kill proxy; backup = "
                "healthy SSE mock; retry codes=[500] attempts=2.",
                {"primary_mock": slow})
            b1_cfg = b1.pop("config", None)
            b1["config"] = ("see cfg-E17-T2-b.yaml -> harness_mock_run")
            b1["proxy"] = {"target": "127.0.0.1:" + str(slow.port), "kills": 1,
                           "kill_after_bytes": 300, "addr": proxy.host()}
            b1["framing_caveat"] = (
                "harness MockServer SSE replies with Connection: close and no "
                "Content-Length/chunked framing, so the killed socket looks like a NORMAL "
                "close-delimited body end to AG: request_logs.error and the AG log stay "
                "empty. Truncation is only visible client-side (done=false).")
            out["harness_mock_run"] = b1
            out["config"] = {"harness_mock_run": b1_cfg}
        finally:
            proxy.stop()

        # ---- b2: control with chunked framing (truncation = detectable error) ----
        holder: dict = {"hits": [], "lock": threading.Lock()}
        chunked = C._ReuseServer(_chunked_sse_handler(holder))
        chunked_port = chunked.start()
        proxy2 = C.Proxy("127.0.0.1", chunked_port, kills=1, kill_after_bytes=300,
                         name="t2-b2-killproxy").start()
        try:
            b2 = _run_killed_stream(
                h, key, proxy2, backup, "T2-b2",
                "b2 control: primary = custom chunked-transfer SSE upstream behind the kill "
                "proxy, so AG sees an unterminated chunked body = real protocol error; "
                "backup = healthy SSE mock; retry codes=[500] attempts=2.",
                None)
            b2_cfg = b2.pop("config", None)
            b2["config"] = ("see cfg-E17-T2-b.yaml -> chunked_error_control")
            with holder["lock"]:
                paths = [x["path"] for x in holder["hits"]]
            b2["hits"]["chunked_primary"] = {
                "total": len(paths),
                "counts": {pth: paths.count(pth) for pth in set(paths)},
            }
            b2["proxy"] = {"target": "127.0.0.1:" + str(chunked_port), "kills": 1,
                           "kill_after_bytes": 300, "addr": proxy2.host()}
            out["chunked_error_control"] = b2
            out["config"]["chunked_error_control"] = b2_cfg
        finally:
            proxy2.stop()
            chunked.stop()
    finally:
        slow.stop()
        backup.stop()
    return out


# ------------------------------------------------------------------ scenario (c)
def _simplified_cfg(h: C.Harness, base_url: str, upstream_model: str,
                    vm_name: str) -> dict:
    """Classic simplified form (E14/E15): llm.port + providers/models/virtualModels."""
    cfg = C.base_cfg(h)
    cfg.pop("gateways", None)
    cfg.pop("routes", None)
    cfg["llm"] = {
        "port": h.port,
        "providers": [{
            "name": "p-simple",
            "provider": "openAI",
            "params": {"baseUrl": base_url, "apiKey": "test-key"},
        }],
        "models": [{
            "name": "m-simple",
            "visibility": "internal",
            "provider": {"reference": "p-simple"},
            "params": {"model": upstream_model},
        }],
        "virtualModels": [{
            "name": vm_name,
            "routing": {"failover": {"targets": [{"model": "m-simple",
                                                  "priority": 1}]}},
        }],
        "policies": {"apiKey": {"mode": "strict", "keys": [
            {"key": C.CLIENT_KEY, "metadata": {"name": "lab-client"}}]}},
    }
    return cfg


def _run_full(h: C.Harness, mock: C.MockServer, key: str, want_stream: bool,
              tag: str) -> dict:
    prefix = "/sse" if want_stream else "/ok"
    model = "mock-stream" if want_stream else "mock-ok"
    cfg = C.full_form_config(h, [[C.prov("p-c", mock.host(), model, key,
                                         path_prefix=prefix)]])
    val = h.validate(cfg, tag)
    rec: dict = {"validate": val, "mock": {"behavior": prefix[1:], "model": model},
                 "_cfg": cfg}
    if val["exit"] != 0:
        return rec
    mock.reset()
    h.start(cfg, tag)
    try:
        if want_stream:
            rec["stream"] = h.stream()
        else:
            rec["response"] = h.post()
        time.sleep(0.8)
        dump = h.db_dump()
        rec["request_logs_row_count"] = dump["row_count"]
        rec["request_log_rows"] = _extract_rows(dump)
        rec["request_log_row_full"] = _row_at(dump)
        rec["ag_log_tail"] = h.tail_log(80)
    finally:
        h.stop()
    rec["hits"] = _summ_stats({"mock": mock.stats()})
    return rec


def _run_simplified(h: C.Harness, mock: C.MockServer, want_stream: bool,
                    tag: str) -> dict:
    prefix = "/sse" if want_stream else "/ok"
    model = "mock-stream" if want_stream else "mock-ok"
    vm = "vm-t2-simple-" + ("stream" if want_stream else "nonstream")
    cfg = _simplified_cfg(h, "http://" + mock.host() + prefix + "/v1", model, vm)
    val = h.validate(cfg, tag)
    rec: dict = {"validate": val, "virtual_model": vm,
                 "mock": {"behavior": prefix[1:], "model": model}, "_cfg": cfg}
    if val["exit"] != 0:
        return rec
    mock.reset()
    h.start(cfg, tag)
    try:
        if want_stream:
            rec["stream"] = h.stream(model=vm)
        else:
            rec["response"] = h.post(model=vm)
        time.sleep(0.8)
        dump = h.db_dump()
        rec["request_logs_row_count"] = dump["row_count"]
        rec["request_log_rows"] = _extract_rows(dump)
        rec["request_log_row_full"] = _row_at(dump)
        rec["ag_log_tail"] = h.tail_log(80)
    finally:
        h.stop()
    rec["hits"] = _summ_stats({"mock": mock.stats()})
    return rec


def scenario_c(h: C.Harness, key: str) -> dict:
    """request_logs accounting: full form vs simplified for one non-stream + one stream."""
    mock = C.MockServer("t2-c", {"/ok": "ok", "/sse": "sse"},
                        log_path=h.workdir / "mock-c.jsonl").start()
    out: dict = {
        "note": ("full form: route /v1/chat/completions -> one provider (pathPrefix "
                 "/ok for the non-stream request, /sse for the stream request). "
                 "simplified form: llm.port 3695 + llm.providers[].params.baseUrl -> "
                 "same mock paths, client model = virtual model name (vm-t2-simple-*). "
                 "Both use the same messages/max_tokens and stream flag per pair."),
        "columns": COLS,
    }
    try:
        # Full form: one AG run per request so each fresh data.db is unambiguous.
        out["full_form"] = {
            "nonstream": _run_full(h, mock, key, False, "T2-c-full-nonstream"),
            "stream": _run_full(h, mock, key, True, "T2-c-full-stream"),
        }
        out["simplified"] = {
            "nonstream": _run_simplified(h, mock, False, "T2-c-simple-nonstream"),
            "stream": _run_simplified(h, mock, True, "T2-c-simple-stream"),
        }
        # Comparison table per column.
        cmp: dict = {}
        for pair in ("nonstream", "stream"):
            f = (out["full_form"][pair].get("request_log_rows") or [{}])[-1] if \
                out["full_form"][pair].get("request_log_rows") else {}
            s = (out["simplified"][pair].get("request_log_rows") or [{}])[-1] if \
                out["simplified"][pair].get("request_log_rows") else {}
            cmp[pair] = {c: {"full": f.get(c), "simplified": s.get(c)}
                         for c in COLS}
            cmp[pair]["gen_ai_response_model"] = {
                "full": f.get("gen_ai_response_model"),
                "simplified": s.get("gen_ai_response_model")}
        out["comparison"] = cmp
        # configs for the evidence file (key file paths stripped by Harness.save)
        out["config"] = {
            "full_form_nonstream": out["full_form"]["nonstream"].pop("_cfg", None),
            "full_form_stream": out["full_form"]["stream"].pop("_cfg", None),
            "simplified_nonstream": out["simplified"]["nonstream"].pop("_cfg", None),
            "simplified_stream": out["simplified"]["stream"].pop("_cfg", None),
            "note": ("four configs, one per request run. Full form differs only in "
                     "pathPrefix/model; simplified configs differ only in "
                     "params.baseUrl/model/virtual model name."),
        }
    finally:
        mock.stop()
    return out


# ------------------------------------------------------------------ summary
def _clean_cfg(obj):
    return C._strip_key_files(obj) if isinstance(obj, dict) else obj


def build_summary(results: dict) -> dict:
    a = results.get("T2-a", {})
    b = results.get("T2-b", {})
    c = results.get("T2-c", {})

    a_stream = a.get("stream") or {}
    a_hits = a.get("hits") or {}
    a_ok = bool(a_stream.get("chunks", 0) > 0 and a_stream.get("done")
                and not a_stream.get("error")
                and a_hits.get("primary", {}).get("total", 0) >= 1
                and a_hits.get("backup", {}).get("total") == 1)
    a_ctrl = a.get("control_no_retry") or {}
    a_ctrl_ok = (a_ctrl.get("response", {}).get("status") == 500
                 and a_ctrl.get("hits", {}).get("backup", {}).get("total") == 0)

    b1 = b.get("harness_mock_run") or {}
    b2 = b.get("chunked_error_control") or {}
    b1_stream = b1.get("stream") or {}
    b1_hits = b1.get("hits") or {}
    b1_row = (b1.get("request_log_rows") or [{}])[-1] or {}
    b2_stream = b2.get("stream") or {}
    b2_hits = b2.get("hits") or {}
    b2_row = (b2.get("request_log_rows") or [{}])[-1] or {}
    b1_ok = ((not b1_stream.get("done")) and b1_stream.get("chunks", 0) >= 1
             and b1_hits.get("backup", {}).get("total") == 0
             and b1_hits.get("proxy", {}).get("total") == 1)
    b2_ok = (b2_hits.get("backup", {}).get("total") == 0
             and b2_hits.get("chunked_primary", {}).get("total") == 1
             and b2_hits.get("proxy", {}).get("total") == 1
             and (not b2_stream.get("done")))
    b_ok = b1_ok and b2_ok
    b_verdict = "成立" if b_ok else ("部分成立" if (b1_ok or b2_ok) else "不成立")

    c_full = c.get("full_form") or {}
    c_simple = c.get("simplified") or {}

    def _row(pair_result):
        rows = pair_result.get("request_log_rows") or []
        return rows[-1] if rows else {}

    full_ns = _row(c_full.get("nonstream") or {})
    full_st = _row(c_full.get("stream") or {})
    simple_ns = _row(c_simple.get("nonstream") or {})
    simple_st = _row(c_simple.get("stream") or {})

    def _present(v):
        return v not in (None, "None", "")

    def _same_nullness(left, right):
        return _present(left) == _present(right)

    tok_cols = ("input_tokens", "output_tokens", "total_tokens")
    meta_cols = ("http_status", "gen_ai_provider_name", "gen_ai_request_model",
                 "gen_ai_response_model")
    ttft_cols = ("time_to_first_token_ms", "time_per_output_token_ms")

    c_rows_present = all(_row(c_full.get(pair) or {}) for pair in
                         ("nonstream", "stream")) and \
        all(_row(c_simple.get(pair) or {}) for pair in ("nonstream", "stream"))
    c_full_tokens = c_rows_present and all(
        _present(full_ns.get(k)) and _present(full_st.get(k)) for k in tok_cols)
    c_full_ttft = c_rows_present and all(_present(full_st.get(k)) for k in ttft_cols)
    c_nonstream_ttft_null = c_rows_present and all(
        not _present(full_ns.get(k)) for k in ttft_cols)
    c_tokens_equal = c_rows_present and all(
        full_ns.get(k) == simple_ns.get(k) and full_st.get(k) == simple_st.get(k)
        for k in tok_cols)
    c_meta_equal = c_rows_present and all(
        str(full_ns.get(k)) == str(simple_ns.get(k)) and
        str(full_st.get(k)) == str(simple_st.get(k)) for k in meta_cols)
    c_ttft_shape_equal = c_rows_present and all(
        _same_nullness(full_ns.get(k), simple_ns.get(k)) and
        _same_nullness(full_st.get(k), simple_st.get(k)) for k in ttft_cols)
    c_verdict = "成立" if (c_full_tokens and c_full_ttft and c_nonstream_ttft_null
                          and c_tokens_equal and c_meta_equal and c_ttft_shape_equal) \
        else ("部分成立" if c_rows_present else "不成立")

    return {
        "a": {
            "verdict": "成立" if a_ok else "不成立",
            "stream": {k: a_stream.get(k) for k in
                       ("chunks", "done", "error", "first_token_s", "duration_s")},
            "hits": a_hits,
            "control_no_retry": {
                "status": a_ctrl.get("response", {}).get("status"),
                "hits": a_ctrl.get("hits"),
                "backup_unhit": a_ctrl_ok,
            },
            "validate_exit": (a.get("validate") or {}).get("exit"),
        },
        "b": {
            "verdict": b_verdict,
            "theory": b.get("theory"),
            "backup_never_hit": (b1_hits.get("backup", {}).get("total") == 0 and
                                 b2_hits.get("backup", {}).get("total") == 0),
            "harness_mock_run": {
                "stream": {k: b1_stream.get(k) for k in
                           ("chunks", "done", "error", "first_token_s",
                            "duration_s")},
                "hits": b1_hits,
                "validate_exit": (b1.get("validate") or {}).get("exit"),
                "request_log_error": b1_row.get("error"),
                "framing_caveat": b1.get("framing_caveat"),
            },
            "chunked_error_control": {
                "stream": {k: b2_stream.get(k) for k in
                           ("chunks", "done", "error", "first_token_s",
                            "duration_s")},
                "hits": b2_hits,
                "validate_exit": (b2.get("validate") or {}).get("exit"),
                "request_log_error": b2_row.get("error"),
                "error_detected_in_ag": bool(b2_row.get("error")),
            },
        },
        "c": {
            "verdict": c_verdict,
            "simplified_mode_configured": bool(
                ((c_simple.get("nonstream") or {}).get("validate") or {}).get("exit")
                == 0),
            "full_tokens_present": c_full_tokens,
            "full_stream_ttft_present": c_full_ttft,
            "nonstream_ttft_null": c_nonstream_ttft_null,
            "tokens_equal_across_modes": c_tokens_equal,
            "meta_equal_across_modes": c_meta_equal,
            "ttft_shape_equal_across_modes": c_ttft_shape_equal,
            "full": {"nonstream": {x: full_ns.get(x) for x in COLS},
                     "stream": {x: full_st.get(x) for x in COLS}},
            "simplified": {"nonstream": {x: simple_ns.get(x) for x in COLS},
                           "stream": {x: simple_st.get(x) for x in COLS}},
            "comparison": c.get("comparison"),
        },
    }


def _write_result_md(summary: dict) -> Path:
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    a, b, c = summary["a"], summary["b"], summary["c"]

    def _fmt_stream(s):
        return (f"chunks={s.get('chunks')} done={s.get('done')} "
                f"error={s.get('error')!r} first_token_s={s.get('first_token_s')} "
                f"duration_s={s.get('duration_s')}")

    lines = []
    lines.append("# E17-T2: streaming x route retry interaction + token accounting")
    lines.append("")
    lines.append("AG v1.7.0 (sha256 909b93dc...ed3c), FULL FORM "
                 "(gateways/routes/backends[].ai.groups[].providers). "
                 "Mocks = E17 harness MockServer (ephemeral ports), kill proxy = harness Proxy.")
    lines.append("")
    lines.append("## (a) retry codes=[500] streaming failover")
    lines.append("")
    lines.append(f"- verdict: **{a['verdict']}**")
    lines.append(f"- client stream: {_fmt_stream(a['stream'])}")
    lines.append(f"- upstream hits: {json.dumps(a['hits'], ensure_ascii=False)}")
    lines.append(f"- control (no retry): status={a['control_no_retry']['status']}, "
                 f"hits={json.dumps(a['control_no_retry']['hits'], ensure_ascii=False)}, "
                 f"backup_unhit={a['control_no_retry']['backup_unhit']}")
    lines.append(f"- validate exit: {a['validate_exit']}")
    lines.append("")
    b1 = b["harness_mock_run"]
    b2 = b["chunked_error_control"]
    lines.append("## (b) first-byte-then-kill streaming (E14 no-failover theory)")
    lines.append("")
    lines.append(f"- verdict: **{b['verdict']}**; backup never hit: "
                 f"{b['backup_never_hit']}")
    lines.append("")
    lines.append("### b1 prescribed: harness slow SSE mock + Proxy(kills=1, "
                 "kill_after_bytes=300)")
    lines.append("")
    lines.append(f"- client stream: {_fmt_stream(b1['stream'])}")
    lines.append(f"- hits: {json.dumps(b1['hits'], ensure_ascii=False)}")
    lines.append(f"- request_logs.error: {b1['request_log_error']!r}; validate exit: "
                 f"{b1['validate_exit']}")
    lines.append(f"- framing caveat: {b1['framing_caveat']}")
    lines.append("")
    lines.append("### b2 control: chunked-framing primary (truncation = detectable error)")
    lines.append("")
    lines.append(f"- client stream: {_fmt_stream(b2['stream'])}")
    lines.append(f"- hits: {json.dumps(b2['hits'], ensure_ascii=False)}")
    lines.append(f"- request_logs.error: {b2['request_log_error']!r}; error detected by "
                 f"AG: {b2['error_detected_in_ag']}; validate exit: "
                 f"{b2['validate_exit']}")
    lines.append("")
    lines.append("## (c) request_logs accounting: full form vs simplified")
    lines.append("")
    lines.append(f"- verdict: **{c['verdict']}** (simplified mode configured: "
                 f"{c['simplified_mode_configured']})")
    lines.append(f"- full form token columns populated for both requests: "
                 f"{c['full_tokens_present']}")
    lines.append(f"- full form stream ttft/time_per_output_token populated: "
                 f"{c['full_stream_ttft_present']}")
    lines.append(f"- full form non-stream ttft/tpot null: {c['nonstream_ttft_null']}")
    lines.append(f"- tokens equal across modes: {c['tokens_equal_across_modes']}; "
                 f"status/provider/model columns equal: {c['meta_equal_across_modes']}; "
                 f"ttft/tpot populated-vs-null shape equal: "
                 f"{c['ttft_shape_equal_across_modes']}")
    lines.append("")
    cols = COLS
    lines.append("| column | full non-stream | simplified non-stream | full stream | "
                 "simplified stream |")
    lines.append("|---|---|---|---|---|")
    for col in cols:
        fns = (c["full"].get("nonstream") or {}).get(col)
        sns = (c["simplified"].get("nonstream") or {}).get(col)
        fst = (c["full"].get("stream") or {}).get(col)
        sst = (c["simplified"].get("stream") or {}).get(col)
        lines.append(f"| {col} | {fns} | {sns} | {fst} | {sst} |")
    lines.append("")
    lines.append("## notes")
    lines.append("")
    lines.append("- evidence: evidence/E17-T2-a.json.md, E17-T2-b.json.md, "
                 "E17-T2-c.json.md; configs: evidence/cfg-E17-T2-{a,b,c}.yaml; AG logs: "
                 "evidence/ag-E17-T2-*.log")
    lines.append("- b1 request_logs.error / AG log stay empty because the harness mock's "
                 "SSE body is close-delimited (EOF == normal body end). b2 repeats the "
                 "same kill with chunked framing, AG records "
                 "'response body failed: error reading a body from connection' yet still "
                 "does NOT fail over: E14's no-failover-after-first-byte rule holds even "
                 "when the failure is detectable.")
    lines.append("- token accounting: input/output/total_tokens come from upstream usage "
                 "(non-stream JSON usage; stream = final SSE usage chunk). ttft/tpot are "
                 "populated only for streaming requests, in BOTH config forms. "
                 "gen_ai_request_model/gen_ai_response_model record the upstream model "
                 "(mock-ok / mock-stream), not the client-facing virtual model.")
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULT_DIR / "RESULT2.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def main() -> int:
    only = sys.argv[1].lower() if len(sys.argv) > 1 else "all"
    h = C.Harness("t2", "T2", port=PORT, admin=ADMIN)
    key = C.write_key(h.workdir, "backend", FAKE_KEY)
    results: dict = {}
    plan = [("T2-a", scenario_a), ("T2-b", scenario_b), ("T2-c", scenario_c)]
    if only in ("a", "b", "c"):
        plan = [p for p in plan if p[0] == "T2-" + only]
    try:
        for tag, fn in plan:
            _log("[" + tag + "] start")
            started = time.time()
            try:
                payload = fn(h, key)
            except Exception as exc:  # noqa: BLE001
                payload = {"exception": repr(exc),
                           "traceback": traceback.format_exc()[:4000]}
                _log("[" + tag + "] EXCEPTION: " + repr(exc))
            payload["elapsed_s"] = round(time.time() - started, 1)
            # keep only scenario-owned config in the top-level "config" slot
            if tag == "T2-c" and isinstance(payload.get("config"), dict):
                payload["config"] = _clean_cfg(payload["config"])
            h.save(tag, payload)
            results[tag] = payload
            _log("[" + tag + "] done in " + str(payload["elapsed_s"]) + "s")
    finally:
        h.stop()
        C.cleanup_keys(h.workdir)

    summary = build_summary(results)
    _log(json.dumps(summary, ensure_ascii=False, indent=1, default=str))
    if len(plan) == 3:
        path = _write_result_md(summary)
        _log("[result] " + str(path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
