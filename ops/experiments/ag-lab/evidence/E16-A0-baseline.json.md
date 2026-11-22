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
            }
          }
        ]
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
      "status": 500,
      "body": "{\"error\": {\"message\": \"mock upstream 500\", \"type\": \"mock_error\", \"code\": 500}}",
      "counters": {
        "/sc500": 1
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
        "/ok": 1
      }
    }
  ],
  "request_logs": {
    "row_count": 4,
    "rows": [
      {
        "id": "01a1f288",
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
        "duration_ms": "1",
        "agentgateway_user": "None"
      },
      {
        "id": "01a1f288",
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
        "id": "01a1f288",
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
        "id": "01a1f288",
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
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61590\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":500,\"prot",
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61594\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61597\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
      "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61601\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot"
    ]
  },
  "ag_log_tail": "2026-11-19T06:39:43.863245Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:39:43.908750Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:39:43.909119Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:39:43.911227Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=2.1097ms\n2026-11-19T06:39:43.913430Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:39:43.918976Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:39:43.919671Z\tinfo\tstate_manager\tWatching config file: <local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:39:43.920266Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (57.1774ms), still awaiting 1 tasks\t\n2026-11-19T06:39:43.920477Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:39:43.920491Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (57.4025ms), marking server ready\t\n2026-11-19T06:39:43.920500Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:39:43.920567Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:39:43.920607Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:39:44.909280Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61590 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=500 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-500 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:39:45.362792Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61594 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:39:45.820728Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61597 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:39:46.262820Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61601 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms",
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
