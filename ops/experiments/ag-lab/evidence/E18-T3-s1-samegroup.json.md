{
  "config": {
    "file": "cfg-E18-T3-s1-samegroup.yaml"
  },
  "client_model": "vm-e18kn",
  "same_group": true,
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
    "body": "{\"object\":\"list\",\"data\":[{\"id\":\"vm-e18kn\",\"object\":\"model\",\"created\":1795105121,\"owned_by\":\"virtual\"}]}"
  },
  "trials": [
    {
      "status": 200,
      "duration_ms": 3.0,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ],
      "hits_b": []
    },
    {
      "status": 200,
      "duration_ms": 21.1,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ],
      "hits_b": []
    },
    {
      "status": 200,
      "duration_ms": 25.6,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ],
      "hits_b": []
    },
    {
      "status": 200,
      "duration_ms": 25.5,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ],
      "hits_b": []
    },
    {
      "status": 200,
      "duration_ms": 25.5,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ],
      "hits_b": []
    },
    {
      "status": 200,
      "duration_ms": 115.4,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-a",
          "model": "code-500"
        },
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ],
      "hits_b": []
    },
    {
      "status": 200,
      "duration_ms": 2.7,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ],
      "hits_b": []
    },
    {
      "status": 200,
      "duration_ms": 18.9,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ],
      "hits_b": []
    },
    {
      "status": 200,
      "duration_ms": 135.3,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-a",
          "model": "code-500"
        },
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ],
      "hits_b": []
    },
    {
      "status": 200,
      "duration_ms": 24.4,
      "error": null,
      "hits_a": [
        {
          "auth": "Bearer lab-key-b",
          "model": "ok-b"
        }
      ],
      "hits_b": []
    }
  ],
  "mock_a_stats": {
    "status": 200,
    "body": "{\"counters\": {\"/v1\": 12}}"
  },
  "client_status_counts": {
    "200": 10
  },
  "durations_ms": [
    3.0,
    21.1,
    25.6,
    25.5,
    25.5,
    115.4,
    2.7,
    18.9,
    135.3,
    24.4
  ],
  "ag_log": {
    "head": [
      "2026-11-19T16:18:41.008107Z\tinfo\tagentgateway_app::commands::run\tversion: True\t",
      "2026-11-19T16:18:41.026531Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t",
      "2026-11-19T16:18:41.027994Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.4664ms",
      "2026-11-19T16:18:41.029652Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3926 component=\"readiness\"",
      "2026-11-19T16:18:41.037212Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\.e18-tmp\\\\T3-s1-samegroup\\\\run-config.yaml\")\t",
      "2026-11-19T16:18:41.038122Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\.e18-tmp\\T3-s1-samegroup\\run-config.yaml\t",
      "2026-11-19T16:18:41.038750Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (30.8135ms), still awaiting 1 tasks\t",
      "2026-11-19T16:18:41.038962Z\tinfo\tapp\tserving UI at http://127.0.0.1:3924/ui\t",
      "2026-11-19T16:18:41.038976Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (31.0395ms), marking server ready\t",
      "2026-11-19T16:18:41.038984Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3924 component=\"admin\"",
      "2026-11-19T16:18:41.039062Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3696\"",
      "2026-11-19T16:18:41.039080Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3925 component=\"stats\"",
      "2026-11-19T16:18:41.460921Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request src.addr=127.0.0.1:52798 http.method=GET http.host=127.0.0.1 http.path=/v1/models http.version=HTTP/1.1 http.status=200 protocol=llm reason=DirectResponse duration=1ms",
      "2026-11-19T16:18:41.465616Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52800 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=2ms",
      "2026-11-19T16:18:41.491407Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52802 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:41.523486Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52803 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:41.553360Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52804 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:41.584174Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52805 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:41.707182Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52806 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 retry.attempt=1 duration=114ms",
      "2026-11-19T16:18:41.715335Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52807 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=0ms",
      "2026-11-19T16:18:41.739328Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52808 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:41.879520Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52809 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 retry.attempt=1 duration=110ms",
      "2026-11-19T16:18:41.909457Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52810 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms"
    ],
    "tail": [
      "2026-11-19T16:18:41.008107Z\tinfo\tagentgateway_app::commands::run\tversion: True\t",
      "2026-11-19T16:18:41.026531Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t",
      "2026-11-19T16:18:41.027994Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.4664ms",
      "2026-11-19T16:18:41.029652Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3926 component=\"readiness\"",
      "2026-11-19T16:18:41.037212Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\.e18-tmp\\\\T3-s1-samegroup\\\\run-config.yaml\")\t",
      "2026-11-19T16:18:41.038122Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\.e18-tmp\\T3-s1-samegroup\\run-config.yaml\t",
      "2026-11-19T16:18:41.038750Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (30.8135ms), still awaiting 1 tasks\t",
      "2026-11-19T16:18:41.038962Z\tinfo\tapp\tserving UI at http://127.0.0.1:3924/ui\t",
      "2026-11-19T16:18:41.038976Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (31.0395ms), marking server ready\t",
      "2026-11-19T16:18:41.038984Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3924 component=\"admin\"",
      "2026-11-19T16:18:41.039062Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3696\"",
      "2026-11-19T16:18:41.039080Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3925 component=\"stats\"",
      "2026-11-19T16:18:41.460921Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request src.addr=127.0.0.1:52798 http.method=GET http.host=127.0.0.1 http.path=/v1/models http.version=HTTP/1.1 http.status=200 protocol=llm reason=DirectResponse duration=1ms",
      "2026-11-19T16:18:41.465616Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52800 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=2ms",
      "2026-11-19T16:18:41.491407Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52802 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:41.523486Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52803 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:41.553360Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52804 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:41.584174Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52805 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:41.707182Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52806 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 retry.attempt=1 duration=114ms",
      "2026-11-19T16:18:41.715335Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52807 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=0ms",
      "2026-11-19T16:18:41.739328Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52808 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms",
      "2026-11-19T16:18:41.879520Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52809 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 retry.attempt=1 duration=110ms",
      "2026-11-19T16:18:41.909457Z\tinfo\trequest gateway=default/default listener=default route=internal/llm:request endpoint=127.0.0.1:8096 src.addr=127.0.0.1:52810 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=ok-b gen_ai.response.model=ok-b agw.ai.original_model=vm-e18kn gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 duration=1ms"
    ]
  },
  "request_logs": {
    "row_count": 11,
    "rows": [
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.459654+00:00",
        "completed_at": "2026-11-19T16:18:41.460882+00:00",
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"src.addr\":\"127.0.0.1:52798\",\"http.meth"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.463462+00:00",
        "completed_at": "2026-11-19T16:18:41.465585+00:00",
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8096\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.489972+00:00",
        "completed_at": "2026-11-19T16:18:41.491381+00:00",
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8096\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.521641+00:00",
        "completed_at": "2026-11-19T16:18:41.523457+00:00",
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8096\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.551909+00:00",
        "completed_at": "2026-11-19T16:18:41.553327+00:00",
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8096\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.582796+00:00",
        "completed_at": "2026-11-19T16:18:41.584135+00:00",
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8096\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.592883+00:00",
        "completed_at": "2026-11-19T16:18:41.707146+00:00",
        "duration_ms": 114.0,
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8096\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.714347+00:00",
        "completed_at": "2026-11-19T16:18:41.715312+00:00",
        "duration_ms": 0.0,
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8096\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.737832+00:00",
        "completed_at": "2026-11-19T16:18:41.739293+00:00",
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8096\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.768955+00:00",
        "completed_at": "2026-11-19T16:18:41.879494+00:00",
        "duration_ms": 110.0,
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8096\",\"src.addr\":"
      },
      {
        "id": "01a1f49a",
        "started_at": "2026-11-19T16:18:41.907694+00:00",
        "completed_at": "2026-11-19T16:18:41.909413+00:00",
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
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"default\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8096\",\"src.addr\":"
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
