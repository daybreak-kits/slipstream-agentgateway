{
  "section": "T1-A4 wrong key 401 passthrough",
  "config": {
    "evidence_file": "cfg-E17-T1-wrongkey.yaml",
    "note": "backendAuth key {file: ...} -> gitignored .e17-tmp key file; real key never written"
  },
  "client": {
    "status": 403,
    "body": "{\"status\":403,\"title\":\"Forbidden\",\"detail\":\"Authorization failed\"}",
    "duration_s": 0.573,
    "error": null
  },
  "request_logs": {
    "row_count": 1,
    "rows": [
      {
        "id": "01a1f2fa",
        "started_at": "2026-11-19T08:43:59.502884+00:00",
        "completed_at": "2026-11-19T08:44:00.056580+00:00",
        "duration_ms": 553.0,
        "trace_id": "",
        "span_id": "",
        "http_status": 403,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": null,
        "input_tokens": null,
        "output_tokens": null,
        "total_tokens": null,
        "cost": null,
        "agentgateway_user": null,
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"gw-t1\",\"route\":\"default/ai-t1\",\"endpoint\":\"integrate.api.nvidia.com:443\",\"src.addr\":\"127.0.0.1:63643\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":403,\"protocol\":\"llm\",\"gen_ai.operation.name\":\"chat\",\"gen_ai.provider.name\":\"openai\",\"gen_ai.request.model\":\"nvidia/nemotron-3.5-lightning"
      }
    ]
  },
  "direct_upstream": {
    "status": 403,
    "body": "{\"status\":403,\"title\":\"Forbidden\",\"detail\":\"Authorization failed\"}"
  },
  "verbatim_equal": true,
  "status_equal": true,
  "binary": {
    "binary": "C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints true)",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
