{
  "trials": [
    {
      "n": 1,
      "status": 404,
      "body": "404 page not found\n"
    },
    {
      "n": 2,
      "status": 404,
      "body": "404 page not found\n"
    },
    {
      "n": 3,
      "status": 404,
      "body": "404 page not found\n"
    },
    {
      "n": 4,
      "status": 404,
      "body": "404 page not found\n"
    },
    {
      "n": 5,
      "status": 404,
      "body": "404 page not found\n"
    }
  ],
  "request_logs": {
    "rows": [
      {
        "id": "01a1f214-c44a-77de-bc69-f72c11828891",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "404",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "e15-fabricated-model-xyz",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "376",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f214-c9aa-764e-b0bf-25efa78227d2",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "404",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "e15-fabricated-model-xyz",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "358",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f214-ce90-7273-8016-f8792c0528f9",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "404",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "e15-fabricated-model-xyz",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "237",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f214-d2f9-745a-b24e-1caf42408dd1",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "404",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "e15-fabricated-model-xyz",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "126",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1f214-d78d-74ac-b7b7-276ddae29d71",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "404",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "e15-fabricated-model-xyz",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "155",
        "agentgateway_user": "lab-client"
      }
    ],
    "row_count": 5
  },
  "ag_log_tail": "2026-11-19T04:33:28.269829Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T04:33:28.285791Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T04:33:28.287259Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.4715ms\n2026-11-19T04:33:28.289063Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T04:33:28.298246Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T04:33:28.299625Z\tinfo\tstate_manager\tWatching config file: <local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T04:33:28.300227Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (30.5585ms), still awaiting 1 tasks\t\n2026-11-19T04:33:28.300376Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T04:33:28.300386Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (30.7172ms), marking server ready\t\n2026-11-19T04:33:28.300392Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T04:33:28.300460Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T04:33:28.300485Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T04:33:29.674363Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=integrate.api.nvidia.com:443 src.addr=127.0.0.1:52802 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=404 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=e15-fabricated-model-xyz agw.ai.original_model=vm-e15-s2 gen_ai.request.max_tokens=24 duration=376ms\n2026-11-19T04:33:31.050286Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=integrate.api.nvidia.com:443 src.addr=127.0.0.1:52805 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=404 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=e15-fabricated-model-xyz agw.ai.original_model=vm-e15-s2 gen_ai.request.max_tokens=24 duration=358ms\n2026-11-19T04:33:32.304351Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=integrate.api.nvidia.com:443 src.addr=127.0.0.1:52807 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=404 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=e15-fabricated-model-xyz agw.ai.original_model=vm-e15-s2 gen_ai.request.max_tokens=24 duration=237ms\n2026-11-19T04:33:33.433758Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=integrate.api.nvidia.com:443 src.addr=127.0.0.1:52809 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=404 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=e15-fabricated-model-xyz agw.ai.original_model=vm-e15-s2 gen_ai.request.max_tokens=24 duration=126ms\n2026-11-19T04:33:34.605635Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=integrate.api.nvidia.com:443 src.addr=127.0.0.1:52810 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=404 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=e15-fabricated-model-xyz agw.ai.original_model=vm-e15-s2 gen_ai.request.max_tokens=24 duration=155ms",
  "config": {
    "evidence_file": "cfg-E15-S2-fabricated-model.yaml",
    "note": "apiKey.file -> temp key file (gitignored); real key never written"
  },
  "model": "vm-e15-s2",
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
