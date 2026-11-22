{
  "section": "T1-A5 route-level client apiKey",
  "schema_accepted": false,
  "validate": {
    "exit": 1,
    "stdout": "",
    "stderr": "Error: routes[0]: unknown variant `required`, expected one of `strict`, `optional`, `permissive` at line 23 column 5"
  },
  "run": {},
  "config": {
    "evidence_file": "cfg-E17-T1-clientauth.yaml",
    "note": "backendAuth key {file: ...} -> gitignored .e17-tmp key file; real key never written"
  },
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints true)",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
