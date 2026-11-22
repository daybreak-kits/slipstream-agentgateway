{
  "trials": [
    {
      "chunks": 1,
      "first_token_s": 0.887,
      "done": false,
      "duration_s": 1.388,
      "error": null,
      "n": 1
    },
    {
      "chunks": 1,
      "first_token_s": 0.723,
      "done": false,
      "duration_s": 1.224,
      "error": null,
      "n": 2
    },
    {
      "chunks": 1,
      "first_token_s": 0.727,
      "done": false,
      "duration_s": 1.229,
      "error": null,
      "n": 3
    },
    {
      "chunks": 1,
      "first_token_s": 0.75,
      "done": false,
      "duration_s": 1.252,
      "error": null,
      "n": 4
    },
    {
      "chunks": 1,
      "first_token_s": 0.726,
      "done": false,
      "duration_s": 1.227,
      "error": null,
      "n": 5
    }
  ],
  "proxy_kills": 5,
  "request_logs": {
    "rows": [
      {
        "id": "01a1f214-f7c2-7353-8ce5-cd159776dfa9",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "response body failed: error reading a body from connection",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1368",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f214-fd52-730a-b28e-0d6aaaf3d44c",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "response body failed: error reading a body from connection",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1201",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f215-02e7-72e2-9b12-2e4b0391b295",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "response body failed: error reading a body from connection",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1209",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f215-0894-7048-9e46-1d6ad3a0d9c6",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "response body failed: error reading a body from connection",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1234",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f215-0e28-7730-afd6-f4ad98ee84e1",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "response body failed: error reading a body from connection",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1202",
        "agentgateway_user": "lab-client"
      }
    ],
    "row_count": 5
  },
  "ag_log_tail": "2026-11-19T04:33:40.454442Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T04:33:40.470682Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T04:33:40.472100Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.4224ms\n2026-11-19T04:33:40.473829Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T04:33:40.482768Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T04:33:40.483380Z\tinfo\tstate_manager\tWatching config file: <local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T04:33:40.483771Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (29.483ms), still awaiting 1 tasks\t\n2026-11-19T04:33:40.484114Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T04:33:40.484138Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (29.85ms), marking server ready\t\n2026-11-19T04:33:40.484157Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T04:33:40.484208Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T04:33:40.484343Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T04:33:42.850038Z\terror\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:52824 src.addr=127.0.0.1:52828 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b gen_ai.response.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s3 agw.ai.time_to_first_token=0.8685762 gen_ai.request.max_tokens=32 error=\"response body failed: error reading a body from connection\" duration=1368ms\n2026-11-19T04:33:42.850495Z\twarn\tproxy::gateway\tproxy error: error from user's Body stream\tconnection.id=2 src.addr=127.0.0.1:52828\n2026-11-19T04:33:44.274900Z\terror\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:52824 src.addr=127.0.0.1:52831 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b gen_ai.response.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s3 agw.ai.time_to_first_token=0.7007191 gen_ai.request.max_tokens=32 error=\"response body failed: error reading a body from connection\" duration=1201ms\n2026-11-19T04:33:44.275068Z\twarn\tproxy::gateway\tproxy error: error from user's Body stream\tconnection.id=3 src.addr=127.0.0.1:52831\n2026-11-19T04:33:45.703900Z\terror\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:52824 src.addr=127.0.0.1:52834 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b gen_ai.response.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s3 agw.ai.time_to_first_token=0.7085087 gen_ai.request.max_tokens=32 error=\"response body failed: error reading a body from connection\" duration=1209ms\n2026-11-19T04:33:45.704060Z\twarn\tproxy::gateway\tproxy error: error from user's Body stream\tconnection.id=4 src.addr=127.0.0.1:52834\n2026-11-19T04:33:47.156314Z\terror\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:52824 src.addr=127.0.0.1:52838 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b gen_ai.response.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s3 agw.ai.time_to_first_token=0.7339753 gen_ai.request.max_tokens=32 error=\"response body failed: error reading a body from connection\" duration=1234ms\n2026-11-19T04:33:47.156477Z\twarn\tproxy::gateway\tproxy error: error from user's Body stream\tconnection.id=5 src.addr=127.0.0.1:52838\n2026-11-19T04:33:48.584019Z\terror\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:52824 src.addr=127.0.0.1:52841 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b gen_ai.response.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s3 agw.ai.time_to_first_token=0.701761 gen_ai.request.max_tokens=32 error=\"response body failed: error reading a body from connection\" duration=1202ms\n2026-11-19T04:33:48.584138Z\twarn\tproxy::gateway\tproxy error: error from user's Body stream\tconnection.id=6 src.addr=127.0.0.1:52841",
  "config": {
    "evidence_file": "cfg-E15-S3-stream-kill.yaml",
    "note": "apiKey.file -> temp key file (gitignored); real key never written"
  },
  "model": "vm-e15-s3",
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
