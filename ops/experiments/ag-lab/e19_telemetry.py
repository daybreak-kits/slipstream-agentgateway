"""E19 telemetry capability probe for pinned AG 1.7.0 standalone (mock only).

Ticket: docs/plans/w4-e19-telemetry-probe.md. Evidence naming: evidence/E19-*.
Five probes, each answering "does the capability exist and can it expose
per-attempt (upstream identity / status / ordinal) data for the route chain":

  T1  OTel traces   -> local OTLP/HTTP capture (otel_capture.py) on 4318;
                       E17-caliber full form (gateways/routes/backends[].ai)
                       with route retry codes=[500] attempts=2, primary mock
                       500 -> backup mock 200. Counts spans per request and
                       dumps the span tree with attributes.
  T2  Prometheus    -> GET /metrics on the stats port of the SAME T1 instance
                       (before/after the failover request); looks for
                       retry/eviction/upstream-error counters.
  T3  Access log    -> frontendPolicies.accessLog.add CEL fields (incl.
                       upstreamCalls[]) on a second instance; checks stdout
                       access-log line AND whether the SQLite request_logs
                       schema/rows change (PRAGMA table_info before/after).
  T4  Debug logging -> top-level logging.level=debug (schema) and RUST_LOG
                       env fallback on a third instance; greps stdout for
                       retry/eviction/outlier events during the same flow.
  T5  agctl         -> no run: --help + binary strings evidence (agctl absent).

All upstreams are the in-process mock (e17_common.MockServer). No real keys,
no .env.e15 dependency. Ports: gateway 3697, admin/stats/readiness
3931/3932/3933, OTLP capture 4318, mock binds dynamically.

Usage: python e19_telemetry.py [t1|t2|t3|t4|t5|all]
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

import e17_common as E17
import otel_capture as OTLP

LAB = Path(__file__).resolve().parent
EVID = LAB / "evidence"
OTLP_PORT = 4318
GW_PORT = 3697
ADMIN = (3931, 3932, 3933)  # admin / stats / readiness

RETRY_500 = {"attempts": 2, "codes": [500], "backoff": "100ms"}

CEL_FIELDS = {
    "agw.e19.upstream.calls": 'upstreamCalls.map(c, c.target + ":" + '
                              'string(c.response.code)).join(",")',
    "agw.e19.upstream.count": "size(upstreamCalls)",
    "agw.e19.upstream.subtypes": 'upstreamCalls.map(c, c.subtype).join(",")',
    "agw.e19.upstream.errors": 'upstreamCalls.map(c, string(c.error)).join(",")',
}


class Harness19(E17.Harness):
    """E17 harness with E19 evidence naming (class attributes only)."""

    tmp_root = LAB / ".e19-tmp"
    log_prefix = "ag-E19-"
    evid_prefix = "E19-"
    cfg_prefix = "cfg-E19-"


def failover_groups(mock) -> list:
    return [
        [E17.prov("primary", mock.host(), "mock-model",
                  path_prefix="/fail500", auth=None)],
        [E17.prov("backup", mock.host(), "mock-model",
                  path_prefix="/ok", auth=None)],
    ]


def failover_config(h, mock, retry=RETRY_500) -> dict:
    return E17.full_form_config(h, failover_groups(mock), retry=retry)


def metrics_scrape(port: int) -> str:
    return urllib.request.urlopen(
        "http://127.0.0.1:%d/metrics" % port, timeout=10).read().decode(
        "utf-8", "replace")


def table_schema(h) -> list:
    db = h.workdir / "data.db"
    if not db.exists():
        return []
    con = sqlite3.connect("file:" + str(db) + "?mode=ro", uri=True)
    cols = [{"name": r[1], "type": r[2]} for r in
            con.execute("PRAGMA table_info(request_logs)").fetchall()]
    con.close()
    return cols


def grep_lines(text: str, patterns, exclude=None) -> list:
    out = []
    for line in text.splitlines():
        low = line.lower()
        if any(p.lower() in low for p in patterns):
            if exclude and any(e.lower() in low for e in exclude):
                continue
            out.append(line[:2000])
    return out


def metric_diff(before: str, after: str) -> dict:
    def counters(text):
        vals = {}
        for line in text.splitlines():
            if line and not line.startswith("#"):
                name, _, value = line.partition(" ")
                try:
                    vals[name] = float(value)
                except ValueError:
                    pass
        return vals
    c0, c1 = counters(before), counters(after)
    changed = {}
    for name, v1 in c1.items():
        v0 = c0.get(name, 0.0)
        if v1 != v0:
            changed[name] = {"before": v0, "after": v1}
    added = [n for n in c1 if n not in c0]
    return {"changed": changed, "added": sorted(added)}


def summarize_spans(decoded_list: list) -> dict:
    """Per-capture span summaries: one span per line with key attributes,
    plus an attempt table for client-kind spans ordered by start time."""
    exports = []
    for d in decoded_list:
        if not d.get("decoded"):
            exports.append({"file": d.get("file"), "error": d.get("error")})
            continue
        spans = []
        attempts = []
        for s in d["otlp"]["spans"]:
            dur = None
            if isinstance(s.get("start_unix_nano"), int) and \
                    isinstance(s.get("end_unix_nano"), int):
                dur = round((s["end_unix_nano"] - s["start_unix_nano"]) / 1e6, 2)
            interesting = {}
            for k, v in (s.get("attributes") or {}).items():
                if isinstance(v, dict) and isinstance(v.get("raw"), str):
                    try:
                        v = bytes.fromhex(v["raw"]).decode("utf-8", "replace")
                    except Exception:
                        pass
                if re.search(r"retry|attempt|upstream|endpoint|status|model"
                             r"|provider|error|address|gen_ai|agw\.|http\.|"
                             r"agentgateway\.|server\.|url\.|protocol|"
                             r"gateway|listener|route|duration",
                             k):
                    interesting[k] = v
            spans.append({"name": s.get("name"), "kind": s.get("kind"),
                          "trace_id": (s.get("trace_id") or "")[:16],
                          "span_id": (s.get("span_id") or "")[:12],
                          "parent_span_id": (s.get("parent_span_id") or "")[:12],
                          "duration_ms": dur,
                          "status": s.get("status"),
                          "attributes": interesting,
                          "attribute_keys": sorted((s.get("attributes") or {}).keys())})
            if s.get("kind") == "client":
                attempts.append({
                    "span_id": (s.get("span_id") or "")[:12],
                    "start_unix_nano": s.get("start_unix_nano"),
                    "duration_ms": dur,
                    "attributes": {k: interesting.get(k) for k in (
                        "http.path", "http.status", "error.type",
                        "agentgateway.outbound.kind",
                        "agentgateway.outbound.subtype")}})
        attempts.sort(key=lambda a: a["start_unix_nano"] or 0)
        for i, a in enumerate(attempts, 1):
            a["attempt_no_by_time"] = i
        exports.append({"file": d.get("file"), "span_count": len(spans),
                        "spans": spans, "upstream_attempts": attempts,
                        "tree": OTLP.span_tree(d["otlp"])})
    return {"exports": exports,
            "total_spans": sum(e.get("span_count", 0) for e in exports)}


# ---------------------------------------------------------------- scenarios
def run_failover_flow(h, mock, n=1) -> list:
    """Reset mock, fire n chat requests, return client results."""
    mock.reset()
    results = []
    for _ in range(n):
        results.append(h.post())
    time.sleep(1.5)  # let access log settle
    return results


def wait_capture(cap, timeout=25.0) -> dict:
    """Poll the capture server until an export arrives or timeout elapses
    (OTLP exporters commonly batch ~5s)."""
    deadline = time.time() + timeout
    summary = cap.summary()
    while time.time() < deadline and summary["count"] == 0:
        time.sleep(0.5)
        summary = cap.summary()
    return summary


def s1_t1_t2() -> None:
    """T1 OTel spans + T2 metrics on one AG instance.

    Standalone root facts (both verified this run):
      * top-level `tracing`/`logging`/`metrics` keys are REJECTED by
        --validate-only ("unknown field `tracing`") -> they exist only in the
        xds/control-plane schema (schema-config.json RawConfig), not in the
        standalone file schema embedded in the binary.
      * the standalone mount point is frontendPolicies.tracing (TracingConfig:
        oneOf host/service/backend target + protocol http|grpc + path
        /v1/traces + sampling overrides).
    """
    mock = E17.MockServer("e19-t1", {"/fail500": "fail500", "/ok": "ok"}).start()
    for stale in (LAB / ".e19-tmp" / "otlp-t1", LAB / ".e19-tmp" / "otlp-t1b"):
        for f in stale.glob("*"):
            f.unlink(missing_ok=True)
    cap = OTLP.CaptureServer(LAB / ".e19-tmp" / "otlp-t1", port=OTLP_PORT).start()
    h = Harness19("e19t1", "t1")
    cfg = failover_config(h, mock)
    rejected = dict(cfg)
    rejected["tracing"] = {"otlpEndpoint": "http://127.0.0.1:%d" % OTLP_PORT,
                           "otlpProtocol": "http", "randomSampling": "true"}
    result = {"validate_top_level_tracing": h.validate(rejected, "t1-toplevel")}
    cfg["frontendPolicies"]["tracing"] = {
        "host": "127.0.0.1:%d" % OTLP_PORT, "protocol": "http",
        "randomSampling": "true"}
    result["validate"] = h.validate(cfg, "t1")
    try:
        if result["validate"]["exit"] != 0:
            result["abort"] = "validate rejected frontendPolicies.tracing"
        else:
            h.start(cfg, "t1")
            m0 = metrics_scrape(h.stats_port)
            results = run_failover_flow(h, mock)
            result["capture"] = wait_capture(cap)
            m1 = metrics_scrape(h.stats_port)
            result["request"] = results
            result["mock_hits"] = mock.stats()
            result["spans"] = summarize_spans(cap.decoded())
            result["db"] = h.db_dump()
            if result["capture"]["count"] == 0:
                # attempt B: drop explicit sampling fields, keep host+protocol
                cap.stop()
                cap2 = OTLP.CaptureServer(LAB / ".e19-tmp" / "otlp-t1b",
                                          port=OTLP_PORT).start()
                try:
                    cfg_b = json.loads(json.dumps(cfg))
                    cfg_b["frontendPolicies"]["tracing"] = {
                        "host": "127.0.0.1:%d" % OTLP_PORT,
                        "protocol": "http"}
                    result["validate_attempt_b"] = h.validate(cfg_b, "t1b")
                    if result["validate_attempt_b"]["exit"] == 0:
                        h.start(cfg_b, "t1b")
                        m0 = metrics_scrape(h.stats_port)
                        results_b = run_failover_flow(h, mock)
                        result["capture_attempt_b"] = wait_capture(cap2)
                        m1 = metrics_scrape(h.stats_port)
                        result["request_attempt_b"] = results_b
                        result["mock_hits_attempt_b"] = mock.stats()
                        result["spans_attempt_b"] = summarize_spans(
                            cap2.decoded())
                        result["db_attempt_b"] = h.db_dump()
                finally:
                    cap2.stop()
            (EVID / "E19-metrics-full.txt").write_text(
                "# ===== before request =====\n" + m0 +
                "\n# ===== after request =====\n" + m1, encoding="utf-8")
            t2 = metric_diff(m0, m1)
            t2["HELP_families"] = sorted(set(re.findall(
                r"^# HELP (\S+)", m1, re.M)))
            t2["interesting_after"] = grep_lines(
                m1, ("retry", "evict", "outlier", "unhealthy", "upstream",
                     "error", "request", "llm", "gen_ai", "ai_"))
            result["t2_metrics"] = t2
    finally:
        h.stop()
        cap.stop()
        mock.stop()
    result["config"] = cfg
    result["config_top_level_tracing_rejected"] = rejected
    h.save("T1-otel", result)
    h.save("T2-metrics", {"t2_metrics": result.get("t2_metrics"),
                          "raw_file": "evidence/E19-metrics-full.txt",
                          "note": "T2 shares the T1 instance and request"})


def s2_t3() -> None:
    """T3 access log CEL custom fields across three variants.

    A: legacy stdout + frontendPolicies.accessLog.add; also the request_logs
       schema check (PRAGMA table_info before/after).
    B: preset=otel + add (does the custom field reach the otel-format stdout
       access log?).
    C: add + accessLog.otlp export to the local capture (does the custom
       field, incl. upstreamCalls, reach the OTLP log records?).
    """
    variants = []
    mock = E17.MockServer("e19-t3", {"/fail500": "fail500", "/ok": "ok"}).start()
    for stale in (LAB / ".e19-tmp" / "otlp-t3c",):
        for f in stale.glob("*"):
            f.unlink(missing_ok=True)
    cap = OTLP.CaptureServer(LAB / ".e19-tmp" / "otlp-t3c", port=4319).start()
    try:
        # variant A
        h = Harness19("e19t3a", "t3a")
        cfg = failover_config(h, mock)
        cfg["frontendPolicies"]["accessLog"]["add"] = dict(CEL_FIELDS)
        v = {"name": "A: legacy stdout + accessLog.add",
             "validate": h.validate(cfg, "t3a"), "cel_fields": CEL_FIELDS}
        try:
            if v["validate"]["exit"] == 0:
                h.start(cfg, "t3a")
                v["schema_before_request"] = table_schema(h)
                run_failover_flow(h, mock)
                v["schema_after_request"] = table_schema(h)
                v["schema_changed"] = (v["schema_before_request"] !=
                                       v["schema_after_request"])
                v["db"] = h.db_dump()
                v["stdout_has_custom"] = "agw.e19" in h.tail_log(200)
                v["stdout_request_line"] = (grep_lines(
                    h.tail_log(200), ("request gateway=",)) or [None])[0]
                v["db_attrs_has_custom"] = "agw.e19" in json.dumps(v["db"])
                v["config"] = cfg
        finally:
            h.stop()
        variants.append(v)

        # variant B
        h = Harness19("e19t3b", "t3b")
        cfg = failover_config(h, mock)
        cfg["frontendPolicies"]["accessLog"] = {
            "preset": "otel", "add": dict(CEL_FIELDS),
            "database": {"llm": "full"}}
        v = {"name": "B: preset=otel + accessLog.add",
             "validate": h.validate(cfg, "t3b")}
        try:
            if v["validate"]["exit"] == 0:
                h.start(cfg, "t3b")
                run_failover_flow(h, mock)
                v["stdout_has_custom"] = "agw.e19" in h.tail_log(300)
                tail = h.tail_log(120)
                v["stdout_sample"] = tail.splitlines()[-1][:600] if tail else None
        finally:
            h.stop()
        variants.append(v)

        # variant C
        h = Harness19("e19t3c", "t3c")
        cfg = failover_config(h, mock)
        cfg["frontendPolicies"]["accessLog"] = {
            "add": dict(CEL_FIELDS),
            "otlp": {"host": "127.0.0.1:4319", "protocol": "http"},
            "database": {"llm": "full"}}
        v = {"name": "C: accessLog.add + otlp http export",
             "validate": h.validate(cfg, "t3c")}
        try:
            if v["validate"]["exit"] == 0:
                h.start(cfg, "t3c")
                run_failover_flow(h, mock)
                v["capture"] = wait_capture(cap, timeout=25.0)
                decoded = cap.decoded()
                logs = []
                for dd in decoded:
                    if dd.get("logs"):
                        logs.extend(dd["logs"]["records"])
                v["log_records"] = len(logs)
                v["records_with_custom"] = sum(
                    1 for r in logs if "agw.e19" in json.dumps(r.get("attributes")))
                for r in logs[:4]:
                    v.setdefault("record_samples", []).append({
                        "body": r.get("body"),
                        "attributes": {k: r["attributes"][k] for k in
                                       sorted(r["attributes"]) if k in CEL_FIELDS},
                        "attribute_keys": sorted(r["attributes"].keys())[:40]})
        finally:
            h.stop()
        variants.append(v)

        # variant D: trivial CEL expressions (static + size) on legacy stdout
        h = Harness19("e19t3d", "t3d")
        cfg = failover_config(h, mock)
        cfg["frontendPolicies"]["accessLog"]["add"] = {
            "agw.e19.static": "'abc'",
            "agw.e19.count": "string(size(upstreamCalls))",
        }
        v = {"name": "D: trivial CEL (static + size(upstreamCalls)) on stdout",
             "validate": h.validate(cfg, "t3d")}
        try:
            if v["validate"]["exit"] == 0:
                h.start(cfg, "t3d")
                run_failover_flow(h, mock)
                v["stdout_has_custom"] = "agw.e19" in h.tail_log(200)
                v["stdout_request_line"] = (grep_lines(
                    h.tail_log(200), ("request gateway=",)) or [None])[0]
        finally:
            h.stop()
        variants.append(v)

        # variant E: otlp.fields.add explicitly on the OTLP log export
        h = Harness19("e19t3e", "t3e")
        cfg = failover_config(h, mock)
        cfg["frontendPolicies"]["accessLog"] = {
            "otlp": {"host": "127.0.0.1:4319", "protocol": "http",
                     "fields": {"add": {
                         "agw.e19.static": "'abc'",
                         "agw.e19.calls": CEL_FIELDS["agw.e19.upstream.calls"]}}},
            "database": {"llm": "full"}}
        v = {"name": "E: otlp.fields.add explicit", "validate": h.validate(cfg, "t3e")}
        try:
            if v["validate"]["exit"] == 0:
                v["config"] = cfg
                h.start(cfg, "t3e")
                run_failover_flow(h, mock)
                v["capture"] = wait_capture(cap, timeout=25.0)
                decoded = cap.decoded()
                logs = []
                for dd in decoded:
                    if dd.get("logs"):
                        logs.extend(dd["logs"]["records"])
                v["log_records"] = len(logs)
                v["records_with_custom"] = sum(
                    1 for r in logs if "agw.e19" in json.dumps(r.get("attributes")))
                for r in logs[:2]:
                    v.setdefault("record_keys", []).append(
                        sorted(r["attributes"].keys()))
        finally:
            h.stop()
        variants.append(v)

        # variant F: isolate upstreamCalls expression parts (stdout legacy)
        h = Harness19("e19t3f", "t3f")
        cfg = failover_config(h, mock)
        cfg["frontendPolicies"]["accessLog"]["add"] = {
            "agw.e19.static": "'abc'",
            "agw.e19.count": "string(size(upstreamCalls))",
            "agw.e19.targets": 'upstreamCalls.map(c, c.target).join(",")',
            "agw.e19.codes": 'upstreamCalls.map(c, string(c.response.code)).join(",")',
        }
        v = {"name": "F: upstreamCalls parts isolated (stdout)", "validate": h.validate(cfg, "t3f")}
        try:
            if v["validate"]["exit"] == 0:
                v["config"] = cfg
                h.start(cfg, "t3f")
                run_failover_flow(h, mock)
                tail = h.tail_log(300)
                line = (grep_lines(tail, ("request gateway=",)) or [""])[0]
                v["stdout_line_full"] = line
                v["fields_present"] = {k: (k in line) for k in (
                    "agw.e19.static", "agw.e19.count",
                    "agw.e19.targets", "agw.e19.codes")}
        finally:
            h.stop()
        variants.append(v)
    finally:
        cap.stop()
        mock.stop()

    h = Harness19("e19t3", "t3")
    h.save("T3-accesslog-fields", {"variants": variants})


def s3_t4() -> None:
    """T4 debug logging: no CLI flag (T5 --help), no config-file knob in the
    standalone root (top-level `logging` rejected in T1), so test RUST_LOG
    env at debug and trace. Two requests so the post-failure eviction
    (5xx default) shows up as a next-request route change."""
    patterns = ("retry", "evict", "unhealthy", "outlier", "attempt", "health",
                "eject", "connect failed")
    variants = []
    representative_cfg = None
    mock = E17.MockServer("e19-t4", {"/fail500": "fail500", "/ok": "ok"}).start()
    try:
        # control: default level
        h = Harness19("e19t4c", "t4-control")
        cfg = failover_config(h, mock)
        representative_cfg = cfg
        v = {"name": "control (default level)",
             "validate": h.validate(cfg, "t4-control")}
        try:
            if v["validate"]["exit"] == 0:
                h.start(cfg, "t4-control")
                run_failover_flow(h, mock, n=2)
                v["retry_event_lines"] = grep_lines(h.tail_log(500), patterns)
                v["tail"] = h.tail_log(30)
        finally:
            h.stop()
        variants.append(v)

        # RUST_LOG=debug
        h = Harness19("e19t4d", "t4-debug")
        cfg = failover_config(h, mock)
        v = {"name": "RUST_LOG=debug env",
             "validate": h.validate(cfg, "t4-debug")}
        try:
            if v["validate"]["exit"] == 0:
                os.environ["RUST_LOG"] = "debug"
                try:
                    h.start(cfg, "t4-debug")
                    run_failover_flow(h, mock, n=2)
                finally:
                    os.environ.pop("RUST_LOG", None)
                v["log_line_count"] = len(h.tail_log(100000).splitlines())
                v["retry_event_lines"] = grep_lines(h.tail_log(100000), patterns)
                v["tail"] = h.tail_log(40)
        finally:
            h.stop()
        variants.append(v)

        # RUST_LOG=trace
        h = Harness19("e19t4t", "t4-trace")
        cfg = failover_config(h, mock)
        v = {"name": "RUST_LOG=trace env",
             "validate": h.validate(cfg, "t4-trace")}
        try:
            if v["validate"]["exit"] == 0:
                os.environ["RUST_LOG"] = "trace"
                try:
                    h.start(cfg, "t4-trace")
                    run_failover_flow(h, mock, n=2)
                finally:
                    os.environ.pop("RUST_LOG", None)
                v["log_line_count"] = len(h.tail_log(100000).splitlines())
                v["retry_event_lines"] = grep_lines(h.tail_log(100000), patterns)
                v["tail"] = h.tail_log(40)
        finally:
            h.stop()
        variants.append(v)
    finally:
        mock.stop()

    h = Harness19("e19t4", "t4")
    h.save("T4-debug-log", {"variants": variants, "config": representative_cfg})


def s4_t5() -> None:
    """T5 agctl subcommand check: --help + binary strings (no AG run)."""
    import subprocess
    AG = E17.AG
    proc = subprocess.run([str(AG), "--help"], capture_output=True,
                          text=True, timeout=60)
    data = open(AG, "rb").read()
    raw = re.findall(rb"[\x20-\x7e]{8,}", data)
    texts = [r.decode("ascii") for r in raw]
    agctl_hits = [t for t in texts if "agctl" in t.lower()]
    subcommand_area = [t for t in texts if t.startswith(("import", "migrate"))]
    h = Harness19("e19t5", "t5")
    h.save("T5-agctl", {
        "help_exit": proc.returncode,
        "help_stdout": proc.stdout,
        "help_stderr": proc.stderr[:400],
        "binary_strings_total": len(texts),
        "agctl_occurrences": len(agctl_hits),
        "agctl_samples": agctl_hits[:5],
        "subcommand_like_strings": subcommand_area[:10],
        "conclusion": "standalone has no agctl subcommand" if not agctl_hits
        else "agctl string found; inspect samples",
    })


def main(argv) -> int:
    what = argv[1] if len(argv) > 1 else "all"
    runners = {"t1": s1_t1_t2, "t3": s2_t3, "t4": s3_t4, "t5": s4_t5}
    if what == "all":
        for name, fn in runners.items():
            print("==== %s ====" % name, flush=True)
            fn()
        return 0
    if what not in runners:
        print("unknown scenario %r; use t1|t3|t4|t5|all" % what)
        return 2
    runners[what]()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
