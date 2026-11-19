{
  "section": "T1-A6 hostOverride/TLS dial hazards",
  "host_no_port_validate": {
    "exit": 1,
    "stdout": "",
    "stderr": "Error: routes[0]: invalid host:port: integrate.api.nvidia.com at line 23 column 5"
  },
  "plain_http_run": {
    "client": {
      "status": 400,
      "body": "<html>\r\n<head><title>400 The plain HTTP request was sent to HTTPS port</title></head>\r\n<body>\r\n<center><h1>400 Bad Request</h1></center>\r\n<center>The plain HTTP request was sent to HTTPS port</center>\r\n</body>\r\n</html>\r\n",
      "error": null,
      "duration_s": 0.249
    },
    "config": {
      "config": {
        "adminAddr": "127.0.0.1:3921",
        "statsAddr": "127.0.0.1:3922",
        "readinessAddr": "127.0.0.1:3923",
        "database": {
          "url": "sqlite://data.db"
        },
        "storage": {
          "mode": "file"
        },
        "session": {
          "key": "3a5dde678b895d76e244397deac58c4eac0199d751ee0c168e4ef022d62e9c2e"
        }
      },
      "gateways": {
        "gw-t1": {
          "port": 3692,
          "bindAddress": "127.0.0.1"
        }
      },
      "routes": [
        {
          "name": "ai-t1",
          "gateways": "gw-t1",
          "matches": [
            {
              "path": {
                "pathPrefix": "/v1/chat/completions"
              }
            }
          ],
          "backends": [
            {
              "ai": {
                "groups": [
                  {
                    "providers": [
                      {
                        "name": "nvidia",
                        "hostOverride": "integrate.api.nvidia.com:443",
                        "provider": {
                          "openAI": {
                            "model": "nvidia/nemotron-3.5-lightning-30b-a3b"
                          }
                        },
                        "policies": {
                          "backendAuth": {
                            "key": {
                              "file": "<gitignored-key-file>"
                            }
                          }
                        }
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      ],
      "frontendPolicies": {
        "accessLog": {
          "database": {
            "llm": "full"
          }
        }
      }
    },
    "note": "hostOverride host:port without policies.backendTLS => plain HTTP dial to :443; upstream rejects"
  },
  "config": {
    "evidence_file": "cfg-E17-T1-dial.yaml",
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
