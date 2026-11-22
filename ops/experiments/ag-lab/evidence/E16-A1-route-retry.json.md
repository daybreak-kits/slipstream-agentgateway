{
  "retry_policy": {
    "attempts": 2,
    "codes": [
      429,
      500,
      502,
      503
    ],
    "backoff": "100ms"
  },
  "sc500": {
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
          "/sc500": 2,
          "/ok": 1
        }
      },
      {
        "n": 2,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc500": 1,
          "/ok": 1
        }
      },
      {
        "n": 3,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc500": 1,
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
      }
    ],
    "request_logs": {
      "row_count": 4,
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
          "duration_ms": "242",
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
          "duration_ms": "111",
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
          "duration_ms": "110",
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
          "duration_ms": "112",
          "agentgateway_user": "None"
        }
      ],
      "attribute_samples": [
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61606\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61610\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61613\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61617\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"prot"
      ]
    },
    "ag_log_tail": "2026-11-19T06:39:48.259535Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:39:48.307940Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:39:48.308313Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:39:48.309975Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.6636ms\n2026-11-19T06:39:48.312483Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:39:48.317972Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:39:48.318798Z\tinfo\tstate_manager\tWatching config file: <local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:39:48.319191Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (59.8301ms), still awaiting 1 tasks\t\n2026-11-19T06:39:48.319337Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:39:48.319347Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (59.986ms), marking server ready\t\n2026-11-19T06:39:48.319354Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:39:48.319416Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:39:48.319457Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:39:49.551657Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61606 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 retry.attempt=2 duration=242ms\n2026-11-19T06:39:50.098677Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61610 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 retry.attempt=1 duration=111ms\n2026-11-19T06:39:50.664440Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61613 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 retry.attempt=1 duration=110ms\n2026-11-19T06:39:51.220718Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61617 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 retry.attempt=1 duration=112ms"
  },
  "sc401_control": {
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
          "duration_ms": "2",
          "agentgateway_user": "None"
        }
      ],
      "attribute_samples": [
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61622\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61626\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61630\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot"
      ]
    },
    "ag_log_tail": "2026-11-19T06:39:53.215752Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:39:53.259155Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:39:53.259457Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:39:53.261175Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.7212ms\n2026-11-19T06:39:53.263208Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:39:53.268389Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:39:53.269626Z\tinfo\tstate_manager\tWatching config file: <local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:39:53.270009Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (54.4216ms), still awaiting 1 tasks\t\n2026-11-19T06:39:53.270241Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:39:53.270254Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (54.6659ms), marking server ready\t\n2026-11-19T06:39:53.270262Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:39:53.270318Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:39:53.270349Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:39:54.266679Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61622 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-19T06:39:54.712106Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61626 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-19T06:39:55.151839Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61630 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 duration=2ms"
  },
  "sc401_in_codes": {
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
                        "pathPrefix": "/sc401c",
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
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401c": 3
        }
      },
      {
        "n": 2,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401c": 3
        }
      },
      {
        "n": 3,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401c": 3
        }
      },
      {
        "n": 4,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401c": 3
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
          "duration_ms": "235",
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
          "duration_ms": "223",
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
          "duration_ms": "219",
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
          "duration_ms": "222",
          "agentgateway_user": "None"
        }
      ],
      "attribute_samples": [
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61639\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61643\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61646\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:61649\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":401,\"prot"
      ]
    },
    "ag_log_tail": "2026-11-19T06:39:57.154144Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:39:57.203160Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:39:57.203437Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:39:57.204974Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.5401ms\n2026-11-19T06:39:57.207106Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:39:57.212280Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:39:57.213124Z\tinfo\tstate_manager\tWatching config file: <local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:39:57.213617Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (59.6677ms), still awaiting 1 tasks\t\n2026-11-19T06:39:57.213992Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:39:57.214018Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (60.0678ms), marking server ready\t\n2026-11-19T06:39:57.214036Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:39:57.214090Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:39:57.214202Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:39:58.410393Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61639 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 retry.attempt=2 duration=235ms\n2026-11-19T06:39:59.089579Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61643 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 retry.attempt=2 duration=223ms\n2026-11-19T06:39:59.751465Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61646 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 retry.attempt=2 duration=219ms\n2026-11-19T06:40:00.415111Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61649 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 gen_ai.request.max_tokens=16 retry.attempt=2 duration=222ms"
  },
  "sc429_in_codes": {
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
                        "pathPrefix": "/sc429",
                        "provider": {
                          "openAI": {
                            "model": "code-429"
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
        "status": 429,
        "body": "{\"error\": {\"message\": \"mock upstream 429\", \"type\": \"mock_error\", \"code\": 429}}",
        "counters": {
          "/sc429": 3
        }
      },
      {
        "n": 2,
        "status": 429,
        "body": "{\"error\": {\"message\": \"mock upstream 429\", \"type\": \"mock_error\", \"code\": 429}}",
        "counters": {
          "/sc429": 3
        }
      },
      {
        "n": 3,
        "status": 429,
        "body": "{\"error\": {\"message\": \"mock upstream 429\", \"type\": \"mock_error\", \"code\": 429}}",
        "counters": {
          "/sc429": 3
        }
      },
      {
        "n": 4,
        "status": 429,
        "body": "{\"error\": {\"message\": \"mock upstream 429\", \"type\": \"mock_error\", \"code\": 429}}",
        "counters": {
          "/sc429": 3
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
          "http_status": "429",
          "error": "None",
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "code-429",
          "gen_ai_response_model": "None",
          "input_tokens": "None",
          "output_tokens": "None",
          "duration_ms": "236",
          "agentgateway_user": "None"
        },
        {
          "id": "01a1f288",
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
          "duration_ms": "223",
          "agentgateway_user": "None"
        },
        {
          "id": "01a1f288",
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
          "duration_ms": "220",
          "agentgateway_user": "None"
        },
        {
          "id": "01a1f288",
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
          "duration_ms": "223",
          "agentgateway_user": "None"
        }
      ],
      "attribute_samples": [
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49913\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":429,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49918\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":429,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49921\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":429,\"prot",
        "{\"gateway\":\"default/default\",\"listener\":\"gw-e16\",\"route\":\"default/ai-e16\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:49924\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":429,\"prot"
      ]
    },
    "ag_log_tail": "2026-11-19T06:40:02.413262Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-19T06:40:02.456858Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-19T06:40:02.457132Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-19T06:40:02.458768Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.6384ms\n2026-11-19T06:40:02.460565Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-19T06:40:02.465719Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-19T06:40:02.466563Z\tinfo\tstate_manager\tWatching config file: <local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-19T06:40:02.467229Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (54.1574ms), still awaiting 1 tasks\t\n2026-11-19T06:40:02.467446Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-19T06:40:02.467462Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (54.3902ms), marking server ready\t\n2026-11-19T06:40:02.467471Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-19T06:40:02.467537Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-19T06:40:02.467552Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-19T06:40:03.705548Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49913 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-429 gen_ai.request.max_tokens=16 retry.attempt=2 duration=236ms\n2026-11-19T06:40:04.386992Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49918 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-429 gen_ai.request.max_tokens=16 retry.attempt=2 duration=223ms\n2026-11-19T06:40:05.063494Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49921 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-429 gen_ai.request.max_tokens=16 retry.attempt=2 duration=220ms\n2026-11-19T06:40:05.730744Z\tinfo\trequest gateway=default/default listener=gw-e16 route=default/ai-e16 endpoint=127.0.0.1:8099 src.addr=127.0.0.1:49924 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-429 gen_ai.request.max_tokens=16 retry.attempt=2 duration=223ms"
  },
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
