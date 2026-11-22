{
  "stats_probe": {
    "stats": "# HELP agentgateway_config_synchronized Whether the last configuration load/reload was successful or not, being synchronized with the on-disk configuration.\n# TYPE agentgateway_config_synchronized gauge\nagentgateway_config_synchronized 1\n# HELP agentgateway_tokio_global_queue_depth number of tasks currently scheduled in the runtime’s global queue\n# TYPE agentgateway_tokio_global_queue_depth gauge\nagentgateway_tokio_global_queue_depth 0\n# HELP agentgateway_tokio_num_alive_tasks number of currently alive tasks in the runtime\n# TYPE agentgateway_tokio_num_alive_tasks gauge\nagentgateway_tokio_num_alive_tasks 5\n# HELP agentgateway_tokio_num_workers number of worker threads used by the runtime\n# TYPE agentgateway_tokio_num_workers gauge\nagentgateway_tokio_num_workers 8\n# HELP agentgateway_build Agentgateway build information.\n# TYPE agentgateway_build info\nagentgateway_build_info{tag=\"True\"} 1\n# HELP agentgateway_gen_ai_client_token_usage Number of tokens used per request.\n# TYPE agentgateway_gen_ai_client_token_usage histogram\nagentgateway_gen_ai_client_token_usage_sum{gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"model-ok\",gen_ai_response_model=\"model-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"llm\",route=\"internal/llm:request\",route_rule=\"unknown\"} 10.0\nagentgateway_gen_ai_client_token_usage_count{gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"model-ok\",gen_ai_response_model=\"model-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"llm\",route=\"internal/llm:request\",route_rule=\"unknown\"} 2\nagentgateway_gen_ai_client_token_usage_bucket{le=\"1.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"model-ok\",gen_ai_response_model=\"model-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"llm\",route=\"internal/llm:request\",route_rule=\"unknown\"} 0\nagentgateway_gen_ai_client_token_usage_bucket{le=\"4.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"model-ok\",gen_ai_response_model=\"model-ok\",bind=\"bind/3692\",gateway=\"default/default\",listener=\"llm\",route=\"internal/llm:request\",route_rule=\"unknown\"} 0\nagentgateway_gen_ai_client_token_usage_bucket{le=\"16.0\",gen_ai_token_type=\"input\",gen_ai_operation_name=\"chat\",gen_ai_system=\"openai\",gen_ai_request_model=\"model-ok\",gen_ai_response_model=\"model-ok\",bind=\"bind/3692\",gateway=\"default/default\",lis",
    "stats_root": "<HTTPError 404: 'Not Found'>",
    "admin": "<!doctype html>\n<html lang=\"en\">\n\t<head>\n\t\t<meta charset=\"UTF-8\">\n\t\t<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n\t\t<link rel=\"icon\" href=\"/ui/favicon.svg\">\n\t\t<title>agentgateway</title>\n\t\t<script type=\"module\" crossorigin src=\"/ui/assets/index-CrvXzfeP.js\"></script>\n\t\t<link rel=\"stylesheet\" crossorigin href=\"/ui/assets/index-CXLMCbhH.css\">\n\t</head>\n\t<body>\n\t\t<div id=\"root\"></div>\n\t</body>\n</html>\n"
  },
  "metadata_user_id": {
    "key_expr": "apiKey.metadata.user_id",
    "validate_exit": 0,
    "validate_stderr": "",
    "key1_three": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "3598"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598",
          "retry-after": "3598"
        }
      }
    ],
    "key2_one_after_key1_exhausted": [
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598",
          "retry-after": "3598"
        }
      }
    ]
  },
  "flattened_user_id": {
    "key_expr": "apiKey.user_id",
    "validate_exit": 0,
    "validate_stderr": "",
    "key1_three": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      }
    ],
    "key2_one_after_key1_exhausted": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "3599"
        }
      }
    ]
  },
  "shared_user_id": {
    "validate_exit": 0,
    "validate_stderr": "",
    "key1_three": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      }
    ],
    "key2_one_same_user_id": [
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      }
    ]
  },
  "tokens_max13_default_usage": {
    "mock_usage": "prompt=5 completion=3 total=8",
    "requests": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "13",
          "x-ratelimit-remaining": "13",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "13",
          "x-ratelimit-remaining": "5",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "13",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "13",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "13",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      }
    ]
  },
  "tokens_prompt100": {
    "mock_usage": "prompt=100 completion=0 total=100",
    "requests": [
      {
        "status": 200,
        "body": "{\"model\":\"usage-p100\",\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":0,\"total_tokens\":100},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "100",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      }
    ]
  },
  "tokens_completion100": {
    "mock_usage": "prompt=0 completion=100 total=100",
    "requests": [
      {
        "status": 200,
        "body": "{\"model\":\"usage-c100\",\"usage\":{\"prompt_tokens\":0,\"completion_tokens\":100,\"total_tokens\":100},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "100",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      }
    ]
  },
  "tokens_per_fill_zero": {
    "requests": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598",
          "retry-after": "3598"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598",
          "retry-after": "3598"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598",
          "retry-after": "3598"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598",
          "retry-after": "3598"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598",
          "retry-after": "3598"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598",
          "retry-after": "3598"
        }
      }
    ],
    "after_2s_wait": [
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3596",
          "retry-after": "3596"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3596",
          "retry-after": "3596"
        }
      }
    ]
  },
  "reload_max_tokens": {
    "initial_2": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3598",
          "retry-after": "3598"
        }
      }
    ],
    "reload_ok": true,
    "after_max5": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "5",
          "x-ratelimit-remaining": "4",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "5",
          "x-ratelimit-remaining": "3",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "5",
          "x-ratelimit-remaining": "2",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "5",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "3599"
        }
      }
    ],
    "ag_log_tail": "2026-11-16T18:36:21.828293Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-16T18:36:22.249245Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-16T18:36:22.251453Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-16T18:36:22.260745Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=9.3055ms\n2026-11-16T18:36:22.270858Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-16T18:36:22.323665Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:36:22.331361Z\tinfo\tstate_manager\tWatching config file: <local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-16T18:36:22.333304Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (505.8194ms), still awaiting 1 tasks\t\n2026-11-16T18:36:22.347897Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-16T18:36:22.348280Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (520.7822ms), marking server ready\t\n2026-11-16T18:36:22.348424Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-16T18:36:22.349782Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-16T18:36:22.350826Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-16T18:36:23.263366Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:10527 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=140ms\n2026-11-16T18:36:23.294561Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:10529 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=6ms\n2026-11-16T18:36:23.320406Z\terror\trequest gateway=default/default listener=llm route=internal/llm:request src.addr=127.0.0.1:10530 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=http error=\"rate limit exceeded\" reason=RateLimit duration=0ms\n2026-11-16T18:36:23.612280Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:36:23.763184Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:10532 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:36:23.789068Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:10533 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-16T18:36:23.815508Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:10534 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-16T18:36:23.845291Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:10535 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=6ms"
  },
  "restart_reset": {
    "before_restart": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 429,
        "body": "rate limit exceeded",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599",
          "retry-after": "3599"
        }
      }
    ],
    "after_restart": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "3599"
        }
      },
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "3599"
        }
      }
    ],
    "ag_log_tail": "2026-11-16T18:36:28.319902Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-16T18:36:28.478927Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-16T18:36:28.480084Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-16T18:36:28.480735Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=660.8µs\n2026-11-16T18:36:28.490226Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-16T18:36:28.614650Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:36:28.621074Z\tinfo\tstate_manager\tWatching config file: <local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-16T18:36:28.622618Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (303.1435ms), still awaiting 1 tasks\t\n2026-11-16T18:36:28.626341Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-16T18:36:28.626380Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (306.905ms), marking server ready\t\n2026-11-16T18:36:28.626420Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-16T18:36:28.626835Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-16T18:36:28.627122Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-16T18:36:29.204677Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:10552 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=8ms\n2026-11-16T18:36:29.231591Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:10554 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms"
  },
  "lru_eviction": {
    "old_bucket_exhaust": [
      200,
      200,
      429
    ],
    "other_buckets_2k": {
      "count": 2000,
      "ok": 2000,
      "other": 0
    },
    "old_after_2k": [
      429,
      429
    ],
    "other_buckets_12k": {
      "count": 12000,
      "ok": 12000,
      "other": 0
    },
    "old_after_12k": [
      429,
      429
    ],
    "stats": "<HTTPError 404: 'Not Found'>"
  },
  "e13_llm_policy_retry": {
    "validate_exit": 1,
    "stderr": "Error: llm.policies: unknown field `retry` at line 234 column 17"
  },
  "e13_model_retry": {
    "validate_exit": 1,
    "stderr": "Error: llm.models[0]: unknown field `retry`, expected one of `id`, `name`, `visibility`, `params`, `provider`, `passthrough`, `authorization`, `defaults`, `overrides`, `transformation`, `finalTransformation`, `requestTransformation`, `requestHeaders`, `responseHeaders`, `backendTLS`, `tls`, `auth`, `health`, `backendTunnel`, `guardrails`, `promptCaching`, `matches` at line 67 column 9"
  },
  "e9_cel_string_functions": {
    "validate_exit": 0,
    "validate_stderr": "",
    "response_status": 200,
    "mock_headers": {
      "authorization": "Bearer test-key",
      "x-cel-regex": "/id/{id}/data",
      "x-cel-regex-all": "[ID] [ID]",
      "x-cel-upper": "ABC",
      "x-cel-lower": "abc",
      "x-cel-replace": "a_b_c",
      "x-cel-trim": "padded"
    }
  }
}
