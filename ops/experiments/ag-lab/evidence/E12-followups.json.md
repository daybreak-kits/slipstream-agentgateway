{
  "apiKey_user_id_same_user": {
    "expr": "apiKey.user_id",
    "validate_exit": 0,
    "stderr": "",
    "key1": [
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
    "key2_same_value": [
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
  "apiKey_missing_field": {
    "expr": "apiKey.no_such_field",
    "validate_exit": 0,
    "stderr": "",
    "key1": [
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
      }
    ],
    "key2_same_value": [
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
  "reload_without_limit_change": {
    "first_request": [
      {
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
        "headers": {
          "x-ratelimit-limit": "2",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "3599"
        }
      }
    ],
    "reload_ok": true,
    "two_after_unrelated_reload": [
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
    "ag_log_tail": "2026-11-16T18:39:26.673127Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:39:26.677603Z\tinfo\tstate_manager\tWatching config file: <local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-16T18:39:26.678902Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (258.1243ms), still awaiting 1 tasks\t\n2026-11-16T18:39:26.680190Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-16T18:39:26.680230Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (259.4511ms), marking server ready\t\n2026-11-16T18:39:26.680262Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-16T18:39:26.680419Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-16T18:39:26.680511Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-16T18:39:27.301375Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:11675 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=10ms\n2026-11-16T18:39:27.623469Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:39:27.736804Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:11677 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:39:27.763604Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:11678 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e12 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms"
  },
  "lru_30k": {
    "old_bucket_exhaust": [
      200,
      200,
      429
    ],
    "flood": {
      "count": 30000,
      "ok": 30000,
      "other": 0,
      "seconds": 108.4
    },
    "old_after_30k": [
      429,
      429
    ]
  }
}
