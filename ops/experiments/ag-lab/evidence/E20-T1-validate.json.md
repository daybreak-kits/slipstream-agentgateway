{
  "scenarios": {
    "T1-when2": {
      "validate": {
        "exit": 0,
        "stdout": "Configuration is valid!",
        "stderr": ""
      },
      "config_file": "cfg-E20-T1-when2.yaml"
    },
    "T1-mixed-kn2": {
      "validate": {
        "exit": 1,
        "stdout": "",
        "stderr": "Error: virtual model vm-e20 conditional fallback target must be last"
      },
      "config_file": "cfg-E20-T1-mixed-kn2.yaml"
    },
    "T1-mixed-k1": {
      "validate": {
        "exit": 0,
        "stdout": "Configuration is valid!",
        "stderr": ""
      },
      "config_file": "cfg-E20-T1-mixed-k1.yaml"
    },
    "T1-true-tail": {
      "validate": {
        "exit": 0,
        "stdout": "Configuration is valid!",
        "stderr": ""
      },
      "config_file": "cfg-E20-T1-true-tail.yaml"
    },
    "T1-neg-tail": {
      "validate": {
        "exit": 1,
        "stdout": "",
        "stderr": "Error: virtual model vm-e20 conditional fallback target must be last"
      },
      "config_file": "cfg-E20-T1-neg-tail.yaml"
    },
    "T1-ctrl-single": {
      "validate": {
        "exit": 0,
        "stdout": "Configuration is valid!",
        "stderr": ""
      },
      "config_file": "cfg-E20-T1-ctrl-single.yaml"
    }
  },
  "when_cel": "request.headers[\"x-route\"] == \"a\"",
  "binary": {
    "binary": "ops/experiments/ag-lab/bin-e14/agentgateway.exe",
    "version": "v1.7.0",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c"
  }
}
