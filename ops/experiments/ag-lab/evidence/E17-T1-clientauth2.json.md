{
  "section": "T1-A5b route-level client apiKey (mode strict)",
  "schema_accepted": true,
  "validate": {
    "exit": 0,
    "stderr": ""
  },
  "run": {
    "valid_client_key": {
      "status": 200,
      "body": "{\"model\":\"mock-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"mock reply\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\",\"created\":1700000000}",
      "error": null
    },
    "wrong_client_key": {
      "status": 401,
      "body": "authentication failed",
      "error": null
    },
    "no_client_key": {
      "status": 401,
      "body": "authentication failed",
      "error": null
    },
    "mock_stats": {
      "name": "t1-supp-mock",
      "total": 1,
      "counts": {
        "/api-key": 1
      },
      "auth_shapes": {
        "Bearer sk-e17-synthetic-": 1
      }
    }
  },
  "config": {
    "evidence_file": "cfg-E17-T1-clientauth2.yaml",
    "note": "backendAuth key {file: ...} -> gitignored .e17-tmp key file; real key never written"
  },
  "binary": {
    "binary": "C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints true)",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
