{
  "validate_top_level_tracing": {
    "exit": 1,
    "stdout": "",
    "stderr": "Error: unknown field `tracing`, expected one of `config`, `binds`, `frontendPolicies`, `policies`, `workloads`, `services`, `backends`, `routeGroups`, `gateways`, `routes`, `tcpRoutes`, `llm`, `mcp`, `ui` at line 87 column 3"
  },
  "validate": {
    "exit": 0,
    "stdout": "Configuration is valid!",
    "stderr": ""
  },
  "capture": {
    "count": 1,
    "hits": [
      {
        "ts": 1795106019.804,
        "n": 1,
        "path": "/v1/traces",
        "content_type": "application/x-protobuf",
        "length": 1907,
        "file": "capture-001.bin"
      }
    ]
  },
  "request": [
    {
      "status": 200,
      "headers": {
        "Server": "BaseHTTP/0.6 Python/3.13.15",
        "Date": "Thu, 19 Nov 2026 16:33:35 GMT",
        "Content-Type": "application/json",
        "Connection": "close",
        "Content-Length": "256"
      },
      "body": "{\"model\":\"mock-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"mock reply\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\",\"created\":1700000000}",
      "duration_s": 0.218
    }
  ],
  "mock_hits": {
    "name": "e19-t1",
    "total": 3,
    "counts": {
      "/fail500": 2,
      "/ok": 1
    },
    "auth_shapes": {
      "Bearer sk-ss-lab-client-": 3
    }
  },
  "spans": {
    "exports": [
      {
        "file": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\.e19-tmp\\otlp-t1\\capture-001.bin",
        "span_count": 4,
        "spans": [
          {
            "name": "POST /v1/chat/completions/*",
            "kind": "server",
            "trace_id": "12379ecdbe383b2a",
            "span_id": "3614b578e3f4",
            "parent_span_id": "",
            "duration_ms": 216.35,
            "status": null,
            "attributes": {
              "gateway": "default/default",
              "listener": "gw-e19t1",
              "route": "default/ai-e19t1",
              "endpoint": "127.0.0.1:64100",
              "client.address": "127.0.0.1",
              "http.request.method": "POST",
              "server.address": "127.0.0.1",
              "url.path": "/v1/chat/completions",
              "network.protocol.version": "1.1",
              "http.response.status_code": 200,
              "protocol": "llm",
              "gen_ai.operation.name": "chat",
              "gen_ai.provider.name": "openai",
              "gen_ai.request.model": "mock-model",
              "gen_ai.response.model": "mock-ok",
              "gen_ai.usage.input_tokens": 5,
              "gen_ai.usage.output_tokens": 3,
              "gen_ai.request.max_tokens": 32,
              "retry.attempt": 2,
              "duration": "216ms",
              "url.scheme": "http",
              "server.port": 3692
            },
            "attribute_keys": [
              "client.address",
              "duration",
              "endpoint",
              "gateway",
              "gen_ai.operation.name",
              "gen_ai.provider.name",
              "gen_ai.request.max_tokens",
              "gen_ai.request.model",
              "gen_ai.response.model",
              "gen_ai.usage.input_tokens",
              "gen_ai.usage.output_tokens",
              "http.request.method",
              "http.response.status_code",
              "listener",
              "network.protocol.version",
              "protocol",
              "retry.attempt",
              "route",
              "server.address",
              "server.port",
              "span.id",
              "trace.id",
              "url.path",
              "url.scheme"
            ]
          },
          {
            "name": "POST",
            "kind": "client",
            "trace_id": "12379ecdbe383b2a",
            "span_id": "1443cc3f6813",
            "parent_span_id": "3614b578e3f4",
            "duration_ms": 1.21,
            "status": {
              "code": 2,
              "message": null
            },
            "attributes": {
              "agentgateway.outbound.kind": "Primary",
              "agentgateway.outbound.subtype": "Llm",
              "http.method": "POST",
              "http.host": "127.0.0.1",
              "http.path": "/fail500/chat/completions",
              "http.status": 500,
              "error.type": "500"
            },
            "attribute_keys": [
              "agentgateway.outbound.kind",
              "agentgateway.outbound.subtype",
              "error.type",
              "http.host",
              "http.method",
              "http.path",
              "http.status"
            ]
          },
          {
            "name": "POST",
            "kind": "client",
            "trace_id": "12379ecdbe383b2a",
            "span_id": "0c271b41cc5f",
            "parent_span_id": "3614b578e3f4",
            "duration_ms": 1.03,
            "status": {
              "code": 2,
              "message": null
            },
            "attributes": {
              "agentgateway.outbound.kind": "Primary",
              "agentgateway.outbound.subtype": "Llm",
              "http.method": "POST",
              "http.host": "127.0.0.1",
              "http.path": "/fail500/chat/completions",
              "http.status": 500,
              "error.type": "500"
            },
            "attribute_keys": [
              "agentgateway.outbound.kind",
              "agentgateway.outbound.subtype",
              "error.type",
              "http.host",
              "http.method",
              "http.path",
              "http.status"
            ]
          },
          {
            "name": "POST",
            "kind": "client",
            "trace_id": "12379ecdbe383b2a",
            "span_id": "6ad1cd338ac8",
            "parent_span_id": "3614b578e3f4",
            "duration_ms": 1.59,
            "status": null,
            "attributes": {
              "agentgateway.outbound.kind": "Primary",
              "agentgateway.outbound.subtype": "Llm",
              "http.method": "POST",
              "http.host": "127.0.0.1",
              "http.path": "/ok/chat/completions",
              "http.status": 200
            },
            "attribute_keys": [
              "agentgateway.outbound.kind",
              "agentgateway.outbound.subtype",
              "http.host",
              "http.method",
              "http.path",
              "http.status"
            ]
          }
        ],
        "upstream_attempts": [
          {
            "span_id": "1443cc3f6813",
            "start_unix_nano": 1795106014792179400,
            "duration_ms": 1.21,
            "attributes": {
              "http.path": "/fail500/chat/completions",
              "http.status": 500,
              "error.type": "500",
              "agentgateway.outbound.kind": "Primary",
              "agentgateway.outbound.subtype": "Llm"
            },
            "attempt_no_by_time": 1
          },
          {
            "span_id": "0c271b41cc5f",
            "start_unix_nano": 1795106014897815400,
            "duration_ms": 1.03,
            "attributes": {
              "http.path": "/fail500/chat/completions",
              "http.status": 500,
              "error.type": "500",
              "agentgateway.outbound.kind": "Primary",
              "agentgateway.outbound.subtype": "Llm"
            },
            "attempt_no_by_time": 2
          },
          {
            "span_id": "6ad1cd338ac8",
            "start_unix_nano": 1795106015005947500,
            "duration_ms": 1.59,
            "attributes": {
              "http.path": "/ok/chat/completions",
              "http.status": 200,
              "error.type": null,
              "agentgateway.outbound.kind": "Primary",
              "agentgateway.outbound.subtype": "Llm"
            },
            "attempt_no_by_time": 3
          }
        ],
        "tree": [
          {
            "span": {
              "trace_id": "12379ecdbe383b2adf77ac4b61fa6898",
              "span_id": "3614b578e3f41fbb",
              "parent_span_id": null,
              "name": "POST /v1/chat/completions/*",
              "kind": "server",
              "start_unix_nano": 1795106014791243900,
              "end_unix_nano": 1795106015007591400,
              "attributes": {
                "gateway": "default/default",
                "listener": "gw-e19t1",
                "route": "default/ai-e19t1",
                "endpoint": "127.0.0.1:64100",
                "client.address": "127.0.0.1",
                "http.request.method": "POST",
                "server.address": "127.0.0.1",
                "url.path": "/v1/chat/completions",
                "network.protocol.version": "1.1",
                "http.response.status_code": 200,
                "trace.id": "12379ecdbe383b2adf77ac4b61fa6898",
                "span.id": "3614b578e3f41fbb",
                "protocol": "llm",
                "gen_ai.operation.name": "chat",
                "gen_ai.provider.name": "openai",
                "gen_ai.request.model": "mock-model",
                "gen_ai.response.model": "mock-ok",
                "gen_ai.usage.input_tokens": 5,
                "gen_ai.usage.output_tokens": 3,
                "gen_ai.request.max_tokens": 32,
                "retry.attempt": 2,
                "duration": "216ms",
                "url.scheme": "http",
                "server.port": 3692
              },
              "status": null,
              "scope": {
                "name": "agentgateway",
                "version": null
              }
            },
            "children": [
              {
                "span": {
                  "trace_id": "12379ecdbe383b2adf77ac4b61fa6898",
                  "span_id": "1443cc3f68133e52",
                  "parent_span_id": "3614b578e3f41fbb",
                  "name": "POST",
                  "kind": "client",
                  "start_unix_nano": 1795106014792179400,
                  "end_unix_nano": 1795106014793389000,
                  "attributes": {
                    "agentgateway.outbound.kind": "Primary",
                    "agentgateway.outbound.subtype": "Llm",
                    "http.method": "POST",
                    "http.host": "127.0.0.1",
                    "http.path": "/fail500/chat/completions",
                    "http.status": 500,
                    "error.type": "500"
                  },
                  "status": {
                    "code": 2,
                    "message": null
                  },
                  "scope": {
                    "name": "agentgateway",
                    "version": null
                  }
                },
                "children": []
              },
              {
                "span": {
                  "trace_id": "12379ecdbe383b2adf77ac4b61fa6898",
                  "span_id": "0c271b41cc5f454c",
                  "parent_span_id": "3614b578e3f41fbb",
                  "name": "POST",
                  "kind": "client",
                  "start_unix_nano": 1795106014897815400,
                  "end_unix_nano": 1795106014898844900,
                  "attributes": {
                    "agentgateway.outbound.kind": "Primary",
                    "agentgateway.outbound.subtype": "Llm",
                    "http.method": "POST",
                    "http.host": "127.0.0.1",
                    "http.path": "/fail500/chat/completions",
                    "http.status": 500,
                    "error.type": "500"
                  },
                  "status": {
                    "code": 2,
                    "message": null
                  },
                  "scope": {
                    "name": "agentgateway",
                    "version": null
                  }
                },
                "children": []
              },
              {
                "span": {
                  "trace_id": "12379ecdbe383b2adf77ac4b61fa6898",
                  "span_id": "6ad1cd338ac8b7c3",
                  "parent_span_id": "3614b578e3f41fbb",
                  "name": "POST",
                  "kind": "client",
                  "start_unix_nano": 1795106015005947500,
                  "end_unix_nano": 1795106015007535400,
                  "attributes": {
                    "agentgateway.outbound.kind": "Primary",
                    "agentgateway.outbound.subtype": "Llm",
                    "http.method": "POST",
                    "http.host": "127.0.0.1",
                    "http.path": "/ok/chat/completions",
                    "http.status": 200
                  },
                  "status": null,
                  "scope": {
                    "name": "agentgateway",
                    "version": null
                  }
                },
                "children": []
              }
            ]
          }
        ]
      }
    ],
    "total_spans": 4
  },
  "db": {
    "row_count": 1,
    "rows": [
      {
        "id": "01a1f4a8",
        "started_at": "2026-11-19T16:33:34.791243+00:00",
        "completed_at": "2026-11-19T16:33:35.007591+00:00",
        "duration_ms": 216.0,
        "trace_id": "12379ecdbe38",
        "span_id": "3614b578e3f4",
        "http_status": 200,
        "error": null,
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "mock-model",
        "gen_ai_response_model": "mock-ok",
        "input_tokens": 5,
        "output_tokens": 3,
        "total_tokens": 8,
        "cost": null,
        "agentgateway_user": null,
        "agentgateway_group": null,
        "user_agent_name": "Python-urllib",
        "has_payload": 1,
        "cache_read_input_tokens": null,
        "cache_creation_input_tokens": null,
        "reasoning_tokens": null,
        "time_to_first_token_ms": null,
        "time_per_output_token_ms": null,
        "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"gw-e19t1\",\"route\":\"default/ai-e19t1\",\"endpoint\":\"127.0.0.1:64100\",\"src.addr\":\"127.0.0.1:64105\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"trace.id\":\"12379ecdbe383b2adf77ac4b61fa6898\",\"span.id\":\"3614b578e3f41fbb\",\"protocol\":\"llm\",\"gen_ai.operation.name\":\"chat\",\"gen_ai.provider."
      }
    ]
  },
  "t2_metrics": {
    "changed": {
      "agentgateway_tokio_num_alive_tasks": {
        "before": 3.0,
        "after": 4.0
      },
      "agentgateway_gen_ai_client_token_usage_sum{gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_gen_ai_client_token_usage_count{gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"64.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"256.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1024.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4096.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16384.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"65536.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"262144.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1048576.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4194304.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16777216.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"67108864.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"+Inf\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_sum{gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 5.0
      },
      "agentgateway_gen_ai_client_token_usage_count{gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"64.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"256.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1024.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4096.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16384.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"65536.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"262144.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1048576.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4194304.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16777216.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"67108864.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"+Inf\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_sum{gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 0.2163475
      },
      "agentgateway_gen_ai_server_request_duration_count{gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.32\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.64\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"1.28\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"2.56\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"5.12\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"10.24\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"20.48\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"40.96\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"81.92\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"+Inf\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_requests_total{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_cost_catalog_lookups_total{status=\"Missing\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_downstream_connections_total{bind=\"bind/3692\",gateway=\"unknown\",listener=\"unknown\",protocol=\"http\"}": {
        "before": 1.0,
        "after": 2.0
      },
      "agentgateway_response_bytes_total{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 256.0
      },
      "agentgateway_request_duration_seconds_sum{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 0.2163475
      },
      "agentgateway_request_duration_seconds_count{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_duration_seconds_bucket{le=\"0.25\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_duration_seconds_bucket{le=\"0.5\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_duration_seconds_bucket{le=\"1.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_duration_seconds_bucket{le=\"2.5\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_duration_seconds_bucket{le=\"5.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_duration_seconds_bucket{le=\"10.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_duration_seconds_bucket{le=\"30.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_duration_seconds_bucket{le=\"80.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_duration_seconds_bucket{le=\"+Inf\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_processing_seconds_sum{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 0.0009076
      },
      "agentgateway_request_processing_seconds_count{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_processing_seconds_bucket{le=\"0.001\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_processing_seconds_bucket{le=\"0.0025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_processing_seconds_bucket{le=\"0.005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_processing_seconds_bucket{le=\"0.01\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_processing_seconds_bucket{le=\"0.05\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_processing_seconds_bucket{le=\"0.25\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_request_processing_seconds_bucket{le=\"+Inf\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_response_processing_seconds_sum{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 0.0002054
      },
      "agentgateway_response_processing_seconds_count{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_response_processing_seconds_bucket{le=\"0.00025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_response_processing_seconds_bucket{le=\"0.0005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_response_processing_seconds_bucket{le=\"0.001\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_response_processing_seconds_bucket{le=\"0.0025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_response_processing_seconds_bucket{le=\"0.005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_response_processing_seconds_bucket{le=\"0.01\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_response_processing_seconds_bucket{le=\"0.05\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_response_processing_seconds_bucket{le=\"0.25\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_response_processing_seconds_bucket{le=\"+Inf\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_downstream_received_bytes_total{bind=\"bind/3692\",gateway=\"unknown\",listener=\"unknown\",protocol=\"http\"}": {
        "before": 0.0,
        "after": 327.0
      },
      "agentgateway_downstream_sent_bytes_total{bind=\"bind/3692\",gateway=\"unknown\",listener=\"unknown\",protocol=\"http\"}": {
        "before": 0.0,
        "after": 421.0
      },
      "agentgateway_upstream_connect_duration_seconds_sum{transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 0.0018683000000000003
      },
      "agentgateway_upstream_connect_duration_seconds_count{transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0005\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 2.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0015\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0043\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0126\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0368\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.108\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.316\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.924\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"2.71\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"8.0\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"+Inf\",transport=\"plaintext\"}": {
        "before": 0.0,
        "after": 4.0
      },
      "agentgateway_upstream_call_duration_seconds_sum{kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 0.0034916
      },
      "agentgateway_upstream_call_duration_seconds_count{kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.001\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 1.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.005\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.01\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.025\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.05\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.1\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.25\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.5\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"1.0\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"2.5\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"5.0\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"10.0\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"30.0\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"80.0\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"+Inf\",kind=\"Primary\",subtype=\"Llm\"}": {
        "before": 0.0,
        "after": 3.0
      },
      "agentgateway_retries_total{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}": {
        "before": 0.0,
        "after": 2.0
      }
    },
    "added": [
      "agentgateway_cost_catalog_lookups_total{status=\"Missing\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"+Inf\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"+Inf\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1024.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1024.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1048576.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1048576.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16384.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16384.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16777216.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16777216.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"256.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"256.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"262144.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"262144.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4096.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4096.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4194304.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4194304.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"64.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"64.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"65536.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"65536.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"67108864.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"67108864.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_count{gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_count{gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_sum{gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_client_token_usage_sum{gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"+Inf\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.01\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.02\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.04\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.08\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.16\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.32\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.64\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"1.28\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"10.24\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"2.56\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"20.48\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"40.96\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"5.12\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"81.92\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_count{gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_gen_ai_server_request_duration_sum{gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"+Inf\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"0.001\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"0.005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"0.01\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"0.025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"0.05\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"0.1\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"0.25\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"0.5\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"1.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"10.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"2.5\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"30.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"5.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_bucket{le=\"80.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_count{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_duration_seconds_sum{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"+Inf\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"0.00005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"0.0001\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"0.00025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"0.0005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"0.001\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"0.0025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"0.005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"0.01\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"0.05\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_bucket{le=\"0.25\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_count{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_request_processing_seconds_sum{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_requests_total{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_bytes_total{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"+Inf\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"0.00005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"0.0001\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"0.00025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"0.0005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"0.001\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"0.0025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"0.005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"0.01\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"0.05\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_bucket{le=\"0.25\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_count{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_response_processing_seconds_sum{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_retries_total{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"+Inf\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.001\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.005\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.01\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.025\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.05\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.1\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.25\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.5\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"1.0\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"10.0\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"2.5\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"30.0\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"5.0\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"80.0\",kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_count{kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_call_duration_seconds_sum{kind=\"Primary\",subtype=\"Llm\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"+Inf\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0005\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0015\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0043\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0126\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0368\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.108\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.316\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.924\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"2.71\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"8.0\",transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_count{transport=\"plaintext\"}",
      "agentgateway_upstream_connect_duration_seconds_sum{transport=\"plaintext\"}"
    ],
    "HELP_families": [
      "agentgateway_build",
      "agentgateway_config_synchronized",
      "agentgateway_cost_catalog_lookups",
      "agentgateway_downstream_connections",
      "agentgateway_downstream_connections_shed",
      "agentgateway_downstream_received_bytes",
      "agentgateway_downstream_sent_bytes",
      "agentgateway_gen_ai_client_token_usage",
      "agentgateway_gen_ai_server_request_duration",
      "agentgateway_request_duration_seconds",
      "agentgateway_request_processing_seconds",
      "agentgateway_requests",
      "agentgateway_requests_shed",
      "agentgateway_response_bytes",
      "agentgateway_response_processing_seconds",
      "agentgateway_retries",
      "agentgateway_substrate_request_parking_active",
      "agentgateway_tokio_global_queue_depth",
      "agentgateway_tokio_num_alive_tasks",
      "agentgateway_tokio_num_workers",
      "agentgateway_upstream_call_duration_seconds",
      "agentgateway_upstream_connect_duration_seconds"
    ],
    "interesting_after": [
      "# HELP agentgateway_gen_ai_client_token_usage Number of tokens used per request.",
      "# TYPE agentgateway_gen_ai_client_token_usage histogram",
      "agentgateway_gen_ai_client_token_usage_sum{gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 3.0",
      "agentgateway_gen_ai_client_token_usage_count{gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"64.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"256.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1024.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4096.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16384.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"65536.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"262144.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1048576.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4194304.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16777216.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"67108864.0\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"+Inf\",gen_ai_token_type=\"output\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_sum{gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 5.0",
      "agentgateway_gen_ai_client_token_usage_count{gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"64.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"256.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1024.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4096.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16384.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"65536.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"262144.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"1048576.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"4194304.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"16777216.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"67108864.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_client_token_usage_bucket{le=\"+Inf\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "# HELP agentgateway_gen_ai_server_request_duration Duration of a generative AI request in seconds; failed operations have error_type=\"_OTHER\" and successful operations omit the label.",
      "# TYPE agentgateway_gen_ai_server_request_duration histogram",
      "agentgateway_gen_ai_server_request_duration_sum{gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0.2163475",
      "agentgateway_gen_ai_server_request_duration_count{gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.01\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.02\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.04\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.08\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.16\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.32\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"0.64\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"1.28\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"2.56\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"5.12\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"10.24\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"20.48\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"40.96\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"81.92\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_gen_ai_server_request_duration_bucket{le=\"+Inf\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "# HELP agentgateway_substrate_request_parking_active Number of requests waiting for a Substrate actor to become routable.",
      "# TYPE agentgateway_substrate_request_parking_active gauge",
      "agentgateway_substrate_request_parking_active 0",
      "# HELP agentgateway_requests The total number of HTTP requests sent.",
      "# TYPE agentgateway_requests counter",
      "agentgateway_requests_total{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_cost_catalog_lookups_total{status=\"Missing\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"mock-model\",gen_ai_response_model=\"mock-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "# HELP agentgateway_requests_shed Total downstream requests rejected by the in-flight request limit.",
      "# TYPE agentgateway_requests_shed counter",
      "agentgateway_requests_shed_total{bind=\"bind/3692\"} 0",
      "agentgateway_response_bytes_total{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 256",
      "# HELP agentgateway_request_duration_seconds Duration of HTTP requests (seconds).",
      "# TYPE agentgateway_request_duration_seconds histogram",
      "# UNIT agentgateway_request_duration_seconds seconds",
      "agentgateway_request_duration_seconds_sum{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0.2163475",
      "agentgateway_request_duration_seconds_count{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_duration_seconds_bucket{le=\"0.001\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_request_duration_seconds_bucket{le=\"0.005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_request_duration_seconds_bucket{le=\"0.01\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_request_duration_seconds_bucket{le=\"0.025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_request_duration_seconds_bucket{le=\"0.05\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_request_duration_seconds_bucket{le=\"0.1\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_request_duration_seconds_bucket{le=\"0.25\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_duration_seconds_bucket{le=\"0.5\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_duration_seconds_bucket{le=\"1.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_duration_seconds_bucket{le=\"2.5\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_duration_seconds_bucket{le=\"5.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_duration_seconds_bucket{le=\"10.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_duration_seconds_bucket{le=\"30.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_duration_seconds_bucket{le=\"80.0\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_duration_seconds_bucket{le=\"+Inf\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "# HELP agentgateway_request_processing_seconds Duration from receiving an HTTP request to sending the primary outbound call (seconds).",
      "# TYPE agentgateway_request_processing_seconds histogram",
      "# UNIT agentgateway_request_processing_seconds seconds",
      "agentgateway_request_processing_seconds_sum{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0.0009076",
      "agentgateway_request_processing_seconds_count{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_processing_seconds_bucket{le=\"0.00005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_request_processing_seconds_bucket{le=\"0.0001\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_request_processing_seconds_bucket{le=\"0.00025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_request_processing_seconds_bucket{le=\"0.0005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 0",
      "agentgateway_request_processing_seconds_bucket{le=\"0.001\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_processing_seconds_bucket{le=\"0.0025\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_processing_seconds_bucket{le=\"0.005\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_processing_seconds_bucket{le=\"0.01\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_processing_seconds_bucket{le=\"0.05\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_processing_seconds_bucket{le=\"0.25\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "agentgateway_request_processing_seconds_bucket{le=\"+Inf\",backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 1",
      "# HELP agentgateway_upstream_connect_duration_seconds Duration to establish upstream connection (seconds).",
      "# TYPE agentgateway_upstream_connect_duration_seconds histogram",
      "# UNIT agentgateway_upstream_connect_duration_seconds seconds",
      "agentgateway_upstream_connect_duration_seconds_sum{transport=\"plaintext\"} 0.0018683000000000003",
      "agentgateway_upstream_connect_duration_seconds_count{transport=\"plaintext\"} 4",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0005\",transport=\"plaintext\"} 2",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0015\",transport=\"plaintext\"} 4",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0043\",transport=\"plaintext\"} 4",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0126\",transport=\"plaintext\"} 4",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.0368\",transport=\"plaintext\"} 4",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.108\",transport=\"plaintext\"} 4",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.316\",transport=\"plaintext\"} 4",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"0.924\",transport=\"plaintext\"} 4",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"2.71\",transport=\"plaintext\"} 4",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"8.0\",transport=\"plaintext\"} 4",
      "agentgateway_upstream_connect_duration_seconds_bucket{le=\"+Inf\",transport=\"plaintext\"} 4",
      "# HELP agentgateway_upstream_call_duration_seconds Duration of outbound calls made by agentgateway (seconds).",
      "# TYPE agentgateway_upstream_call_duration_seconds histogram",
      "# UNIT agentgateway_upstream_call_duration_seconds seconds",
      "agentgateway_upstream_call_duration_seconds_sum{kind=\"Primary\",subtype=\"Llm\"} 0.0034916",
      "agentgateway_upstream_call_duration_seconds_count{kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.001\",kind=\"Primary\",subtype=\"Llm\"} 1",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.005\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.01\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.025\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.05\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.1\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.25\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"0.5\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"1.0\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"2.5\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"5.0\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"10.0\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"30.0\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"80.0\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "agentgateway_upstream_call_duration_seconds_bucket{le=\"+Inf\",kind=\"Primary\",subtype=\"Llm\"} 3",
      "# HELP agentgateway_retries The total number of request retries.",
      "agentgateway_retries_total{backend=\"/gateway/gw-e19t1/default/ai-e19t1/backend0\",protocol=\"llm\",method=\"POST\",status=\"200\",reason=\"Upstream\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"gw-e19t1\",route=\"default/ai-e19t1\",route_rule=\"unknown\"} 2"
    ]
  },
  "config": {
    "evidence_file": "cfg-E19-T1-otel.yaml",
    "note": "backendAuth key {file: ...} -> gitignored .e17-tmp key file; real key never written"
  },
  "config_top_level_tracing_rejected": {
    "config": {
      "adminAddr": "127.0.0.1:3921",
      "statsAddr": "127.0.0.1:3922",
      "readinessAddr": "127.0.0.1:3923",
      "database": {
        "url": "sqlite://data.db"
      },
      "storage": {
        "mode": "file"
      },
      "session": {
        "key": "3a5dde678b895d76e244397deac58c4eac0199d751ee0c168e4ef022d62e9c2e"
      }
    },
    "gateways": {
      "gw-e19t1": {
        "port": 3692,
        "bindAddress": "127.0.0.1"
      }
    },
    "routes": [
      {
        "name": "ai-e19t1",
        "gateways": "gw-e19t1",
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
                      "name": "primary",
                      "hostOverride": "127.0.0.1:64100",
                      "provider": {
                        "openAI": {
                          "model": "mock-model"
                        }
                      },
                      "pathPrefix": "/fail500"
                    }
                  ]
                },
                {
                  "providers": [
                    {
                      "name": "backup",
                      "hostOverride": "127.0.0.1:64100",
                      "provider": {
                        "openAI": {
                          "model": "mock-model"
                        }
                      },
                      "pathPrefix": "/ok"
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
              500
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
      },
      "tracing": {
        "host": "127.0.0.1:4318",
        "protocol": "http",
        "randomSampling": "true"
      }
    },
    "tracing": {
      "otlpEndpoint": "http://127.0.0.1:4318",
      "otlpProtocol": "http",
      "randomSampling": "true"
    }
  },
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints true)",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
