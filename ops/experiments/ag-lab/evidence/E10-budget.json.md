{
  "validate": {
    "exit": 0,
    "stdout": "Configuration is valid!",
    "stderr": ""
  },
  "token_budget_requests": [
    {
      "n": 1,
      "status": 200,
      "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 2,
      "status": 200,
      "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 3,
      "status": 200,
      "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 4,
      "status": 200,
      "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 5,
      "status": 200,
      "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 6,
      "status": 200,
      "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 7,
      "status": 200,
      "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 8,
      "status": 200,
      "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 9,
      "status": 200,
      "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 10,
      "status": 200,
      "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 11,
      "status": 200,
      "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 12,
      "status": 200,
      "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 13,
      "status": 200,
      "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 14,
      "status": 429,
      "body": "{\"error\":{\"message\":\"budget exceeded\",\"type\":\"rate_limit_error\",\"code\":\"budget_exceeded\"}}"
    },
    {
      "n": 15,
      "status": 429,
      "body": "{\"error\":{\"message\":\"budget exceeded\",\"type\":\"rate_limit_error\",\"code\":\"budget_exceeded\"}}"
    },
    {
      "n": 16,
      "status": 429,
      "body": "{\"error\":{\"message\":\"budget exceeded\",\"type\":\"rate_limit_error\",\"code\":\"budget_exceeded\"}}"
    }
  ],
  "usd_budget_requests": [
    {
      "n": 1,
      "status": 200,
      "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 2,
      "status": 200,
      "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 3,
      "status": 200,
      "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    },
    {
      "n": 4,
      "status": 200,
      "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"fini"
    }
  ],
  "reload_reset_probe": {
    "before_reload_statuses": [
      200,
      200,
      200,
      200,
      200
    ],
    "after_reload": [
      {
        "n": 6,
        "status": 200,
        "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":"
      },
      {
        "n": 7,
        "status": 200,
        "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":"
      },
      {
        "n": 8,
        "status": 200,
        "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":"
      },
      {
        "n": 9,
        "status": 200,
        "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":"
      },
      {
        "n": 10,
        "status": 200,
        "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":"
      },
      {
        "n": 11,
        "status": 200,
        "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":"
      },
      {
        "n": 12,
        "status": 200,
        "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":"
      },
      {
        "n": 13,
        "status": 200,
        "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":"
      },
      {
        "n": 14,
        "status": 429,
        "body": "{\"error\":{\"message\":\"budget exceeded\",\"type\":\"rate_limit_error\",\"code\":\"budget_exceeded\"}}"
      },
      {
        "n": 15,
        "status": 429,
        "body": "{\"error\":{\"message\":\"budget exceeded\",\"type\":\"rate_limit_error\",\"code\":\"budget_exceeded\"}}"
      },
      {
        "n": 16,
        "status": 429,
        "body": "{\"error\":{\"message\":\"budget exceeded\",\"type\":\"rate_limit_error\",\"code\":\"budget_exceeded\"}}"
      },
      {
        "n": 17,
        "status": 429,
        "body": "{\"error\":{\"message\":\"budget exceeded\",\"type\":\"rate_limit_error\",\"code\":\"budget_exceeded\"}}"
      }
    ],
    "after_process_restart_statuses": [
      200,
      200,
      200
    ],
    "budget_usage_rows_after_tokens": {
      "budget_usage": []
    }
  },
  "budget_tables": {
    "budget_usage": {
      "columns": [],
      "rows": []
    }
  },
  "ag_log_tail": "2026-11-16T18:21:42.863903Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-16T18:21:43.057887Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-16T18:21:43.058973Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-16T18:21:43.064432Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=5.4628ms\n2026-11-16T18:21:43.074623Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-16T18:21:43.099585Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:21:43.103030Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-16T18:21:43.104712Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (241.1752ms), still awaiting 1 tasks\t\n2026-11-16T18:21:43.107785Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-16T18:21:43.107897Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (244.3542ms), marking server ready\t\n2026-11-16T18:21:43.107961Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-16T18:21:43.108264Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-16T18:21:43.108361Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-16T18:21:43.979305Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9382 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t1 gen_ai.response.model=model-t1 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=12ms\n2026-11-16T18:21:43.986697Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9384 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:43.993107Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9385 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:43.999556Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9386 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t1 gen_ai.response.model=model-t1 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:44.006580Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9387 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t1 gen_ai.response.model=model-t1 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=4ms\n2026-11-16T18:21:44.014380Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9388 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:44.021392Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9389 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:44.028236Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9390 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:44.034472Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9391 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:44.042140Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9392 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=5ms\n2026-11-16T18:21:44.048927Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9393 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t1 gen_ai.response.model=model-t1 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:44.055732Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9394 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:44.061957Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9395 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:44.064810Z\twarn\tbudget\tAPI key budget exceeded\tconnection.id=15 request.id=14 api_key=\"tok-budget\" budget=\"tokens-100\" used=104 limit_unit=\"Tokens\" limit_amount=100 exceeded=true\n2026-11-16T18:21:44.065004Z\terror\trequest gateway=default/default listener=llm src.addr=127.0.0.1:9396 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=http error=\"Budget exceeded\" reason=RateLimit duration=0ms\n2026-11-16T18:21:44.067635Z\twarn\tbudget\tAPI key budget exceeded\tconnection.id=16 request.id=15 api_key=\"tok-budget\" budget=\"tokens-100\" used=104 limit_unit=\"Tokens\" limit_amount=100 exceeded=true\n2026-11-16T18:21:44.067793Z\terror\trequest gateway=default/default listener=llm src.addr=127.0.0.1:9397 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=http error=\"Budget exceeded\" reason=RateLimit duration=0ms\n2026-11-16T18:21:44.070308Z\twarn\tbudget\tAPI key budget exceeded\tconnection.id=17 request.id=16 api_key=\"tok-budget\" budget=\"tokens-100\" used=104 limit_unit=\"Tokens\" limit_amount=100 exceeded=true\n2026-11-16T18:21:44.070459Z\terror\trequest gateway=default/default listener=llm src.addr=127.0.0.1:9398 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=http error=\"Budget exceeded\" reason=RateLimit duration=0ms\n2026-11-16T18:21:44.078788Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9399 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:44.084970Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9400 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t1 gen_ai.response.model=model-t1 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms\n2026-11-16T18:21:44.090449Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9401 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t1 gen_ai.response.model=model-t1 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-16T18:21:44.096741Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9402 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t1 gen_ai.response.model=model-t1 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=3ms"
}
