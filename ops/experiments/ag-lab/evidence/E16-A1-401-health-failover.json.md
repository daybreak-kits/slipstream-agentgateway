{
  "validate": {
    "exit": 0,
    "stdout": "Configuration is valid!",
    "stderr": ""
  },
  "config": {
    "config": {
      "adminAddr": "127.0.0.1:3921",
      "statsAddr": "127.0.0.1:3922",
      "readinessAddr": "127.0.0.1:3923",
      "database": {
        "url": "sqlite://data.db"
      },
      "storage": {
        "mode": "file"
      }
    },
    "gateways": {
      "gw-e16": {
        "port": 3692,
        "bindAddress": "127.0.0.1"
      }
    },
    "routes": [
      {
        "name": "ai-e16",
        "gateways": "gw-e16",
        "matches": [
          {
            "path": {
              "pathPrefix": "/v1/chat/completions"
            }
          }
        ],
        "backends": [
          {
            "ai": {
              "groups": [
                {
                  "providers": [
                    {
                      "name": "p-fail",
                      "hostOverride": "127.0.0.1:8099",
                      "pathPrefix": "/sc401d",
                      "provider": {
                        "openAI": {
                          "model": "code-401"
                        }
                      }
                    }
                  ]
                },
                {
                  "providers": [
                    {
                      "name": "p-ok",
                      "hostOverride": "127.0.0.1:8099",
                      "pathPrefix": "/ok",
                      "provider": {
                        "openAI": {
                          "model": "model-ok"
                        }
                      }
                    }
                  ]
                }
              ]
            },
            "policies": {
              "health": {
                "unhealthyExpression": "response.code >= 400",
                "eviction": {
                  "consecutiveFailures": 1
                }
              }
            }
          }
        ],
        "policies": {
          "retry": {
            "attempts": 2,
            "codes": [
              401,
              429,
              500,
              502,
              503
            ],
            "backoff": "100ms"
          }
        }
      }
    ],
    "frontendPolicies": {
      "accessLog": {
        "database": {
          "llm": "full"
        }
      }
    }
  },
  "trials": [
    {
      "n": 1,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini",
      "counters": {
        "/sc401d": 2,
        "/ok": 1
      }
    },
    {
      "n": 2,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini",
      "counters": {
        "/sc401d": 1,
        "/ok": 1
      }
    },
    {
      "n": 3,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini",
      "counters": {
        "/sc401d": 1,
        "/ok": 1
      }
    },
    {
      "n": 4,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini",
      "counters": {
        "/sc401d": 1,
        "/ok": 1
      }
    }
  ],
  "request_logs": {
    "row_count": 4,
    "rows": [
      {
        "id": "01a1f28b",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "222",
        "agentgateway_user": "None"
      },
      {
        "id": "01a1f28b",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "110",
        "agentgateway_user": "None"
      },
      {
        "id": "01a1f28b",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "111",
        "agentgateway_user": "None"
      },
      {
        "id": "01a1f28b",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "112",
        "agentgateway_user": "None"
      }
    ],
    "attribute_samples": [
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:59342\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:59346\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:59349\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:59352\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot"
    ]
  },
  "ag_log_tail": "2026-11-19T06:43:07.918477Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:43:07.962322Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:43:07.962609Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:43:07.964145Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.5381ms\n2026-11-19T06:43:07.966294Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:43:07.972063Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:43:07.973156Z\tinfo\tstate_manager\tWatching config file: <local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:43:07.973534Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (55.2321ms), still awaiting 1 tasks\t\n2026-11-19T06:43:07.973845Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:43:07.973866Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (55.5638ms), marking server ready\t\n2026-11-19T06:43:07.973881Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:43:07.973938Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:43:07.974036Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:43:09.209125Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:59342 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 retry.attempt=2 duration=222ms\n2026-11-19T06:43:09.747485Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:59346 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 retry.attempt=1 duration=110ms\n2026-11-19T06:43:10.304243Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:59349 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 retry.attempt=1 duration=111ms\n2026-11-19T06:43:10.869100Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:59352 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 retry.attempt=1 duration=112ms",
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c"
  }
}
