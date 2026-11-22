{
  "before_restart": [
    {
      "n": 1,
      "status": 500,
      "counters": {
        "/fail": 1
      }
    },
    {
      "n": 2,
      "status": 500,
      "counters": {
        "/fail": 1
      }
    },
    {
      "n": 3,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "n": 4,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "n": 5,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "n": 6,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "n": 7,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    },
    {
      "n": 8,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    }
  ],
  "after_restart": [
    {
      "n": 1,
      "status": 500,
      "counters": {
        "/fail": 1
      }
    },
    {
      "n": 2,
      "status": 500,
      "counters": {
        "/fail": 1
      }
    },
    {
      "n": 3,
      "status": 200,
      "counters": {
        "/ok": 1
      }
    }
  ],
  "ag_log_tail": "2026-11-16T18:16:09.240671Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-16T18:16:09.364493Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-16T18:16:09.365401Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-16T18:16:09.365939Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=539.2µs\n2026-11-16T18:16:09.375941Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-16T18:16:09.394814Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:16:09.397105Z\tinfo\tstate_manager\tWatching config file: <local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-16T18:16:09.397957Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (157.9668ms), still awaiting 1 tasks\t\n2026-11-16T18:16:09.398898Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-16T18:16:09.398929Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (158.9393ms), marking server ready\t\n2026-11-16T18:16:09.398948Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-16T18:16:09.399110Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-16T18:16:09.399127Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-16T18:16:10.152053Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9010 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=500 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-fail agw.ai.original_model=vm-e3 gen_ai.request.max_tokens=16 duration=11ms\n2026-11-16T18:16:10.315101Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9014 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=500 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-fail agw.ai.original_model=vm-e3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-16T18:16:10.489357Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9017 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e3 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms"
}
