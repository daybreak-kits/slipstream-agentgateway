{
  "validate": {
    "exit": 0,
    "stdout": "Configuration is valid!",
    "stderr": ""
  },
  "route_policies": {
    "retry": {
      "attempts": 2,
      "codes": [
        429,
        500,
        502,
        503
      ],
      "backoff": "100ms"
    }
  },
  "plain": {
    "429": {
      "client": {
        "status": 429,
        "body": "{\"spec\": \"429\", \"hit\": 3, \"status\": 429}"
      },
      "counters": {
        "/plain/429": 3
      }
    },
    "500": {
      "client": {
        "status": 500,
        "body": "{\"spec\": \"500\", \"hit\": 3, \"status\": 500}"
      },
      "counters": {
        "/plain/500": 3
      }
    },
    "502": {
      "client": {
        "status": 502,
        "body": "{\"spec\": \"502\", \"hit\": 3, \"status\": 502}"
      },
      "counters": {
        "/plain/502": 3
      }
    },
    "503": {
      "client": {
        "status": 503,
        "body": "{\"spec\": \"503\", \"hit\": 3, \"status\": 503}"
      },
      "counters": {
        "/plain/503": 3
      }
    },
    "504": {
      "client": {
        "status": 504,
        "body": "{\"spec\": \"504\", \"hit\": 1, \"status\": 504}"
      },
      "counters": {
        "/plain/504": 1
      }
    }
  },
  "plain_seq": {
    "client": {
      "status": 200,
      "body": "{\"spec\": \"seq-500-200\", \"hit\": 2, \"status\": 200}"
    },
    "counters": {
      "/plain/seq-500-200": 2
    }
  },
  "llm_via_3692": {
    "429": {
      "client": {
        "status": 429,
        "body": "{\"error\": {\"message\": \"mock upstream 429\", \"type\": \"mock_error\", \"code\": 429}}"
      },
      "counters": {
        "/sc429": 1
      }
    },
    "500": {
      "client": {
        "status": 500,
        "body": "{\"error\": {\"message\": \"mock upstream 500\", \"type\": \"mock_error\", \"code\": 500}}"
      },
      "counters": {
        "/sc500": 1
      }
    },
    "502": {
      "client": {
        "status": 502,
        "body": "{\"error\": {\"message\": \"mock upstream 502\", \"type\": \"mock_error\", \"code\": 502}}"
      },
      "counters": {
        "/sc502": 1
      }
    },
    "503": {
      "client": {
        "status": 503,
        "body": "{\"error\": {\"message\": \"mock upstream 503\", \"type\": \"mock_error\", \"code\": 503}}"
      },
      "counters": {
        "/sc503": 1
      }
    },
    "504": {
      "client": {
        "status": 504,
        "body": "{\"error\": {\"message\": \"mock upstream 504\", \"type\": \"mock_error\", \"code\": 504}}"
      },
      "counters": {
        "/sc504": 1
      }
    }
  },
  "request_logs": {
    "rows": [
      {
        "id": "01a1efc9-a9a5-719a-9a96-15656cbe2c9e",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "429",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-429",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "2",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-ab43-74c8-a076-9f60c48994d7",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "500",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-500",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-ace8-7387-9c03-529c18113484",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "502",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-502",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-ae9e-75be-bfa1-4e5e4f0af6d6",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "503",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-503",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-b063-710a-82fc-b9384e38ecb6",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "504",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-504",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "4",
        "agentgateway_user": "lab-client"
      }
    ],
    "attribute_samples": [
      "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61111\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.",
      "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61114\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.",
      "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61117\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http."
    ]
  },
  "ag_log_tail": "2026-11-18T17:52:08.714706Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-18T17:52:08.766049Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-18T17:52:08.766837Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-18T17:52:08.768399Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.5661ms\n2026-11-18T17:52:08.770637Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-18T17:52:08.777476Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-18T17:52:08.779057Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-18T17:52:08.779444Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (64.9258ms), still awaiting 1 tasks\t\n2026-11-18T17:52:08.779988Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-18T17:52:08.780005Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (65.4863ms), marking server ready\t\n2026-11-18T17:52:08.780015Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-18T17:52:08.780102Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-18T17:52:08.780136Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-18T17:52:08.780143Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3694\"\n2026-11-18T17:52:09.934345Z\tinfo\trequest gateway=default/default listener=gw-lab route=default/retry-e14 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61091 http.method=POST http.host=127.0.0.1 http.path=/plain/429 http.version=HTTP/1.1 http.status=429 protocol=http retry.attempt=2 duration=220ms\n2026-11-18T17:52:10.567374Z\tinfo\trequest gateway=default/default listener=gw-lab route=default/retry-e14 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61095 http.method=POST http.host=127.0.0.1 http.path=/plain/500 http.version=HTTP/1.1 http.status=500 protocol=http retry.attempt=2 duration=215ms\n2026-11-18T17:52:11.217775Z\tinfo\trequest gateway=default/default listener=gw-lab route=default/retry-e14 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61098 http.method=POST http.host=127.0.0.1 http.path=/plain/502 http.version=HTTP/1.1 http.status=502 protocol=http retry.attempt=2 duration=218ms\n2026-11-18T17:52:11.872431Z\tinfo\trequest gateway=default/default listener=gw-lab route=default/retry-e14 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61101 http.method=POST http.host=127.0.0.1 http.path=/plain/503 http.version=HTTP/1.1 http.status=503 protocol=http retry.attempt=2 duration=220ms\n2026-11-18T17:52:12.306943Z\tinfo\trequest gateway=default/default listener=gw-lab route=default/retry-e14 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61104 http.method=POST http.host=127.0.0.1 http.path=/plain/504 http.version=HTTP/1.1 http.status=504 protocol=http duration=2ms\n2026-11-18T17:52:12.814674Z\tinfo\trequest gateway=default/default listener=gw-lab route=default/retry-e14 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61107 http.method=POST http.host=127.0.0.1 http.path=/plain/seq-500-200 http.version=HTTP/1.1 http.status=200 protocol=http retry.attempt=1 duration=103ms\n2026-11-18T17:52:13.221046Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61111 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-429 agw.ai.original_model=vm-e14-429 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-18T17:52:13.635627Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61114 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=500 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-500 agw.ai.original_model=vm-e14-500 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:52:14.056415Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61117 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=502 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-502 agw.ai.original_model=vm-e14-502 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:52:14.494899Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61121 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=503 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-503 agw.ai.original_model=vm-e14-503 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:52:14.947590Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61124 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=504 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-504 agw.ai.original_model=vm-e14-504 gen_ai.request.max_tokens=16 duration=4ms",
  "binary": {
    "binary": "C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  },
  "notes_post_run": [
    "Retry attaches via top-level gateways + routes[].policies.retry (FilterOrPolicy); schema has NO retry field on backend-level policies (LocalBackendPolicies) - route layer only.",
    "Plain route (port 3694): codes 429/500/502/503 with attempts=2 -> upstream hit 3 times per client request (1 original + 2 retries, ~100ms backoff); 504 (not in codes) -> 1 hit. /plain/seq-500-200 -> client 200 after 2 hits: in-request retry IS produced by route-layer retry, retrying the SAME backend.",
    "Same config's LLM listener (3692) is NOT affected by route retry: 1 upstream hit per request, code passed through immediately - the generated internal/llm:request route has no retry policy.",
    "request_logs has only the 5 chat rows; the 6 plain-proxy requests on 3694 are absent from request_logs."
  ]
}