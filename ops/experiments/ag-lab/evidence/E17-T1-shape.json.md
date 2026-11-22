{
  "section": "T1-A1 mock header shape matrix",
  "rows": [
    {
      "case": "bare",
      "expected": "Authorization: Bearer <provider key>",
      "client_status": 200,
      "upstream_path": "/shape-bare/chat/completions",
      "upstream_auth_observed": "Bearer sk-e17-synthetic-",
      "hit_prefix": "/shape-bare"
    },
    {
      "case": "cred",
      "expected": "Authorization: <raw provider key>",
      "client_status": 200,
      "upstream_path": "/shape-cred/chat/completions",
      "upstream_auth_observed": "sk-e17-synthetic-shape-k",
      "hit_prefix": "/shape-cred"
    },
    {
      "case": "cred_bearer",
      "expected": "Authorization: Bearer <provider key>",
      "client_status": 200,
      "upstream_path": "/shape-cred-bearer/chat/completions",
      "upstream_auth_observed": "Bearer sk-e17-synthetic-",
      "hit_prefix": "/shape-cred-bearer"
    },
    {
      "case": "none",
      "expected": "client Authorization forwarded upstream (security note)",
      "client_status": 200,
      "upstream_path": "/shape-none/chat/completions",
      "upstream_auth_observed": "Bearer sk-ss-lab-client-",
      "hit_prefix": "/shape-none"
    }
  ],
  "validate": {
    "shape_bare": {
      "exit": 0,
      "stdout": "Configuration is valid!",
      "stderr": ""
    },
    "shape_cred": {
      "exit": 0,
      "stdout": "Configuration is valid!",
      "stderr": ""
    },
    "shape_cred_bearer": {
      "exit": 0,
      "stdout": "Configuration is valid!",
      "stderr": ""
    },
    "shape_none": {
      "exit": 0,
      "stdout": "Configuration is valid!",
      "stderr": ""
    }
  },
  "configs": {
    "bare": {
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
                        "name": "mock-bare",
                        "hostOverride": "127.0.0.1:54749",
                        "provider": {
                          "openAI": {
                            "model": "mock-model"
                          }
                        },
                        "pathPrefix": "/shape-bare",
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
    "cred": {
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
                        "name": "mock-cred",
                        "hostOverride": "127.0.0.1:54749",
                        "provider": {
                          "openAI": {
                            "model": "mock-model"
                          }
                        },
                        "pathPrefix": "/shape-cred",
                        "policies": {
                          "backendAuth": {
                            "credentials": [
                              {
                                "location": {
                                  "header": {
                                    "name": "Authorization"
                                  }
                                },
                                "key": {
                                  "file": "<gitignored-key-file>"
                                }
                              }
                            ]
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
    "cred_bearer": {
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
                        "name": "mock-cred_bearer",
                        "hostOverride": "127.0.0.1:54749",
                        "provider": {
                          "openAI": {
                            "model": "mock-model"
                          }
                        },
                        "pathPrefix": "/shape-cred-bearer",
                        "policies": {
                          "backendAuth": {
                            "credentials": [
                              {
                                "location": {
                                  "header": {
                                    "name": "Authorization",
                                    "prefix": "Bearer "
                                  }
                                },
                                "key": {
                                  "file": "<gitignored-key-file>"
                                }
                              }
                            ]
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
    "none": {
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
                        "name": "mock-none",
                        "hostOverride": "127.0.0.1:54749",
                        "provider": {
                          "openAI": {
                            "model": "mock-model"
                          }
                        },
                        "pathPrefix": "/shape-none"
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
    }
  },
  "binary": {
    "binary": "<local-home>\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints true)",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  }
}
