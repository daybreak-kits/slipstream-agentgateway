{
  "llm_trials": [
    {
      "n": 1,
      "status": 401,
      "body": "{\"status\":401,\"title\":\"Unauthorized\",\"detail\":\"Invalid JWT serialization: Missing dot delimiter(s)\"}"
    },
    {
      "n": 2,
      "status": 401,
      "body": "{\"status\":401,\"title\":\"Unauthorized\",\"detail\":\"Invalid JWT serialization: Missing dot delimiter(s)\"}"
    },
    {
      "n": 3,
      "status": 401,
      "body": "{\"status\":401,\"title\":\"Unauthorized\",\"detail\":\"Invalid JWT serialization: Missing dot delimiter(s)\"}"
    },
    {
      "n": 4,
      "status": 401,
      "body": "{\"status\":401,\"title\":\"Unauthorized\",\"detail\":\"Invalid JWT serialization: Missing dot delimiter(s)\"}"
    },
    {
      "n": 5,
      "status": 401,
      "body": "{\"status\":401,\"title\":\"Unauthorized\",\"detail\":\"Invalid JWT serialization: Missing dot delimiter(s)\"}"
    }
  ],
  "llm_upstream_hits": 5,
  "plain": {
    "401": {
      "client": {
        "status": 401,
        "body": "{\"spec\": \"401\", \"hit\": 3, \"status\": 401}"
      },
      "counters": {
        "/plain/401": 3
      }
    },
    "404": {
      "client": {
        "status": 404,
        "body": "{\"spec\": \"404\", \"hit\": 3, \"status\": 404}"
      },
      "counters": {
        "/plain/404": 3
      }
    }
  },
  "request_logs": {
    "rows": [
      {
        "id": "01a1f216-2b68-77c4-ad79-bba3efb6d17a",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "401",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "551",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f216-3167-737c-b2e6-cf37214e3288",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "401",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "510",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f216-3732-73cf-a458-4928cccfdd9b",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "401",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "471",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f216-3ccf-73e4-b7ad-153f8fe9d1e8",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "401",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "424",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f216-426b-73e9-bc2b-1a6f6ff89943",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "401",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "434",
        "agentgateway_user": "lab-client"
      }
    ],
    "row_count": 5
  },
  "ag_log_tail": "2026-11-19T04:35:00.013407Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T04:35:00.032770Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T04:35:00.034185Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.4197ms\n2026-11-19T04:35:00.035812Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T04:35:00.045792Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T04:35:00.046776Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T04:35:00.047247Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (33.9989ms), still awaiting 1 tasks\t\n2026-11-19T04:35:00.047400Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T04:35:00.047409Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (34.1619ms), marking server ready\t\n2026-11-19T04:35:00.047416Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T04:35:00.047468Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T04:35:00.047490Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T04:35:00.047501Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3694\"\n2026-11-19T04:35:01.608324Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:55607 src.addr=127.0.0.1:55618 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s5 gen_ai.request.max_tokens=24 duration=551ms\n2026-11-19T04:35:03.143445Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:55607 src.addr=127.0.0.1:55621 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s5 gen_ai.request.max_tokens=24 duration=510ms\n2026-11-19T04:35:04.626306Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:55607 src.addr=127.0.0.1:55624 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s5 gen_ai.request.max_tokens=24 duration=471ms\n2026-11-19T04:35:06.063072Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:55607 src.addr=127.0.0.1:55639 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s5 gen_ai.request.max_tokens=24 duration=424ms\n2026-11-19T04:35:07.499791Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:55607 src.addr=127.0.0.1:49902 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s5 gen_ai.request.max_tokens=24 duration=434ms\n2026-11-19T04:35:08.760453Z\tinfo\trequest gateway=default/default listener=gw-lab route=default/retry-e15 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49906 http.method=POST http.host=127.0.0.1 http.path=/plain/401 http.version=HTTP/1.1 http.status=401 protocol=http retry.attempt=2 duration=223ms\n2026-11-19T04:35:09.435693Z\tinfo\trequest gateway=default/default listener=gw-lab route=default/retry-e15 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49911 http.method=POST http.host=127.0.0.1 http.path=/plain/404 http.version=HTTP/1.1 http.status=404 protocol=http retry.attempt=2 duration=219ms",
  "config": {
    "evidence_file": "cfg-E15-S5-retry-recheck.yaml",
    "note": "apiKey.file -> temp key file (gitignored); real key never written"
  },
  "model": "vm-e15-s5",
  "binary": {
    "binary": "C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
