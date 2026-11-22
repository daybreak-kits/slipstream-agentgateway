{
  "trials": [
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
  "request_logs": {
    "rows": [
      {
        "id": "01a1f214-9bd4-7097-8b8b-a48c7618154b",
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
        "duration_ms": "410",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f214-a120-7240-bce8-339660261da5",
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
        "duration_ms": "331",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f214-a5a7-70e0-9e24-af478b98ff82",
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
        "duration_ms": "146",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f214-aa23-764c-99c0-055ebb4b0a85",
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
        "duration_ms": "125",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f214-aead-71c4-8e0b-aebe9c55128c",
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
        "duration_ms": "159",
        "agentgateway_user": "lab-client"
      }
    ],
    "row_count": 5
  },
  "ag_log_tail": "2026-11-19T04:33:17.866236Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T04:33:17.883738Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T04:33:17.885645Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.9108ms\n2026-11-19T04:33:17.887960Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T04:33:17.899317Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T04:33:17.900217Z\tinfo\tstate_manager\tWatching config file: <local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T04:33:17.900840Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (34.7827ms), still awaiting 1 tasks\t\n2026-11-19T04:33:17.901070Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T04:33:17.901083Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (35.0253ms), marking server ready\t\n2026-11-19T04:33:17.901092Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T04:33:17.901150Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T04:33:17.901192Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T04:33:19.316627Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=integrate.api.nvidia.com:443 src.addr=127.0.0.1:52771 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s1 gen_ai.request.max_tokens=24 duration=410ms\n2026-11-19T04:33:20.672494Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=integrate.api.nvidia.com:443 src.addr=127.0.0.1:52774 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s1 gen_ai.request.max_tokens=24 duration=331ms\n2026-11-19T04:33:21.831595Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=integrate.api.nvidia.com:443 src.addr=127.0.0.1:52776 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s1 gen_ai.request.max_tokens=24 duration=146ms\n2026-11-19T04:33:22.979680Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=integrate.api.nvidia.com:443 src.addr=127.0.0.1:52777 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s1 gen_ai.request.max_tokens=24 duration=125ms\n2026-11-19T04:33:24.140996Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=integrate.api.nvidia.com:443 src.addr=127.0.0.1:52782 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning-30b-a3b agw.ai.original_model=vm-e15-s1 gen_ai.request.max_tokens=24 duration=159ms",
  "config": {
    "evidence_file": "cfg-E15-S1-bad-key-primary.yaml",
    "note": "apiKey.file -> temp key file (gitignored); real key never written"
  },
  "model": "vm-e15-s1",
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
