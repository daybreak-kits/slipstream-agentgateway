{
  "section": "T1-A0 validate-only matrix",
  "validate": {
    "real_bare_tls": {
      "exit": 0,
      "stderr": ""
    },
    "real_cred_bearer": {
      "exit": 0,
      "stderr": ""
    },
    "real_badkey_403shape": {
      "exit": 0,
      "stderr": ""
    },
    "real_badkey_401shape": {
      "exit": 0,
      "stderr": ""
    },
    "host_no_port": {
      "exit": 1,
      "stderr": "Error: routes[0]: invalid host:port: integrate.api.nvidia.com at line 23 column 5"
    },
    "plain_http_no_tls": {
      "exit": 0,
      "stderr": ""
    },
    "tls_without_hostname": {
      "exit": 0,
      "stderr": ""
    }
  },
  "config": {
    "evidence_file": "cfg-E17-T1-validate.yaml",
    "note": "backendAuth key {file: ...} -> gitignored .e17-tmp key file; real key never written"
  },
  "schema_facts": {
    "provider_auth": "LocalNamedAIProvider has NO auth field; upstream auth = policies.backendAuth (BackendAuthCompat)",
    "backendAuth_bare": "{key:{file}} -> Authorization: Bearer <key>",
    "backendAuth_credentials": "{credentials:[{location:{header:{name,prefix}}, key:{file}}]}",
    "hostOverride": "must be host:port (schema regex/enforcement); no scheme",
    "backendTLS": "presence switches dial to TLS; hostname used as SNI/verify",
    "route_client_apiKey_mode_enum": [
      "strict",
      "optional",
      "permissive"
    ],
    "retry": "route-level FilterOrPolicy.retry only (attempts/codes/backoff/...)",
    "health": "unhealthyExpression + eviction.consecutiveFailures together"
  },
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints true)",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
