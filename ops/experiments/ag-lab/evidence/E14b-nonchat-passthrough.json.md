{
  "probes": [
    {
      "path": "/v1/embeddings",
      "model": "vm-e14b",
      "client": {
        "status": 200,
        "body": "{\"object\": \"list\", \"model\": \"model-ok\", \"data\": [{\"object\": \"embedding\", \"index\": 0, \"embedding\": [0.01, 0.02, 0.03]}], \"usage\": {\"prompt_tokens\": 1, \"completion_tokens\": 0, \"total_tokens\": 1}}"
      },
      "counters": {
        "/ok": 1
      }
    },
    {
      "path": "/v1/images/generations",
      "model": "vm-e14b",
      "client": {
        "status": 200,
        "body": "{\"created\":1795024338,\"data\":[{\"url\":\"http://127.0.0.1:8099/mock-image.png\"}]}"
      },
      "counters": {
        "/ok": 1
      }
    },
    {
      "path": "/v1/systemone",
      "model": "vm-e14b",
      "client": {
        "status": 400,
        "body": "failed to process LLM request: failed to parse SystemOne request: missing field `state`"
      },
      "counters": {},
      "fallback_model_m_ok": {
        "client": {
          "status": 404,
          "body": "{\"error\":{\"message\":\"Model not found\",\"type\":\"invalid_request_error\",\"code\":\"model_not_found\"}}"
        }
      },
      "fallback_counters": {}
    }
  ],
  "request_logs": {
    "rows": [
      {
        "id": "01a1efc9-bbef-7724-b95f-1575b7e6d819",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "embeddings",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "1",
        "output_tokens": "None",
        "duration_ms": "3",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-bd9e-71a4-9ec8-15608238267c",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "image_generation",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "vm-e14b",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-bf5a-731e-9066-55cb61eea3ec",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "400",
        "error": "failed to process LLM request: failed to parse SystemOne request: missing field `state`",
        "gen_ai_operation_name": "None",
        "gen_ai_provider_name": "None",
        "gen_ai_request_model": "None",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-c0f9-72b9-8308-d7dfa9415e07",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "404",
        "error": "None",
        "gen_ai_operation_name": "None",
        "gen_ai_provider_name": "None",
        "gen_ai_request_model": "None",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      }
    ],
    "attribute_samples": [
      "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61821\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/embeddings\",\"http.versio",
      "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:62026\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/images/generations\",\"htt",
      "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:62267\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/systemone\",\"http.version"
    ]
  },
  "ag_log_tail": "2026-11-18T17:52:16.912687Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-18T17:52:16.964397Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-18T17:52:16.965167Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-18T17:52:16.966522Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.3617ms\n2026-11-18T17:52:16.968377Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-18T17:52:16.974864Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-18T17:52:16.975585Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-18T17:52:16.975954Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (63.6159ms), still awaiting 1 tasks\t\n2026-11-18T17:52:16.976921Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-18T17:52:16.976944Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (64.6045ms), marking server ready\t\n2026-11-18T17:52:16.976960Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-18T17:52:16.977035Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-18T17:52:16.977124Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-18T17:52:17.902946Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61821 http.method=POST http.host=127.0.0.1 http.path=/v1/embeddings http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=embeddings gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14b gen_ai.usage.input_tokens=1 duration=3ms\n2026-11-18T17:52:18.334693Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:62026 http.method=POST http.host=127.0.0.1 http.path=/v1/images/generations http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=image_generation gen_ai.provider.name=openai gen_ai.request.model=vm-e14b agw.ai.original_model=vm-e14b duration=1ms\n2026-11-18T17:52:18.777907Z\terror\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:62267 http.method=POST http.host=127.0.0.1 http.path=/v1/systemone http.version=HTTP/1.1 http.status=400 protocol=llm agw.ai.original_model=vm-e14b error=\"failed to process LLM request: failed to parse SystemOne request: missing field `state`\" reason=InvalidRequest duration=0ms\n2026-11-18T17:52:19.193184Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request src.addr=127.0.0.1:62395 http.method=POST http.host=127.0.0.1 http.path=/v1/systemone http.version=HTTP/1.1 http.status=404 protocol=llm agw.ai.original_model=m-ok reason=DirectResponse duration=0ms",
  "binary": {
    "binary": "C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  },
  "notes_post_run": [
    "POST /v1/embeddings: passed through to provider baseUrl + path; AG rewrote body model vm-e14b -> upstream name model-ok (client response echoes mock's model=model-ok); gen_ai_operation_name=embeddings; input_tokens=1 recorded from mock usage.",
    "POST /v1/images/generations: passed through verbatim; body model NOT rewritten (AG log gen_ai.request.model=vm-e14b); gen_ai_operation_name=image_generation; no tokens recorded (mock images response has no usage).",
    "POST /v1/systemone: NOT passed through. AG recognises the path as a SystemOne-format LLM request and validates the body: client 400 'failed to process LLM request: failed to parse SystemOne request: missing field `state`' (reason=InvalidRequest); upstream hit 0 times. 'SystemOne' appears 5x in schema-config.json and in the binary strings.",
    "request_logs rows: 200 embeddings (op=embeddings), 200 image_generation (op=image_generation), 400 systemone (op=NULL, error filled), 404 fallback direct internal-model attempt (op=NULL)."
  ]
}