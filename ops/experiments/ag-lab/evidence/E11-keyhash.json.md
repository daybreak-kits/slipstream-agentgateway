{
  "validate": {
    "exit": 0,
    "stdout": "Configuration is valid!",
    "stderr": ""
  },
  "hash_value": "c4ab3de20c9cb8d8a9c096d61c9c320f41c7daec3ac718cb6f8f60f185821dc8",
  "hashed_key_request": {
    "status": 200,
    "headers": {
      "Server": "BaseHTTP/0.6 Python/3.13.14",
      "Date": "Mon, 16 Nov 2026 18:20:01 GMT",
      "Content-Type": "application/json",
      "connection": "close",
      "Content-Length": "228"
    },
    "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}"
  },
  "plain_key_request": {
    "status": 200,
    "headers": {
      "Server": "BaseHTTP/0.6 Python/3.13.14",
      "Date": "Mon, 16 Nov 2026 18:20:01 GMT",
      "Content-Type": "application/json",
      "connection": "close",
      "Content-Length": "228"
    },
    "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}"
  },
  "unknown_key_request": {
    "status": 401,
    "headers": {
      "content-type": "text/plain",
      "connection": "close",
      "content-length": "21",
      "date": "Mon, 16 Nov 2026 18:20:01 GMT"
    },
    "body": "authentication failed"
  },
  "ag_log_tail": "2026-11-16T18:19:59.745834Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-16T18:20:00.266159Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=<local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-16T18:20:00.267935Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-16T18:20:00.282534Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=14.6024ms\n2026-11-16T18:20:00.297815Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-16T18:20:00.332620Z\tinfo\tstate_manager\tloaded config from File(\"<local-home>\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:20:00.337757Z\tinfo\tstate_manager\tWatching config file: <local-home>\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-16T18:20:00.339546Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (594.3145ms), still awaiting 1 tasks\t\n2026-11-16T18:20:00.343142Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-16T18:20:00.343205Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (597.9728ms), marking server ready\t\n2026-11-16T18:20:00.343468Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-16T18:20:00.343525Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-16T18:20:00.343897Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-16T18:20:01.199426Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9223 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t2 gen_ai.response.model=model-t2 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=10ms\n2026-11-16T18:20:01.207539Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9225 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t1 gen_ai.response.model=model-t1 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=5ms\n2026-11-16T18:20:01.212069Z\terror\trequest gateway=default/default listener=llm src.addr=127.0.0.1:9226 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=http error=\"api key authentication failure: invalid credentials\" reason=APIKeyAuth duration=0ms",
  "uppercase_validate": {
    "exit": 0,
    "stdout": "Configuration is valid!",
    "stderr": ""
  },
  "uppercase_request": {
    "status": 200,
    "headers": {
      "Server": "BaseHTTP/0.6 Python/3.13.14",
      "Date": "Mon, 16 Nov 2026 18:20:04 GMT",
      "Content-Type": "application/json",
      "connection": "close",
      "Content-Length": "228"
    },
    "body": "{\"model\":\"model-t2\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}"
  },
  "malformed_validate": {
    "exit": 1,
    "stdout": "",
    "stderr": "Error: llm.policies: data did not match any variant of untagged enum LocalAPIKey at line 175 column 17"
  }
}
