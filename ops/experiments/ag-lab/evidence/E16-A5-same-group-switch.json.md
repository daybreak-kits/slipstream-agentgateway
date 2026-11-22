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
                      "pathPrefix": "/sc500",
                      "provider": {
                        "openAI": {
                          "model": "code-500"
                        }
                      }
                    },
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
            }
          }
        ],
        "policies": {
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
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
      "counters": {
        "/sc500": 1,
        "/ok": 1
      }
    },
    {
      "n": 2,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
      "counters": {
        "/ok": 1
      }
    },
    {
      "n": 3,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
      "counters": {
        "/ok": 1
      }
    },
    {
      "n": 4,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
      "counters": {
        "/sc500": 1,
        "/ok": 1
      }
    },
    {
      "n": 5,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
      "counters": {
        "/ok": 1
      }
    },
    {
      "n": 6,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
      "counters": {
        "/ok": 1
      }
    }
  ],
  "request_logs": {
    "row_count": 6,
    "rows": [
      {
        "id": "01a1f289",
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
        "duration_ms": "108",
        "agentgateway_user": "None"
      },
      {
        "id": "01a1f289",
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
        "duration_ms": "1",
        "agentgateway_user": "None"
      },
      {
        "id": "01a1f289",
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
        "duration_ms": "0",
        "agentgateway_user": "None"
      },
      {
        "id": "01a1f289",
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
        "duration_ms": "109",
        "agentgateway_user": "None"
      },
      {
        "id": "01a1f289",
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
        "duration_ms": "2",
        "agentgateway_user": "None"
      },
      {
        "id": "01a1f289",
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
        "duration_ms": "1",
        "agentgateway_user": "None"
      }
    ],
    "attribute_samples": [
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50104\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50108\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50111\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50114\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot"
    ]
  },
  "ag_log_tail": "2026-11-19T06:40:38.110986Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:40:38.154872Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:40:38.155263Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:40:38.157060Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.8012ms\n2026-11-19T06:40:38.159705Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:40:38.165148Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:40:38.165849Z\tinfo\tstate_manager\tWatching config file: <local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:40:38.166206Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (55.3839ms), still awaiting 1 tasks\t\n2026-11-19T06:40:38.166448Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:40:38.166469Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (55.646ms), marking server ready\t\n2026-11-19T06:40:38.166484Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:40:38.166537Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:40:38.166631Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:40:39.253697Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50104 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 retry.attempt=1 duration=108ms\n2026-11-19T06:40:39.709856Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50108 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:40:40.147202Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50111 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-19T06:40:40.690325Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50114 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 retry.attempt=1 duration=109ms\n2026-11-19T06:40:41.150328Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50117 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-19T06:40:41.588051Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50121 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms",
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
