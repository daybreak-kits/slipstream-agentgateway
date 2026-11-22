{
  "direct_internal_model": {
    "status": 404,
    "headers": {
      "content-type": "application/json",
      "connection": "close",
      "content-length": "95",
      "date": "Mon, 16 Nov 2026 18:13:16 GMT"
    },
    "body": "{\"error\":{\"message\":\"Model not found\",\"type\":\"invalid_request_error\",\"code\":\"model_not_found\"}}"
  },
  "no_key": {
    "status": 401,
    "headers": {
      "content-type": "text/plain",
      "connection": "close",
      "content-length": "21",
      "date": "Mon, 16 Nov 2026 18:13:16 GMT"
    },
    "body": "authentication failed"
  },
  "bad_key": {
    "status": 401,
    "headers": {
      "content-type": "text/plain",
      "connection": "close",
      "content-length": "21",
      "date": "Mon, 16 Nov 2026 18:13:16 GMT"
    },
    "body": "authentication failed"
  },
  "ag_log_tail": "2026-11-16T18:13:15.399939Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-16T18:13:15.636513Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-16T18:13:15.638013Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-16T18:13:15.650640Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=12.6305ms\n2026-11-16T18:13:15.664404Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-16T18:13:15.709591Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:13:15.717021Z\tinfo\tstate_manager\tWatching config file: <local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-16T18:13:15.718829Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (319.3338ms), still awaiting 1 tasks\t\n2026-11-16T18:13:15.721048Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-16T18:13:15.721101Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (321.6071ms), marking server ready\t\n2026-11-16T18:13:15.721142Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-16T18:13:15.721305Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-16T18:13:15.721445Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-16T18:13:16.430896Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request src.addr=127.0.0.1:8463 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=404 protocol=llm agw.ai.original_model=m-ok reason=DirectResponse duration=5ms\n2026-11-16T18:13:16.434154Z\terror\trequest gateway=default/default listener=llm src.addr=127.0.0.1:8464 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=http error=\"api key authentication failure: no API Key found\" reason=APIKeyAuth duration=0ms\n2026-11-16T18:13:16.436598Z\terror\trequest gateway=default/default listener=llm src.addr=127.0.0.1:8465 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=http error=\"api key authentication failure: invalid credentials\" reason=APIKeyAuth duration=0ms"
}
