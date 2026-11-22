{
  "same_layer": [
    {
      "trial": 1,
      "status": 500,
      "counters": {
        "/fail": 1
      }
    },
    {
      "trial": 2,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 3,
      "status": 500,
      "counters": {
        "/fail": 1
      }
    },
    {
      "trial": 4,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 5,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 6,
      "status": 500,
      "counters": {
        "/fail": 1
      }
    },
    {
      "trial": 7,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 8,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 9,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 10,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 11,
      "status": 500,
      "counters": {
        "/fail": 1
      }
    },
    {
      "trial": 12,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    }
  ],
  "cross_layer": [
    {
      "trial": 1,
      "status": 500,
      "counters": {
        "/fail": 1
      }
    },
    {
      "trial": 2,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 3,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 4,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 5,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 6,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 7,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "trial": 8,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    }
  ],
  "ag_log_tail": "2026-11-16T18:16:01.960667Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-16T18:16:02.113436Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-16T18:16:02.114361Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-16T18:16:02.120692Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=6.3338ms\n2026-11-16T18:16:02.128065Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-16T18:16:02.145697Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:16:02.148211Z\tinfo\tstate_manager\tWatching config file: <local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-16T18:16:02.149207Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (188.9096ms), still awaiting 1 tasks\t\n2026-11-16T18:16:02.150242Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-16T18:16:02.150276Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (189.9784ms), marking server ready\t\n2026-11-16T18:16:02.150301Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-16T18:16:02.150496Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-16T18:16:02.150527Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-16T18:16:02.845049Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:8947 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=500 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-fail agw.ai.original_model=vm-e1b gen_ai.request.max_tokens=16 duration=7ms\n2026-11-16T18:16:03.054321Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:8951 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e1b gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-16T18:16:03.265316Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:8954 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e1b gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-16T18:16:03.478629Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:8958 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e1b gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-16T18:16:03.690098Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:8961 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e1b gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-16T18:16:03.922053Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:8965 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e1b gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-16T18:16:04.144764Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:8968 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e1b gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-16T18:16:04.353949Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:8971 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e1b gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms"
}
