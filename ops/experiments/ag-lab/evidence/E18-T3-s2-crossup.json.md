{
  "config": {
    "file": "cfg-E18-T3-s2-crossup.yaml"
  },
  "client_model": "vm-e18kn",
  "same_group": false,
  "use_kn": true,
  "retry": "attempts=2 codes=[500] backoff=100ms",
  "health": {
    "unhealthyExpression": "response.code >= 400",
    "eviction": {
      "consecutiveFailures": 1
    }
  },
  "models_listing": {
    "status": 200,
    "body": "{\"object\":\"list\",\"data\":[{\"id\":\"vm-e18kn\",\"object\":\"model\",\"created\":1795105123,\"owned_by\":\"virtual\"}]}"
  },
  "trials": [
    {
      "status": 200,
      "duration_ms": 3.7,
      "error": null,
      "hits_a": [],
      "hits_b": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ]
    },
    {
      "status": 200,
      "duration_ms": 2.8,
      "error": null,
      "hits_a": [],
      "hits_b": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ]
    },
    {
      "status": 200,
      "duration_ms": 120.7,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-a",
          "model": "code-500"
        }
      ],
      "hits_b": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ]
    },
    {
      "status": 200,
      "duration_ms": 20.5,
      "error": null,
      "hits_a": [],
      "hits_b": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ]
    },
    {
      "status": 200,
      "duration_ms": 25.5,
      "error": null,
      "hits_a": [],
      "hits_b": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ]
    },
    {
      "status": 200,
      "duration_ms": 2.4,
      "error": null,
      "hits_a": [],
      "hits_b": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ]
    },
    {
      "status": 200,
      "duration_ms": 19.2,
      "error": null,
      "hits_a": [],
      "hits_b": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ]
    },
    {
      "status": 200,
      "duration_ms": 25.8,
      "error": null,
      "hits_a": [],
      "hits_b": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ]
    },
    {
      "status": 200,
      "duration_ms": 25.9,
      "error": null,
      "hits_a": [],
      "hits_b": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ]
    },
    {
      "status": 200,
      "duration_ms": 2.1,
      "error": null,
      "hits_a": [],
      "hits_b": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ]
    }
  ],
  "mock_a_stats": {
    "status": 200,
    "body": "{\"counters\": {\"/v1\": 1}}"
  },
  "mock_b_stats": {
    "status": 200,
    "body": "{\"counters\": {\"/v1\": 10}}"
  },
  "client_status_counts": {
    "200": 10
  },
  "durations_ms": [
    3.7,
    2.8,
    120.7,
    20.5,
    25.5,
    2.4,
    19.2,
    25.8,
    25.9,
    2.1
  ],
  "ag_log": {
    "head": [
      "2026-11-19T16:18:43.219456Z\tinfo\tagentgateway_app::commands::run\tversion: True\t",
      "2026-11-19T16:18:43.236367Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t",
      "2026-11-19T16:18:43.237758Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.3956ms",
      "2026-11-19T16:18:43.239700Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3926 component=\"readiness\"",
      "2026-11-19T16:18:43.247968Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\.e18-tmp\\\\T3-s2-crossup\\\\run-config.yaml\")\t",
      "2026-11-19T16:18:43.248714Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\.e18-tmp\\T3-s2-crossup\\run-config.yaml\t",
      "2026-11-19T16:18:43.249158Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (29.8645ms), still awaiting 1 tasks\t",
      "2026-11-19T16:18:43.249330Z\tinfo\tapp\tserving UI at http://127.0.0.1:3924/ui\t",
      "2026-11-19T16:18:43.249339Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (30.0452ms), marking server ready\t",
      "2026-11-19T16:18:43.249345Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3924 component=\"admin\"",
      "2026-11-19T16:18:43.249423Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3925 component=\"stats\"",
      "2026-11-19T16:18:43.249458Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3696\"",
      "2026-11-19T16:18:43.689790Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request src.addr=127.0.0.1:52818 http.method=GET http.host=127.0.0.1 http.path=/v1/models http.version=HTTP/1.1 http.status=200 protocol=llm reason=DirectResponse duration=1ms",
      "2026-11-19T16:18:43.707925Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52821 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=2ms",
      "2026-11-19T16:18:43.716797Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52823 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.842992Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52824 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 retry.attempt=1 duration=109ms",
      "2026-11-19T16:18:43.873336Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52826 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.903978Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52827 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.910870Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52828 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.935849Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52829 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.966411Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52830 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.998184Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52831 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:44.005547Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52832 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms"
    ],
    "tail": [
      "2026-11-19T16:18:43.219456Z\tinfo\tagentgateway_app::commands::run\tversion: True\t",
      "2026-11-19T16:18:43.236367Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t",
      "2026-11-19T16:18:43.237758Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.3956ms",
      "2026-11-19T16:18:43.239700Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3926 component=\"readiness\"",
      "2026-11-19T16:18:43.247968Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\.e18-tmp\\\\T3-s2-crossup\\\\run-config.yaml\")\t",
      "2026-11-19T16:18:43.248714Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\.e18-tmp\\T3-s2-crossup\\run-config.yaml\t",
      "2026-11-19T16:18:43.249158Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (29.8645ms), still awaiting 1 tasks\t",
      "2026-11-19T16:18:43.249330Z\tinfo\tapp\tserving UI at http://127.0.0.1:3924/ui\t",
      "2026-11-19T16:18:43.249339Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (30.0452ms), marking server ready\t",
      "2026-11-19T16:18:43.249345Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3924 component=\"admin\"",
      "2026-11-19T16:18:43.249423Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3925 component=\"stats\"",
      "2026-11-19T16:18:43.249458Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3696\"",
      "2026-11-19T16:18:43.689790Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request src.addr=127.0.0.1:52818 http.method=GET http.host=127.0.0.1 http.path=/v1/models http.version=HTTP/1.1 http.status=200 protocol=llm reason=DirectResponse duration=1ms",
      "2026-11-19T16:18:43.707925Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52821 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=2ms",
      "2026-11-19T16:18:43.716797Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52823 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.842992Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52824 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 retry.attempt=1 duration=109ms",
      "2026-11-19T16:18:43.873336Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52826 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.903978Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52827 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.910870Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52828 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.935849Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52829 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.966411Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52830 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:43.998184Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52831 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:44.005547Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8097 src.addr=127.0.0.1:52832 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms"
    ]
  },
  "request_logs": {
    "row_count": 11,
    "rows": [
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:43.687903+00:00",
        "completed_at": "2026-11-19T16:18:43.689750+00:00",
        "duration_ms": 1.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": null,
        "gen_ai_provider_name": null,
        "gen_ai_request_model": null,
        "gen_ai_response_model": null,
        "input_tokens": null,
        "output_tokens": null,
        "total_tokens": null,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 0,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"src.addr\":\"127.0.0.1:52818\",\"http.meth"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:43.705346+00:00",
        "completed_at": "2026-11-19T16:18:43.707889+00:00",
        "duration_ms": 2.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "ok-b",
        "gen_ai_response_model": "ok-b",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8097\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:43.715344+00:00",
        "completed_at": "2026-11-19T16:18:43.716772+00:00",
        "duration_ms": 1.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "ok-b",
        "gen_ai_response_model": "ok-b",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8097\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:43.732995+00:00",
        "completed_at": "2026-11-19T16:18:43.842957+00:00",
        "duration_ms": 109.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "ok-b",
        "gen_ai_response_model": "ok-b",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8097\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:43.871830+00:00",
        "completed_at": "2026-11-19T16:18:43.873313+00:00",
        "duration_ms": 1.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "ok-b",
        "gen_ai_response_model": "ok-b",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8097\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:43.902860+00:00",
        "completed_at": "2026-11-19T16:18:43.903955+00:00",
        "duration_ms": 1.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "ok-b",
        "gen_ai_response_model": "ok-b",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8097\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:43.909478+00:00",
        "completed_at": "2026-11-19T16:18:43.910840+00:00",
        "duration_ms": 1.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "ok-b",
        "gen_ai_response_model": "ok-b",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8097\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:43.934478+00:00",
        "completed_at": "2026-11-19T16:18:43.935825+00:00",
        "duration_ms": 1.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "ok-b",
        "gen_ai_response_model": "ok-b",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8097\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:43.965087+00:00",
        "completed_at": "2026-11-19T16:18:43.966388+00:00",
        "duration_ms": 1.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "ok-b",
        "gen_ai_response_model": "ok-b",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8097\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:43.997089+00:00",
        "completed_at": "2026-11-19T16:18:43.998161+00:00",
        "duration_ms": 1.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "ok-b",
        "gen_ai_response_model": "ok-b",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8097\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:44.004469+00:00",
        "completed_at": "2026-11-19T16:18:44.005517+00:00",
        "duration_ms": 1.0,
        "trace_id": null,
        "span_id": null,
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "ok-b",
        "gen_ai_response_model": "ok-b",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": "lab-client",
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8097\",\"src.addr\":"
      }
    ]
  },
  "binary": {
    "binary": "ops/experiments/ag-lab/bin-e14/agentgateway.exe",
    "version": "v1.7.0",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c"
  }
}
