{
  "section": "T1-A7 OpenRouter availability + AG panic seen in probe",
  "direct": {
    "status": 429,
    "body": "{\"error\":{\"message\":\"Rate limit exceeded: free-models-per-day-high-balance. \",\"code\":429,\"metadata\":{\"headers\":{\"X-RateLimit-Limit\":\"1000\",\"X-RateLimit-Remaining\":\"0\",\"X-RateLimit-Reset\":\"1795132800000\"},\"limit_source\":\"openrouter_free_tier_daily\",\"remedy_hint\":\"Wait for the daily reset (see X-RateLimit-Reset), or purchase credits to raise your free-model daily limit.\",\"provider_name\":null}},\"user_id\":\"user_39bZSC3uQSF8BYXz2QZKfjhuOge\"}",
    "ratelimit_headers": {
      "x-ratelimit-reset": "1795132800000",
      "x-ratelimit-limit": "1000",
      "x-ratelimit-remaining": "0"
    },
    "note": "if 429 daily-free quota -> T3 cannot use OR as real backup today"
  },
  "prior_probe": [
    {
      "log": "ag-probe3-api_bare.log",
      "label": "pathPrefix=/api",
      "hits": []
    },
    {
      "log": "ag-probe4-apiv1_bare.log",
      "label": "pathPrefix=/api/v1",
      "hits": [
        "thread 'agentgateway-0' (35876) panicked at crates\\agentgateway\\src\\http\\outlierdetection.rs:60:30:",
        "overflow when adding duration to `SystemTime`",
        "2026-11-19T08:27:59.189085Z\tinfo\trequest gateway=default/default listener=gw-e17 route=default/ai-e17 endpoint=openrouter.ai:443 src.addr=127.0.0.1:62508 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=nvidia/nemotron-3.5-lightning:free gen_ai.request.max_tokens=8 duration=1717ms"
      ]
    }
  ],
  "impact_on_T3": "if 429 daily free quota exhausted, OR cannot be the real backup today; T3 substitutes a second real NVIDIA provider",
  "binary": {
    "binary": "C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints true)",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
