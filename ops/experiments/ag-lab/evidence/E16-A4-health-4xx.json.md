{
  "no_health_control": {
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
                        "pathPrefix": "/sc401",
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
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401": 1
        }
      },
      {
        "n": 2,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401": 1
        }
      },
      {
        "n": 3,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401": 1
        }
      }
    ],
    "request_logs": {
      "row_count": 3,
      "rows": [
        {
          "id": "01a1f288",
          "trace_id": "None",
          "span_id": "None",
          "http_status": "401",
          "error": "None",
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "code-401",
          "gen_ai_response_model": "None",
          "input_tokens": "None",
          "output_tokens": "None",
          "duration_ms": "2",
          "agentgateway_user": "None"
        },
        {
          "id": "01a1f288",
          "trace_id": "None",
          "span_id": "None",
          "http_status": "401",
          "error": "None",
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "code-401",
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
          "http_status": "401",
          "error": "None",
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "code-401",
          "gen_ai_response_model": "None",
          "input_tokens": "None",
          "output_tokens": "None",
          "duration_ms": "0",
          "agentgateway_user": "None"
        }
      ],
      "attribute_samples": [
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49952\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49956\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49959\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot"
      ]
    },
    "ag_log_tail": "2026-11-19T06:40:13.087079Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:40:13.131100Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:40:13.131482Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:40:13.133076Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.5984ms\n2026-11-19T06:40:13.135159Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:40:13.140164Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:40:13.140917Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:40:13.141285Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (54.3816ms), still awaiting 1 tasks\t\n2026-11-19T06:40:13.141434Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:40:13.141446Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (54.5418ms), marking server ready\t\n2026-11-19T06:40:13.141453Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:40:13.141529Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:40:13.141558Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:40:14.141497Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49952 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-19T06:40:14.600785Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49956 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:40:15.019047Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49959 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=0ms"
  },
  "with_health_4xx": {
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
                        "pathPrefix": "/sc401",
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
                  "unhealthyExpression": "response.code >= 400"
                }
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
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401": 1
        }
      },
      {
        "n": 2,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401": 1
        }
      },
      {
        "n": 3,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401": 1
        }
      },
      {
        "n": 4,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401": 1
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
          "http_status": "401",
          "error": "None",
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "code-401",
          "gen_ai_response_model": "None",
          "input_tokens": "None",
          "output_tokens": "None",
          "duration_ms": "2",
          "agentgateway_user": "None"
        },
        {
          "id": "01a1f288",
          "trace_id": "None",
          "span_id": "None",
          "http_status": "401",
          "error": "None",
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "code-401",
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
          "http_status": "401",
          "error": "None",
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "code-401",
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
          "http_status": "401",
          "error": "None",
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "code-401",
          "gen_ai_response_model": "None",
          "input_tokens": "None",
          "output_tokens": "None",
          "duration_ms": "1",
          "agentgateway_user": "None"
        }
      ],
      "attribute_samples": [
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49965\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49969\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49972\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49975\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot"
      ]
    },
    "ag_log_tail": "2026-11-19T06:40:17.012551Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:40:17.054987Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:40:17.055233Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:40:17.056865Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.634ms\n2026-11-19T06:40:17.058848Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:40:17.064505Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:40:17.065487Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:40:17.065927Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (53.5407ms), still awaiting 1 tasks\t\n2026-11-19T06:40:17.066153Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:40:17.066164Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (53.7774ms), marking server ready\t\n2026-11-19T06:40:17.066172Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:40:17.066241Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:40:17.066250Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:40:18.051795Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49965 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-19T06:40:18.508794Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49969 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:40:18.966973Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49972 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:40:19.423389Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49975 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=1ms"
  },
  "expr_true_200": {
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
                        "pathPrefix": "/ok2",
                        "provider": {
                          "openAI": {
                            "model": "model-ok"
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
                  "unhealthyExpression": "true"
                }
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
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/ok2": 1
        }
      },
      {
        "n": 2,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/ok2": 1
        }
      },
      {
        "n": 3,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/ok2": 1
        }
      }
    ],
    "request_logs": {
      "row_count": 3,
      "rows": [
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
          "duration_ms": "16",
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
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49981\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49985\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49988\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot"
      ]
    },
    "ag_log_tail": "2026-11-19T06:40:21.414647Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:40:21.458386Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:40:21.458816Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:40:21.460515Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.7076ms\n2026-11-19T06:40:21.462919Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:40:21.467976Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:40:21.468802Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:40:21.469159Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (54.6795ms), still awaiting 1 tasks\t\n2026-11-19T06:40:21.469350Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:40:21.469361Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (54.8815ms), marking server ready\t\n2026-11-19T06:40:21.469369Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:40:21.469451Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:40:21.469453Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:40:22.481114Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49981 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=16ms\n2026-11-19T06:40:22.935130Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49985 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:40:23.391878Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49988 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms"
  },
  "expr_true_200_evict1": {
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
                        "pathPrefix": "/ok3",
                        "provider": {
                          "openAI": {
                            "model": "model-ok"
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
                  "unhealthyExpression": "true",
                  "eviction": {
                    "consecutiveFailures": 1
                  }
                }
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
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/ok3": 1
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
          "/ok3": 1
        }
      }
    ],
    "request_logs": {
      "row_count": 3,
      "rows": [
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
          "duration_ms": "2",
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
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49997\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50061\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50065\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot"
      ]
    },
    "ag_log_tail": "2026-11-19T06:40:25.367957Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:40:25.412259Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:40:25.412485Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:40:25.414800Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=2.3176ms\n2026-11-19T06:40:25.417043Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:40:25.422568Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:40:25.423579Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:40:25.423926Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (56.2458ms), still awaiting 1 tasks\t\n2026-11-19T06:40:25.424066Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:40:25.424077Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (56.3961ms), marking server ready\t\n2026-11-19T06:40:25.424084Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:40:25.424147Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:40:25.424189Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:40:26.427157Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49997 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-19T06:40:26.882986Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50061 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:40:27.342175Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50065 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms"
  },
  "expr_ge400_5xx": {
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
                        "pathPrefix": "/sc500b",
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
              },
              "policies": {
                "health": {
                  "unhealthyExpression": "response.code >= 400"
                }
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
          "/sc500b": 1
        }
      },
      {
        "n": 2,
        "status": 500,
        "body": "{\"error\": {\"message\": \"mock upstream 500\", \"type\": \"mock_error\", \"code\": 500}}",
        "counters": {
          "/sc500b": 1
        }
      },
      {
        "n": 3,
        "status": 500,
        "body": "{\"error\": {\"message\": \"mock upstream 500\", \"type\": \"mock_error\", \"code\": 500}}",
        "counters": {
          "/sc500b": 1
        }
      },
      {
        "n": 4,
        "status": 500,
        "body": "{\"error\": {\"message\": \"mock upstream 500\", \"type\": \"mock_error\", \"code\": 500}}",
        "counters": {
          "/sc500b": 1
        }
      }
    ],
    "request_logs": {
      "row_count": 4,
      "rows": [
        {
          "id": "01a1f289",
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
          "duration_ms": "2",
          "agentgateway_user": "None"
        },
        {
          "id": "01a1f289",
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
          "id": "01a1f289",
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
          "id": "01a1f289",
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
        }
      ],
      "attribute_samples": [
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50072\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":500,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50076\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":500,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50080\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":500,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50083\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":500,\"prot"
      ]
    },
    "ag_log_tail": "2026-11-19T06:40:29.334184Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:40:29.379704Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:40:29.380054Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:40:29.381893Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.8422ms\n2026-11-19T06:40:29.383996Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:40:29.389851Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:40:29.391005Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:40:29.391378Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (57.36ms), still awaiting 1 tasks\t\n2026-11-19T06:40:29.391582Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:40:29.391593Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (57.5756ms), marking server ready\t\n2026-11-19T06:40:29.391601Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:40:29.391687Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:40:29.391719Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:40:30.384173Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50072 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=500 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-500 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-19T06:40:30.839877Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50076 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=500 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-500 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:40:31.295553Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50080 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=500 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-500 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:40:31.753034Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50083 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=500 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-500 gen_ai.request.max_tokens=16 duration=1ms"
  },
  "expr_ge400_401_evict1": {
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
                        "pathPrefix": "/sc401b",
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
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401b": 1
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
          "id": "01a1f289",
          "trace_id": "None",
          "span_id": "None",
          "http_status": "401",
          "error": "None",
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "code-401",
          "gen_ai_response_model": "None",
          "input_tokens": "None",
          "output_tokens": "None",
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
          "duration_ms": "1",
          "agentgateway_user": "None"
        }
      ],
      "attribute_samples": [
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50088\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50092\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50095\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:50098\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot"
      ]
    },
    "ag_log_tail": "2026-11-19T06:40:33.733660Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:40:33.777063Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:40:33.777305Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:40:33.778919Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.6179ms\n2026-11-19T06:40:33.780755Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:40:33.785355Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:40:33.785987Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:40:33.786355Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (52.8712ms), still awaiting 1 tasks\t\n2026-11-19T06:40:33.786584Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:40:33.786602Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (53.1179ms), marking server ready\t\n2026-11-19T06:40:33.786615Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:40:33.786706Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:40:33.786734Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:40:34.776374Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50088 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-19T06:40:35.214354Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50092 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:40:35.671850Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50095 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:40:36.127486Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:50098 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms"
  },
  "binary": {
    "binary": "C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
