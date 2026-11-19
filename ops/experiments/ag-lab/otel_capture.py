"""E19-T1 bare OTLP/HTTP capture + minimal protobuf decoder (stdlib only).

Serves as a local OTLP collector replacement:
  python otel_capture.py --port 4318 --out .e19-tmp/otlp --seconds 30
Every POST (any path) is stored raw as out/capture-<n>.bin plus a line in
out/hits.jsonl {ts, path, content_type, length, file}. GET /summary returns
a JSON summary of what was captured. No third-party deps.

Decode:
  python otel_capture.py --decode <capture-N.bin>          # OTLP span JSON
  python -c "import otel_capture as C; C.decode_file(...)"

The decoder is a generic protobuf wire-format reader; OTLP field numbers are
mapped only when building the span summary, so unknown attributes still show
up as raw field trees instead of being silently dropped.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


# ---------------------------------------------------------------- wire format
def pb_read_varint(data: bytes, pos: int):
    result = 0
    shift = 0
    while True:
        if pos >= len(data):
            raise ValueError("varint truncated")
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7
        if shift > 70:
            raise ValueError("varint too long")


def pb_fields(data: bytes):
    """Yield (field_number, wire_type, value) where value is int or bytes."""
    pos = 0
    n = len(data)
    while pos < n:
        key, pos = pb_read_varint(data, pos)
        field, wire = key >> 3, key & 7
        if wire == 0:
            value, pos = pb_read_varint(data, pos)
        elif wire == 1:
            value = data[pos:pos + 8]
            if len(value) != 8:
                raise ValueError("fixed64 truncated")
            pos += 8
        elif wire == 2:
            ln, pos = pb_read_varint(data, pos)
            value = data[pos:pos + ln]
            if len(value) != ln:
                raise ValueError("len-delimited truncated")
            pos += ln
        elif wire == 5:
            value = data[pos:pos + 4]
            if len(value) != 4:
                raise ValueError("fixed32 truncated")
            pos += 4
        else:
            raise ValueError("unsupported wire type %d" % wire)
        yield field, wire, value


def pb_tree(data: bytes):
    """Decode a protobuf message into {field_number: [values...]}.

    Length-delimited values are heuristically recursed: if the bytes parse as
    valid protobuf, keep the sub-tree (and keep the raw bytes alongside);
    otherwise keep bytes only.
    """
    out: dict = {}
    for field, wire, value in pb_fields(data):
        if wire == 2:
            entry = _pb_value(value)
        else:
            entry = value
        out.setdefault(str(field), []).append(entry)
    return out


def _pb_value(raw: bytes):
    try:
        text = raw.decode("utf-8")
        if text.isprintable():
            return text
    except Exception:
        pass
    try:
        sub = pb_tree(raw)
        if sub:
            return {"pb": sub, "raw": raw.hex()}
    except Exception:
        pass
    return {"hex": raw.hex()}


# ---------------------------------------------------------------- OTLP mapping
SPAN_KIND = {0: "unspecified", 1: "internal", 2: "server",
             3: "client", 4: "producer", 5: "consumer"}

# OTLP trace.proto field numbers (opentelemetry-proto v1.x)
SPAN_FIELDS = {
    1: "trace_id", 2: "span_id", 3: "trace_state", 4: "parent_span_id",
    5: "name", 6: "kind", 7: "start_unix_nano", 8: "end_unix_nano",
}


def _attr_value(av):
    if not isinstance(av, dict):  # already a plain text/int decode
        return av
    pb = av.get("pb", {})
    for num, key in (("1", "string_value"), ("2", "bool_value"),
                     ("3", "int_value"), ("4", "double_value"),
                     ("7", "bytes_value")):
        if num in pb:
            v = pb[num][0]
            if isinstance(v, dict):
                return v
            return v
    if "5" in pb:  # ArrayValue -> field 2 is repeated AnyValue "values"
        arr = pb["5"][0].get("pb", {}).get("2", [])
        return [_attr_value(v) for v in arr]
    if "6" in pb:  # KeyValueList -> field 1 is repeated KeyValue
        kvs = pb["6"][0].get("pb", {}).get("1", [])
        return {kv.get("key"): _attr_value(v.get("value", {}))
                for kv in kvs for v in [kv.get("pb", {})]
                if isinstance(kv, dict)}
    return None


def _attributes(msg_pb: dict) -> dict:
    attrs = {}
    for kv in msg_pb.get("9", []):  # Span.attributes = field 9
        if not isinstance(kv, dict):
            continue
        sub = kv.get("pb", {})
        key = sub.get("1", [None])[0]
        val = _attr_value(sub.get("2", [{}])[0]) if "2" in sub else None
        if key:
            attrs[key] = val
    return attrs


def _hex_id(v):
    if isinstance(v, dict):
        if "raw" in v:
            return v["raw"]
        if "hex" in v:
            return v["hex"]
    if isinstance(v, bytes):
        return v.hex()
    return v


def _nano(v):
    if isinstance(v, bytes) and len(v) == 8:
        return int.from_bytes(v, "little")
    return v


def _span_scalar_fields(raw: bytes) -> dict:
    """Re-read a Span message's raw bytes for id/name/time fields, whose
    payload bytes can accidentally re-parse as protobuf, so must not be
    trusted to the recursive decoder. Field numbers per OTLP trace.proto:
    1 trace_id, 2 span_id, 3 trace_state, 4 parent_span_id, 5 name, 6 kind,
    7/8 start/end fixed64."""
    out = {}
    for field, wire, value in pb_fields(raw):
        key = SPAN_FIELDS.get(field)
        if key is None:
            continue
        if field == 6 and wire == 0:
            out[key] = value
        elif wire == 2:
            if field in (1, 2, 4):
                out[key] = value.hex()
            else:
                try:
                    out[key] = value.decode("utf-8")
                except Exception:
                    out[key] = value.hex()
        elif wire == 1:
            out[key] = int.from_bytes(value, "little")
    return out


def decode_trace_export(body: bytes) -> dict:
    """Decode OTLP ExportTraceServiceRequest into a span list + resource map."""
    spans = []
    resources = []
    for rs in pb_tree(body).get("1", []):           # repeated ResourceSpans
        if not isinstance(rs, dict):
            continue
        rs_pb = rs.get("pb", {})
        res_attrs = {}
        for res in rs_pb.get("1", []):              # Resource
            if isinstance(res, dict):
                res_attrs = _attributes(res.get("pb", {}))
        resources.append(res_attrs)
        for ss in rs_pb.get("2", []):               # repeated ScopeSpans
            if not isinstance(ss, dict):
                continue
            ss_pb = ss.get("pb", {})
            scope = {}
            for sc in ss_pb.get("1", []):           # InstrumentationScope
                if isinstance(sc, dict):
                    spb = sc.get("pb", {})
                    scope = {"name": spb.get("1", [None])[0],
                             "version": spb.get("2", [None])[0]}
            for sp in ss_pb.get("2", []):           # repeated Span
                if not isinstance(sp, dict):
                    continue
                spb = sp.get("pb", {})
                raw = sp.get("raw")
                scalar = (_span_scalar_fields(bytes.fromhex(raw))
                          if isinstance(raw, str) else {})
                kind = scalar.get("kind", spb.get("6", [None])[0])
                span = {
                    "trace_id": scalar.get("trace_id",
                                           _hex_id(spb.get("1", [None])[0])),
                    "span_id": scalar.get("span_id",
                                          _hex_id(spb.get("2", [None])[0])),
                    "parent_span_id": scalar.get("parent_span_id",
                                                 _hex_id(spb.get("4", [None])[0])),
                    "name": scalar.get("name", spb.get("5", [None])[0]),
                    "kind": SPAN_KIND.get(kind, kind),
                    "start_unix_nano": scalar.get(
                        "start_unix_nano", _nano(spb.get("7", [None])[0])),
                    "end_unix_nano": scalar.get(
                        "end_unix_nano", _nano(spb.get("8", [None])[0])),
                    "attributes": _attributes(spb),
                    "status": None,
                    "scope": scope,
                }
                for st in spb.get("15", []):        # Status
                    if isinstance(st, dict):
                        stpb = st.get("pb", {})
                        span["status"] = {"code": stpb.get("3", [None])[0],
                                          "message": stpb.get("2", [None])[0]}
                spans.append(span)
    return {"spans": spans, "resources": resources}


def decode_log_export(body: bytes) -> dict:
    """Decode OTLP ExportLogsServiceRequest into log records with attributes.
    Export.resource_logs=1; ResourceLogs.resource=1, scope_logs=2;
    ScopeLogs.scope=1, log_records=2. This AG build (opentelemetry 0.33.1)
    emits LogRecord {2 severity_number, 3 severity_text, 5 body, 6
    attributes}; the current proto uses 9 for attributes, so accept both."""
    records = []
    for rl in pb_tree(body).get("1", []):
        if not isinstance(rl, dict):
            continue
        rl_pb = rl.get("pb", {})
        for sl in rl_pb.get("2", []):
            if not isinstance(sl, dict):
                continue
            sl_pb = sl.get("pb", {})
            for lr in sl_pb.get("2", []):
                if not isinstance(lr, dict):
                    continue
                lrb = lr.get("pb", {})
                attrs = _attributes_at(lrb, "6")
                if not attrs:
                    attrs = _attributes_at(lrb, "9")
                body_v = None
                for b in lrb.get("5", []) + lrb.get("8", []):
                    if isinstance(b, dict):
                        body_v = _attr_value(b)
                records.append({"attributes": attrs,
                                "body": body_v,
                                "raw_len": lr.get("raw_len")})
    return {"records": records}


def _attributes_at(msg_pb: dict, field: str) -> dict:
    attrs = {}
    for kv in msg_pb.get(field, []):
        if not isinstance(kv, dict):
            continue
        sub = kv.get("pb", {})
        key = sub.get("1", [None])[0]
        val = _attr_value(sub.get("2", [{}])[0]) if "2" in sub else None
        if key:
            attrs[key] = val
    return attrs


def decode_file(path, kind=None) -> dict:
    """Decode a captured body. kind: 'traces'|'logs'|None; None = guess from
    decode success (a logs body can mis-parse as a garbage trace, so prefer
    the explicit kind when available)."""
    body = Path(path).read_bytes()
    out = {"file": str(path), "length": len(body), "kind": kind}
    if kind == "logs":
        try:
            out["logs"] = decode_log_export(body)
            out["decoded"] = True
        except Exception as exc:
            out["decoded"] = False
            out["error"] = repr(exc)
        return out
    if kind == "traces":
        try:
            out["otlp"] = decode_trace_export(body)
            out["decoded"] = True
        except Exception as exc:
            out["decoded"] = False
            out["error"] = repr(exc)
        return out
    try:
        out["otlp"] = decode_trace_export(body)
        out["decoded"] = True
        if out["otlp"].get("spans"):
            return out
        out["logs"] = decode_log_export(body)
    except Exception as exc:
        try:
            out["logs"] = decode_log_export(body)
            out["decoded"] = True
            out.pop("otlp", None)
        except Exception as exc2:
            out["decoded"] = False
            out["error"] = repr(exc2)
    return out


def span_tree(decoded: dict) -> list:
    """Group spans of the first resource into a parent->children tree."""
    spans = decoded.get("spans", [])
    by_id = {s["span_id"]: s for s in spans if s.get("span_id")}
    roots = []
    children: dict = {}
    for s in spans:
        parent = s.get("parent_span_id") or ""
        if parent in by_id:
            children.setdefault(parent, []).append(s)
        else:
            roots.append(s)
    def node(s):
        return {"span": s, "children": [node(c) for c in children.get(s["span_id"], [])]}
    return [node(r) for r in roots]


# ---------------------------------------------------------------- HTTP capture
class CaptureServer:
    def __init__(self, out_dir, port=4318):
        self.out = Path(out_dir)
        self.out.mkdir(parents=True, exist_ok=True)
        self.hits: list = []
        self.lock = threading.Lock()
        self.counter = 0
        self.port = port
        self.httpd = None

    def start(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, fmt, *args):
                return

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length)
                with outer.lock:
                    outer.counter += 1
                    idx = outer.counter
                fpath = outer.out / ("capture-%03d.bin" % idx)
                fpath.write_bytes(body)
                hit = {"ts": round(time.time(), 3), "n": idx, "path": self.path,
                       "content_type": self.headers.get("Content-Type"),
                       "length": len(body), "file": fpath.name}
                with outer.lock:
                    outer.hits.append(hit)
                    with open(outer.out / "hits.jsonl", "a", encoding="utf-8") as fh:
                        fh.write(json.dumps(hit) + "\n")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            def do_GET(self):
                with outer.lock:
                    payload = json.dumps({"hits": outer.hits}, indent=1).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        class QuietServer(ThreadingHTTPServer):
            daemon_threads = True

            def handle_error(self, request, client_address):
                # AG's exporter resets keep-alive connections on shutdown;
                # that noise is not evidence.
                pass

        self.httpd = QuietServer(("127.0.0.1", self.port), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None

    def summary(self) -> dict:
        with self.lock:
            return {"count": len(self.hits), "hits": list(self.hits)}

    def decoded(self) -> list:
        with self.lock:
            hits = list(self.hits)
        out = []
        for h in hits:
            path = self.out / h["file"]
            kind = None
            hit_path = h.get("path") or ""
            if "logs" in hit_path:
                kind = "logs"
            elif "trace" in hit_path:
                kind = "traces"
            out.append(decode_file(path, kind=kind))
        return out


def main(argv) -> int:
    if "--decode" in argv:
        i = argv.index("--decode")
        print(json.dumps(decode_file(argv[i + 1]), indent=1, ensure_ascii=False))
        return 0
    port = 4318
    out = ".e19-tmp/otlp"
    seconds = 30.0
    if "--port" in argv:
        port = int(argv[argv.index("--port") + 1])
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]
    if "--seconds" in argv:
        seconds = float(argv[argv.index("--seconds") + 1])
    srv = CaptureServer(out, port=port).start()
    print("capturing on 127.0.0.1:%d -> %s for %.0fs" % (port, out, seconds),
          flush=True)
    deadline = time.time() + seconds
    try:
        while time.time() < deadline:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    srv.stop()
    print(json.dumps(srv.summary(), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
