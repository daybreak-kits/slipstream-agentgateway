{
  "variants": [
    {
      "name": "A: legacy stdout + accessLog.add",
      "validate": {
        "exit": 0,
        "stdout": "Configuration is valid!",
        "stderr": ""
      },
      "cel_fields": {
        "agw.e19.upstream.calls": "upstreamCalls.map(c, c.target + \":\" + string(c.response.code)).join(\",\")",
        "agw.e19.upstream.count": "size(upstreamCalls)",
        "agw.e19.upstream.subtypes": "upstreamCalls.map(c, c.subtype).join(\",\")",
        "agw.e19.upstream.errors": "upstreamCalls.map(c, string(c.error)).join(\",\")"
      },
      "schema_before_request": [
        {
          "name": "id",
          "type": "TEXT"
        },
        {
          "name": "started_at",
          "type": "TEXT"
        },
        {
          "name": "completed_at",
          "type": "TEXT"
        },
        {
          "name": "duration_ms",
          "type": "INTEGER"
        },
        {
          "name": "trace_id",
          "type": "TEXT"
        },
        {
          "name": "span_id",
          "type": "TEXT"
        },
        {
          "name": "http_status",
          "type": "INTEGER"
        },
        {
          "name": "error",
          "type": "TEXT"
        },
        {
          "name": "gen_ai_operation_name",
          "type": "TEXT"
        },
        {
          "name": "gen_ai_provider_name",
          "type": "TEXT"
        },
        {
          "name": "gen_ai_request_model",
          "type": "TEXT"
        },
        {
          "name": "gen_ai_response_model",
          "type": "TEXT"
        },
        {
          "name": "input_tokens",
          "type": "INTEGER"
        },
        {
          "name": "output_tokens",
          "type": "INTEGER"
        },
        {
          "name": "total_tokens",
          "type": "INTEGER"
        },
        {
          "name": "cost",
          "type": "REAL"
        },
        {
          "name": "agentgateway_user",
          "type": "TEXT"
        },
        {
          "name": "agentgateway_group",
          "type": "TEXT"
        },
        {
          "name": "user_agent_name",
          "type": "TEXT"
        },
        {
          "name": "has_payload",
          "type": "INTEGER"
        },
        {
          "name": "attributes_json",
          "type": "TEXT"
        },
        {
          "name": "cache_read_input_tokens",
          "type": "INTEGER"
        },
        {
          "name": "cache_creation_input_tokens",
          "type": "INTEGER"
        },
        {
          "name": "reasoning_tokens",
          "type": "INTEGER"
        },
        {
          "name": "time_to_first_token_ms",
          "type": "REAL"
        },
        {
          "name": "time_per_output_token_ms",
          "type": "REAL"
        }
      ],
      "schema_after_request": [
        {
          "name": "id",
          "type": "TEXT"
        },
        {
          "name": "started_at",
          "type": "TEXT"
        },
        {
          "name": "completed_at",
          "type": "TEXT"
        },
        {
          "name": "duration_ms",
          "type": "INTEGER"
        },
        {
          "name": "trace_id",
          "type": "TEXT"
        },
        {
          "name": "span_id",
          "type": "TEXT"
        },
        {
          "name": "http_status",
          "type": "INTEGER"
        },
        {
          "name": "error",
          "type": "TEXT"
        },
        {
          "name": "gen_ai_operation_name",
          "type": "TEXT"
        },
        {
          "name": "gen_ai_provider_name",
          "type": "TEXT"
        },
        {
          "name": "gen_ai_request_model",
          "type": "TEXT"
        },
        {
          "name": "gen_ai_response_model",
          "type": "TEXT"
        },
        {
          "name": "input_tokens",
          "type": "INTEGER"
        },
        {
          "name": "output_tokens",
          "type": "INTEGER"
        },
        {
          "name": "total_tokens",
          "type": "INTEGER"
        },
        {
          "name": "cost",
          "type": "REAL"
        },
        {
          "name": "agentgateway_user",
          "type": "TEXT"
        },
        {
          "name": "agentgateway_group",
          "type": "TEXT"
        },
        {
          "name": "user_agent_name",
          "type": "TEXT"
        },
        {
          "name": "has_payload",
          "type": "INTEGER"
        },
        {
          "name": "attributes_json",
          "type": "TEXT"
        },
        {
          "name": "cache_read_input_tokens",
          "type": "INTEGER"
        },
        {
          "name": "cache_creation_input_tokens",
          "type": "INTEGER"
        },
        {
          "name": "reasoning_tokens",
          "type": "INTEGER"
        },
        {
          "name": "time_to_first_token_ms",
          "type": "REAL"
        },
        {
          "name": "time_per_output_token_ms",
          "type": "REAL"
        }
      ],
      "schema_changed": false,
      "db": {
        "row_count": 1,
        "rows": [
          {
            "id": "01a1f4a8",
            "started_at": "2026-11-19T16:33:41.562603+00:00",
            "completed_at": "2026-11-19T16:33:41.778856+00:00",
            "duration_ms": 216.0,
            "trace_id": "",
            "span_id": "",
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
            "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"gw-e19t3a\",\"route\":\"default/ai-e19t3a\",\"endpoint\":\"127.0.0.1:64114\",\"src.addr\":\"127.0.0.1:64117\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"protocol\":\"llm\",\"gen_ai.operation.name\":\"chat\",\"gen_ai.provider.name\":\"openai\",\"gen_ai.request.model\":\"mock-model\",\"gen_ai.response.model"
          }
        ]
      },
      "stdout_has_custom": false,
      "stdout_request_line": "2026-11-19T16:33:41.778962Z\tinfo\trequest gateway=default/default listener=gw-e19t3a route=default/ai-e19t3a endpoint=127.0.0.1:64114 src.addr=127.0.0.1:64117 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=mock-model gen_ai.response.model=mock-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 retry.attempt=2 duration=216ms",
      "db_attrs_has_custom": false,
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
          },
          "session": {
            "key": "3a5dde678b895d76e244397deac58c4eac0199d751ee0c168e4ef022d62e9c2e"
          }
        },
        "gateways": {
          "gw-e19t3a": {
            "port": 3692,
            "bindAddress": "127.0.0.1"
          }
        },
        "routes": [
          {
            "name": "ai-e19t3a",
            "gateways": "gw-e19t3a",
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
                          "hostOverride": "127.0.0.1:64114",
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
                          "hostOverride": "127.0.0.1:64114",
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
            },
            "add": {
              "agw.e19.upstream.calls": "upstreamCalls.map(c, c.target + \":\" + string(c.response.code)).join(\",\")",
              "agw.e19.upstream.count": "size(upstreamCalls)",
              "agw.e19.upstream.subtypes": "upstreamCalls.map(c, c.subtype).join(\",\")",
              "agw.e19.upstream.errors": "upstreamCalls.map(c, string(c.error)).join(\",\")"
            }
          }
        }
      }
    },
    {
      "name": "B: preset=otel + accessLog.add",
      "validate": {
        "exit": 0,
        "stdout": "Configuration is valid!",
        "stderr": ""
      },
      "stdout_has_custom": false,
      "stdout_sample": "2026-11-19T16:33:44.447778Z\tinfo\trequest gateway=default/default listener=gw-e19t3b route=default/ai-e19t3b endpoint=127.0.0.1:64114 client.address=127.0.0.1 http.request.method=POST server.address=127.0.0.1 url.path=/v1/chat/completions network.protocol.version=1.1 http.response.status_code=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=mock-model gen_ai.response.model=mock-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 retry.attempt=2 duration=218ms url.scheme=http server.port=3692"
    },
    {
      "name": "C: accessLog.add + otlp http export",
      "validate": {
        "exit": 0,
        "stdout": "Configuration is valid!",
        "stderr": ""
      },
      "capture": {
        "count": 1,
        "hits": [
          {
            "ts": 1795106027.903,
            "n": 1,
            "path": "/v1/logs",
            "content_type": "application/x-protobuf",
            "length": 927,
            "file": "capture-001.bin"
          }
        ]
      },
      "log_records": 1,
      "records_with_custom": 0,
      "record_samples": [
        {
          "body": null,
          "attributes": {},
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
            "url.path",
            "url.scheme"
          ]
        }
      ]
    },
    {
      "name": "D: trivial CEL (static + size(upstreamCalls)) on stdout",
      "validate": {
        "exit": 0,
        "stdout": "Configuration is valid!",
        "stderr": ""
      },
      "stdout_has_custom": true,
      "stdout_request_line": "2026-11-19T16:33:50.208834Z\tinfo\trequest gateway=default/default listener=gw-e19t3d route=default/ai-e19t3d endpoint=127.0.0.1:64114 src.addr=127.0.0.1:64142 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=mock-model gen_ai.response.model=mock-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 retry.attempt=2 duration=220ms agw.e19.static=\"abc\""
    },
    {
      "name": "E: otlp.fields.add explicit",
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
          },
          "session": {
            "key": "3a5dde678b895d76e244397deac58c4eac0199d751ee0c168e4ef022d62e9c2e"
          }
        },
        "gateways": {
          "gw-e19t3e": {
            "port": 3692,
            "bindAddress": "127.0.0.1"
          }
        },
        "routes": [
          {
            "name": "ai-e19t3e",
            "gateways": "gw-e19t3e",
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
                          "hostOverride": "127.0.0.1:64114",
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
                          "hostOverride": "127.0.0.1:64114",
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
            "otlp": {
              "host": "127.0.0.1:4319",
              "protocol": "http",
              "fields": {
                "add": {
                  "agw.e19.static": "'abc'",
                  "agw.e19.calls": "upstreamCalls.map(c, c.target + \":\" + string(c.response.code)).join(\",\")"
                }
              }
            },
            "database": {
              "llm": "full"
            }
          }
        }
      },
      "capture": {
        "count": 2,
        "hits": [
          {
            "ts": 1795106027.903,
            "n": 1,
            "path": "/v1/logs",
            "content_type": "application/x-protobuf",
            "length": 927,
            "file": "capture-001.bin"
          },
          {
            "ts": 1795106033.663,
            "n": 2,
            "path": "/v1/logs",
            "content_type": "application/x-protobuf",
            "length": 952,
            "file": "capture-002.bin"
          }
        ]
      },
      "log_records": 2,
      "records_with_custom": 1,
      "record_keys": [
        [
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
          "url.path",
          "url.scheme"
        ],
        [
          "agw.e19.static",
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
          "url.path",
          "url.scheme"
        ]
      ]
    },
    {
      "name": "F: upstreamCalls parts isolated (stdout)",
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
          },
          "session": {
            "key": "3a5dde678b895d76e244397deac58c4eac0199d751ee0c168e4ef022d62e9c2e"
          }
        },
        "gateways": {
          "gw-e19t3f": {
            "port": 3692,
            "bindAddress": "127.0.0.1"
          }
        },
        "routes": [
          {
            "name": "ai-e19t3f",
            "gateways": "gw-e19t3f",
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
                          "hostOverride": "127.0.0.1:64114",
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
                          "hostOverride": "127.0.0.1:64114",
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
            },
            "add": {
              "agw.e19.static": "'abc'",
              "agw.e19.count": "string(size(upstreamCalls))",
              "agw.e19.targets": "upstreamCalls.map(c, c.target).join(\",\")",
              "agw.e19.codes": "upstreamCalls.map(c, string(c.response.code)).join(\",\")"
            }
          }
        }
      },
      "stdout_line_full": "2026-11-19T16:33:55.541106Z\tinfo\trequest gateway=default/default listener=gw-e19t3f route=default/ai-e19t3f endpoint=127.0.0.1:64114 src.addr=127.0.0.1:64173 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=mock-model gen_ai.response.model=mock-ok gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=32 retry.attempt=2 duration=219ms agw.e19.static=\"abc\"",
      "fields_present": {
        "agw.e19.static": true,
        "agw.e19.count": false,
        "agw.e19.targets": false,
        "agw.e19.codes": false
      }
    }
  ],
  "binary": {
    "binary": "C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints true)",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
