from __future__ import annotations
import json, urllib.request
import lab as L
from e12_ratelimit_retry import cfg_with, call

cfg = cfg_with(keys=[{"key": L.KEY, "metadata": {"name": "lab-client", "user_id": "u1"}}],
               local_rate_limit=[{"maxTokens": 2, "tokensPerFill": 0, "fillInterval": "1h",
                                  "type": "requests", "key": 'apiKey.metadata.user_id'}])
L.ensure_mock()
L.start_ag(cfg, fresh_db=True, tag="e12-metrics")
call("vm-e12")
text = urllib.request.urlopen("http://127.0.0.1:3922/metrics", timeout=5).read().decode("utf-8", "replace")
lines = [l for l in text.splitlines() if any(w in l.lower() for w in ("ratelimit", "rate_limit", "bucket", "local_rate"))]
heads = [l for l in text.splitlines() if l.startswith("# HELP")]
L.stop_ag()
print(json.dumps({"metric_names": heads, "ratelimit_lines": lines[:40], "total_lines": len(text.splitlines())}, indent=1))
