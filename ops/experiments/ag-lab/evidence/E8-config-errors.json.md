{
  "bad_yaml_syntax": {
    "exit": 1,
    "stdout": "",
    "stderr": "Error: invalid config: config.adminAddr: invalid type: sequence, expected a string at line 2 column 14"
  },
  "unknown_field": {
    "exit": 1,
    "stdout": "",
    "stderr": "Error: invalid config: config: unknown field `noSuchField`, expected one of `enableIpv6`, `dns`, `localXdsPath`, `modelCatalog`, `database`, `storage`, `caAddress`, `caAuthToken`, `xdsAddress`, `xdsAuthToken`, `spiffe`, `namespace`, `gateway`, `trustDomain`, `additionalTrustDomains`, `skipValidateTrustDomain`, `serviceAccount`, `clusterId`, `network`, `adminAddr`, `standardAttributes`, `statsAddr`, `histograms`, `readinessAddr`, `session`, `mcp`, `sensitiveHeaders`, `customFunctions`, `connectionTerminationDeadline`, `connectionMinTerminationDeadline`, `workerThreads`, `tracing`, `logging`, `metrics`, `backend`, `callouts`, `listener`, `hbone` at line 1 column 44"
  },
  "missing_provider_reference": {
    "exit": 1,
    "stdout": "",
    "stderr": "Error: model x references unknown provider does-not-exist"
  },
  "bad_priority": {
    "exit": 0,
    "stdout": "Configuration is valid!",
    "stderr": ""
  },
  "reload_failure_old_config": {
    "status": 200,
    "body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\""
  },
  "reload_restored": {
    "status": 200
  },
  "ag_log_tail": "2026-11-16T18:16:48.582437Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-16T18:16:48.957148Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-16T18:16:48.958273Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-16T18:16:48.969615Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=11.3452ms\n2026-11-16T18:16:48.984349Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-16T18:16:49.021990Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:16:49.025814Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\workspace\\webdev\\slipstream\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-16T18:16:49.027016Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (445.1327ms), still awaiting 1 tasks\t\n2026-11-16T18:16:49.028966Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-16T18:16:49.029023Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (447.1377ms), marking server ready\t\n2026-11-16T18:16:49.029067Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-16T18:16:49.029453Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-16T18:16:49.029572Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-16T18:16:57.603254Z\terror\tstate_manager\tFailed to reload config: did not find expected ',' or ']' at line 3 column 1, while parsing a flow sequence at line 2 column 14\t\n2026-11-16T18:16:59.518315Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9061 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t1 gen_ai.response.model=model-t1 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=13ms\n2026-11-16T18:16:59.833606Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\workspace\\\\webdev\\\\slipstream\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-16T18:17:01.024775Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:9064 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-t1 gen_ai.response.model=model-t1 agw.ai.original_model=vm-e7a gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms"
}
