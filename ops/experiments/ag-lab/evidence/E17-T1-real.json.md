{
  "section": "T1-A2/A3 real NVIDIA upstream auth 200",
  "bare": {
    "client": {
      "status": 200,
      "body": "{\"model\":\"nvidia/nemotron-3.5-lightning-30b-a3b\",\"usage\":{\"prompt_tokens\":17,\"completion_tokens\":32,\"total_tokens\":49,\"completion_tokens_details\":{\"reasoning_tokens\":32},\"prompt_tokens_details\":{\"cached_tokens\":0}},\"choices\":[{\"message\":{\"role\":\"assistant\",\"refusal\":null,\"reasoning_content\":\"Here's a thinking process:\\n\\n1.  **Analyze User Input:** User said \\\"hi\\\"\\n2.  **Identify Intent:** Greeting\\n3\"},\"index\":0,\"finish_reason\":\"length\",\"logprobs\":null}],\"id\":\"chatcmpl-36234a0e-1086-4d2c-8559-b5fd0f59e914\",\"created\":1795077836,\"object\":\"chat.completion\"}",
      "duration_s": 0.832,
      "error": null
    },
    "request_logs": {
      "row_count": 1,
      "rows": [
        {
          "id": "01a1f2fa",
          "started_at": "2026-11-19T08:43:55.995742+00:00",
          "completed_at": "2026-11-19T08:43:56.802523+00:00",
          "duration_ms": 806.0,
          "trace_id": "",
          "span_id": "",
          "http_status": 200,
          "error": null,
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
          "gen_ai_response_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
          "input_tokens": 17,
          "output_tokens": 32,
          "total_tokens": 49,
          "cost": null,
          "agentgateway_user": null,
          "agentgateway_group": null,
          "user_agent_name": "Python-urllib",
          "has_payload": 1,
          "cache_read_input_tokens": 0,
          "cache_creation_input_tokens": null,
          "reasoning_tokens": 32,
          "time_to_first_token_ms": null,
          "time_per_output_token_ms": null,
          "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"gw-t1\",\"route\":\"default/ai-t1\",\"endpoint\":\"integrate.api.nvidia.com:443\",\"src.addr\":\"127.0.0.1:61439\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"protocol\":\"llm\",\"gen_ai.operation.name\":\"chat\",\"gen_ai.provider.name\":\"openai\",\"gen_ai.request.model\":\"nvidia/nemotron-3.5-lightning"
        }
      ]
    }
  },
  "cred_bearer": {
    "client": {
      "status": 200,
      "body": "{\"model\":\"nvidia/nemotron-3.5-lightning-30b-a3b\",\"usage\":{\"prompt_tokens\":17,\"completion_tokens\":32,\"total_tokens\":49,\"completion_tokens_details\":{\"reasoning_tokens\":32},\"prompt_tokens_details\":{\"cached_tokens\":0}},\"choices\":[{\"message\":{\"role\":\"assistant\",\"refusal\":null,\"reasoning_content\":\"Here's a thinking process:\\n\\n1.  **Analyze User Input:** The user said \\\"hi\\\".\\n2.  **Identify Intent:** This is a\"},\"index\":0,\"finish_reason\":\"length\",\"logprobs\":null}],\"id\":\"chatcmpl-f3557ccc-2d11-497f-9e9c-a96d4d73c718\",\"created\":1795077837,\"object\":\"chat.completion\"}",
      "duration_s": 0.879,
      "error": null
    },
    "request_logs": {
      "row_count": 1,
      "rows": [
        {
          "id": "01a1f2fa",
          "started_at": "2026-11-19T08:43:57.729086+00:00",
          "completed_at": "2026-11-19T08:43:58.584330+00:00",
          "duration_ms": 855.0,
          "trace_id": "",
          "span_id": "",
          "http_status": 200,
          "error": null,
          "gen_ai_operation_name": "chat",
          "gen_ai_provider_name": "openai",
          "gen_ai_request_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
          "gen_ai_response_model": "nvidia/nemotron-3.5-lightning-30b-a3b",
          "input_tokens": 17,
          "output_tokens": 32,
          "total_tokens": 49,
          "cost": null,
          "agentgateway_user": null,
          "agentgateway_group": null,
          "user_agent_name": "Python-urllib",
          "has_payload": 1,
          "cache_read_input_tokens": 0,
          "cache_creation_input_tokens": null,
          "reasoning_tokens": 32,
          "time_to_first_token_ms": null,
          "time_per_output_token_ms": null,
          "attributes_json": "{\"gateway\":\"default/default\",\"listener\":\"gw-t1\",\"route\":\"default/ai-t1\",\"endpoint\":\"integrate.api.nvidia.com:443\",\"src.addr\":\"127.0.0.1:63633\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.version\":\"HTTP/1.1\",\"http.status\":200,\"protocol\":\"llm\",\"gen_ai.operation.name\":\"chat\",\"gen_ai.provider.name\":\"openai\",\"gen_ai.request.model\":\"nvidia/nemotron-3.5-lightning"
        }
      ]
    }
  },
  "config": {
    "evidence_file": "cfg-E17-T1-real.yaml",
    "note": "backendAuth key {file: ...} -> gitignored .e17-tmp key file; real key never written"
  },
  "config_cred": {
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
      "gw-t1": {
        "port": 3692,
        "bindAddress": "127.0.0.1"
      }
    },
    "routes": [
      {
        "name": "ai-t1",
        "gateways": "gw-t1",
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
                      "name": "nvidia",
                      "hostOverride": "integrate.api.nvidia.com:443",
                      "provider": {
                        "openAI": {
                          "model": "nvidia/nemotron-3.5-lightning-30b-a3b"
                        }
                      },
                      "policies": {
                        "backendAuth": {
                          "credentials": [
                            {
                              "location": {
                                "header": {
                                  "name": "Authorization",
                                  "prefix": "Bearer "
                                }
                              },
                              "key": {
                                "file": "<gitignored-key-file>"
                              }
                            }
                          ]
                        },
                        "backendTLS": {
                          "hostname": "integrate.api.nvidia.com"
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
  "binary": {
    "binary": "C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints true)",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
