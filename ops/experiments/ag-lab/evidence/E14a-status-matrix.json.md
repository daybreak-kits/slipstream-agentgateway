{
  "matrix": {
    "200": [
      {
        "n": 1,
        "status": 502,
        "body": "failed to process LLM response",
        "counters": {
          "/sc200": 1
        }
      },
      {
        "n": 2,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc200": 1,
          "/ok": 1
        }
      },
      {
        "n": 3,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc200": 1,
          "/ok": 2
        }
      }
    ],
    "400": [
      {
        "n": 1,
        "status": 400,
        "body": "{\"error\": {\"message\": \"mock upstream 400\", \"type\": \"mock_error\", \"code\": 400}}",
        "counters": {
          "/sc400": 1
        }
      },
      {
        "n": 2,
        "status": 400,
        "body": "{\"error\": {\"message\": \"mock upstream 400\", \"type\": \"mock_error\", \"code\": 400}}",
        "counters": {
          "/sc400": 2
        }
      },
      {
        "n": 3,
        "status": 400,
        "body": "{\"error\": {\"message\": \"mock upstream 400\", \"type\": \"mock_error\", \"code\": 400}}",
        "counters": {
          "/sc400": 3
        }
      }
    ],
    "401": [
      {
        "n": 1,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401": 1
        }
      },
      {
        "n": 2,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401": 2
        }
      },
      {
        "n": 3,
        "status": 401,
        "body": "{\"error\": {\"message\": \"mock upstream 401\", \"type\": \"mock_error\", \"code\": 401}}",
        "counters": {
          "/sc401": 3
        }
      }
    ],
    "403": [
      {
        "n": 1,
        "status": 403,
        "body": "{\"error\": {\"message\": \"mock upstream 403\", \"type\": \"mock_error\", \"code\": 403}}",
        "counters": {
          "/sc403": 1
        }
      },
      {
        "n": 2,
        "status": 403,
        "body": "{\"error\": {\"message\": \"mock upstream 403\", \"type\": \"mock_error\", \"code\": 403}}",
        "counters": {
          "/sc403": 2
        }
      },
      {
        "n": 3,
        "status": 403,
        "body": "{\"error\": {\"message\": \"mock upstream 403\", \"type\": \"mock_error\", \"code\": 403}}",
        "counters": {
          "/sc403": 3
        }
      }
    ],
    "404": [
      {
        "n": 1,
        "status": 404,
        "body": "{\"error\": {\"message\": \"mock upstream 404\", \"type\": \"mock_error\", \"code\": 404}}",
        "counters": {
          "/sc404": 1
        }
      },
      {
        "n": 2,
        "status": 404,
        "body": "{\"error\": {\"message\": \"mock upstream 404\", \"type\": \"mock_error\", \"code\": 404}}",
        "counters": {
          "/sc404": 2
        }
      },
      {
        "n": 3,
        "status": 404,
        "body": "{\"error\": {\"message\": \"mock upstream 404\", \"type\": \"mock_error\", \"code\": 404}}",
        "counters": {
          "/sc404": 3
        }
      }
    ],
    "408": [
      {
        "n": 1,
        "status": 408,
        "body": "{\"error\": {\"message\": \"mock upstream 408\", \"type\": \"mock_error\", \"code\": 408}}",
        "counters": {
          "/sc408": 1
        }
      },
      {
        "n": 2,
        "status": 408,
        "body": "{\"error\": {\"message\": \"mock upstream 408\", \"type\": \"mock_error\", \"code\": 408}}",
        "counters": {
          "/sc408": 2
        }
      },
      {
        "n": 3,
        "status": 408,
        "body": "{\"error\": {\"message\": \"mock upstream 408\", \"type\": \"mock_error\", \"code\": 408}}",
        "counters": {
          "/sc408": 3
        }
      }
    ],
    "429": [
      {
        "n": 1,
        "status": 429,
        "body": "{\"error\": {\"message\": \"mock upstream 429\", \"type\": \"mock_error\", \"code\": 429}}",
        "counters": {
          "/sc429": 1
        }
      },
      {
        "n": 2,
        "status": 429,
        "body": "{\"error\": {\"message\": \"mock upstream 429\", \"type\": \"mock_error\", \"code\": 429}}",
        "counters": {
          "/sc429": 2
        }
      },
      {
        "n": 3,
        "status": 429,
        "body": "{\"error\": {\"message\": \"mock upstream 429\", \"type\": \"mock_error\", \"code\": 429}}",
        "counters": {
          "/sc429": 3
        }
      }
    ],
    "499": [
      {
        "n": 1,
        "status": 499,
        "body": "{\"error\": {\"message\": \"mock upstream 499\", \"type\": \"mock_error\", \"code\": 499}}",
        "counters": {
          "/sc499": 1
        }
      },
      {
        "n": 2,
        "status": 499,
        "body": "{\"error\": {\"message\": \"mock upstream 499\", \"type\": \"mock_error\", \"code\": 499}}",
        "counters": {
          "/sc499": 2
        }
      },
      {
        "n": 3,
        "status": 499,
        "body": "{\"error\": {\"message\": \"mock upstream 499\", \"type\": \"mock_error\", \"code\": 499}}",
        "counters": {
          "/sc499": 3
        }
      }
    ],
    "500": [
      {
        "n": 1,
        "status": 500,
        "body": "{\"error\": {\"message\": \"mock upstream 500\", \"type\": \"mock_error\", \"code\": 500}}",
        "counters": {
          "/sc500": 1
        }
      },
      {
        "n": 2,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc500": 1,
          "/ok": 1
        }
      },
      {
        "n": 3,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc500": 1,
          "/ok": 2
        }
      }
    ],
    "502": [
      {
        "n": 1,
        "status": 502,
        "body": "{\"error\": {\"message\": \"mock upstream 502\", \"type\": \"mock_error\", \"code\": 502}}",
        "counters": {
          "/sc502": 1
        }
      },
      {
        "n": 2,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc502": 1,
          "/ok": 1
        }
      },
      {
        "n": 3,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc502": 1,
          "/ok": 2
        }
      }
    ],
    "503": [
      {
        "n": 1,
        "status": 503,
        "body": "{\"error\": {\"message\": \"mock upstream 503\", \"type\": \"mock_error\", \"code\": 503}}",
        "counters": {
          "/sc503": 1
        }
      },
      {
        "n": 2,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc503": 1,
          "/ok": 1
        }
      },
      {
        "n": 3,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc503": 1,
          "/ok": 2
        }
      }
    ],
    "504": [
      {
        "n": 1,
        "status": 504,
        "body": "{\"error\": {\"message\": \"mock upstream 504\", \"type\": \"mock_error\", \"code\": 504}}",
        "counters": {
          "/sc504": 1
        }
      },
      {
        "n": 2,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc504": 1,
          "/ok": 1
        }
      },
      {
        "n": 3,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc504": 1,
          "/ok": 2
        }
      }
    ],
    "505": [
      {
        "n": 1,
        "status": 505,
        "body": "{\"error\": {\"message\": \"mock upstream 505\", \"type\": \"mock_error\", \"code\": 505}}",
        "counters": {
          "/sc505": 1
        }
      },
      {
        "n": 2,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc505": 1,
          "/ok": 1
        }
      },
      {
        "n": 3,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc505": 1,
          "/ok": 2
        }
      }
    ],
    "520": [
      {
        "n": 1,
        "status": 520,
        "body": "{\"error\": {\"message\": \"mock upstream 520\", \"type\": \"mock_error\", \"code\": 520}}",
        "counters": {
          "/sc520": 1
        }
      },
      {
        "n": 2,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc520": 1,
          "/ok": 1
        }
      },
      {
        "n": 3,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc520": 1,
          "/ok": 2
        }
      }
    ],
    "599": [
      {
        "n": 1,
        "status": 599,
        "body": "{\"error\": {\"message\": \"mock upstream 599\", \"type\": \"mock_error\", \"code\": 599}}",
        "counters": {
          "/sc599": 1
        }
      },
      {
        "n": 2,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc599": 1,
          "/ok": 1
        }
      },
      {
        "n": 3,
        "status": 200,
        "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
        "counters": {
          "/sc599": 1,
          "/ok": 2
        }
      }
    ]
  },
  "stall": {
    "client_wait_s": 30.0,
    "result": {
      "status": null,
      "error": "TimeoutError('timed out')"
    },
    "counters": {
      "/sctimeout": 1
    }
  },
  "conn_refused": [
    {
      "n": 1,
      "status": 503,
      "body": "connection refused",
      "counters": {}
    },
    {
      "n": 2,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
      "counters": {
        "/ok": 1
      }
    },
    {
      "n": 3,
      "status": 200,
      "body": "{\"model\":\"model-ok\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\"",
      "counters": {
        "/ok": 2
      }
    }
  ],
  "request_logs": {
    "rows": [
      {
        "id": "01a1efc8-f3fe-77fa-86ef-257ee2d6ef39",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "502",
        "error": "failed to process LLM response: failed to parse response: missing field `model` at line 1 column 78",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-200",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "3",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-f4b4-73f8-b246-e7ebf242da44",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-f55f-714f-a4da-b95894580419",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-f619-7042-ab5f-5ebb9b153760",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "400",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-400",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-f6c5-7377-9fd8-968b6f156933",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "400",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-400",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-f780-7363-afdb-4b5d71a5847c",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "400",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-400",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-f82b-7237-b622-d37710ccfff9",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "401",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-401",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-f8c4-75ad-a97d-10ba57fdb10d",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "401",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-401",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-f970-70bc-be4e-98497f1e0aed",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "401",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-401",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-fa27-71c6-bb8b-f840d667fe76",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "403",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-403",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-fac1-746d-9533-052ef6545354",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "403",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-403",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-fb6d-7052-a1ac-f3d1e9f75006",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "403",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-403",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-fc27-7442-9ad5-534687526680",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "404",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-404",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-fcd4-734d-864f-801ed70fed31",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "404",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-404",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-fd6e-7706-bfce-09803012b613",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "404",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-404",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-fe38-7767-84d3-458d576d7ff2",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "408",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-408",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-fee1-743e-8434-85a81666117c",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "408",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-408",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc8-ff7b-72a4-a9b5-758c918c2e3c",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "408",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-408",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0029-71f8-99ee-779c8a5d43a7",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "429",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-429",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-00d4-73bf-a5d1-4a90254223fa",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "429",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-429",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-016e-74f0-a39d-546016e931cf",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "429",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-429",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0237-76a7-b485-60e88972e89c",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "499",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-499",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-02d2-7413-beaa-f9dd7b9fc05d",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "499",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-499",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-038d-763d-8e1a-0ab92e44e30e",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "499",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-499",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0427-7743-9891-4d91fb30cc04",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "500",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-500",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-04bf-744e-a651-3e021e31b49f",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0570-7120-beb3-c91405ff0203",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0627-7012-b96a-107ca34f44e8",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "502",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-502",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-06c1-76c5-9c92-9ef018ce04be",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-076f-755c-adad-cd66ec5002a9",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0837-71f5-bcaa-6dfbbc1d7f67",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "503",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-503",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-08e1-730a-a47a-c6a5546b2fa7",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-097a-7009-bd35-dbc3d2a6d799",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "0",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0a3c-747c-b547-25819b9477dc",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "504",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-504",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "2",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0af3-72ce-847a-a36af7c48ecb",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0b9e-7658-bc51-222e69e8dac8",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0c58-7261-8134-67e742a92855",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "505",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-505",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0d03-73e2-86bb-a557a7d1c920",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0d9f-7382-9573-d2b3bcdf4e8b",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "2",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0e5a-7366-a1cb-abdcf7ec7b94",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "520",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-520",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0f04-74dd-abd3-cf30aaa967ef",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-0fae-7799-b703-8e78204b3e0f",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-1069-73b5-9c5a-2ff0c336b206",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "599",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-599",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-1113-710d-b885-d4ffe5f3b256",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-11c2-73da-bba8-44eb4b18324e",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-87bc-736c-a6cb-8c910ec5d8ed",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "None",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-timeout-40",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "30013",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-8fdc-726d-a272-140d2b48287b",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "503",
        "error": "upstream call failed: Connect: 由于目标计算机积极拒绝，无法连接。 (os error 10061)",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "code-200",
        "gen_ai_response_model": "None",
        "input_tokens": "None",
        "output_tokens": "None",
        "duration_ms": "2062",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-9089-749b-9448-a30179f82bde",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      },
      {
        "id": "01a1efc9-9134-7016-ae3b-7af980998194",
        "trace_id": "None",
        "span_id": "None",
        "http_status": "200",
        "error": "None",
        "gen_ai_operation_name": "chat",
        "gen_ai_provider_name": "openai",
        "gen_ai_request_model": "model-ok",
        "gen_ai_response_model": "model-ok",
        "input_tokens": "5",
        "output_tokens": "3",
        "duration_ms": "1",
        "agentgateway_user": "lab-client"
      }
    ],
    "attribute_samples": [
      "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:60958\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.",
      "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:60961\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http.",
      "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:60963\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/completions\",\"http."
    ]
  },
  "ag_log_tail": "2026-11-18T17:51:25.674818Z\tinfo\tagentgateway_app::commands::run\tversion: True\t\n2026-11-18T17:51:25.727786Z\tinfo\tconfig\tgenerated a session key and wrote it to config.session.key; we recommend setting SESSION_KEY instead\tpath=C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\n2026-11-18T17:51:25.728590Z\tinfo\ttelemetry::log_store::sqlite\tinitializing request log database schema\t\n2026-11-18T17:51:25.730325Z\tinfo\ttelemetry::log_store::sqlite\trequest log database schema is ready\telapsed=1.7531ms\n2026-11-18T17:51:25.732176Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3923 component=\"readiness\"\n2026-11-18T17:51:25.739692Z\tinfo\tstate_manager\tloaded config from File(\"C:\\\\Users\\\\microsoft\\\\worksapce\\\\webdev\\\\slipstream-agentgateway\\\\ops\\\\experiments\\\\ag-lab\\\\run-config.yaml\")\t\n2026-11-18T17:51:25.741566Z\tinfo\tstate_manager\tWatching config file: C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\run-config.yaml\t\n2026-11-18T17:51:25.742650Z\tinfo\tagent_core::readiness\tTask 'state manager' complete (68.1039ms), still awaiting 1 tasks\t\n2026-11-18T17:51:25.743269Z\tinfo\tapp\tserving UI at http://127.0.0.1:3921/ui\t\n2026-11-18T17:51:25.743283Z\tinfo\tagent_core::readiness\tTask 'agentgateway' complete (68.737ms), marking server ready\t\n2026-11-18T17:51:25.743292Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3921 component=\"admin\"\n2026-11-18T17:51:25.743390Z\tinfo\tmanagement::hyper_helpers\tlistener established\taddress=127.0.0.1:3922 component=\"stats\"\n2026-11-18T17:51:25.743393Z\tinfo\tproxy::gateway\tstarted bind\tbind=\"bind/3692\"\n2026-11-18T17:51:26.717920Z\twarn\tagent_llm\tfailed to parse response\tconnection.id=2 request.id=1 error=missing field `model` at line 1 column 78 body={\"error\": {\"message\": \"mock upstream 200\", \"type\": \"mock_error\", \"code\": 200}}\n2026-11-18T17:51:26.718147Z\terror\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60958 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=502 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-200 agw.ai.original_model=vm-e14-200 gen_ai.request.max_tokens=16 error=\"failed to process LLM response: failed to parse response: missing field `model` at line 1 column 78\" reason=UpstreamFailure duration=3ms\n2026-11-18T17:51:26.900891Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60961 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-200 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:27.071935Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60963 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-200 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:27.257013Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60966 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=400 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-400 agw.ai.original_model=vm-e14-400 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:27.429726Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60968 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=400 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-400 agw.ai.original_model=vm-e14-400 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:27.615996Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60970 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=400 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-400 agw.ai.original_model=vm-e14-400 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:27.787263Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60973 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 agw.ai.original_model=vm-e14-401 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:27.940763Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60975 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 agw.ai.original_model=vm-e14-401 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:28.112622Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60977 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=401 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-401 agw.ai.original_model=vm-e14-401 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:28.295707Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60981 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=403 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-403 agw.ai.original_model=vm-e14-403 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:28.449254Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60983 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=403 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-403 agw.ai.original_model=vm-e14-403 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:28.621712Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60985 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=403 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-403 agw.ai.original_model=vm-e14-403 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:28.807504Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60988 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=404 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-404 agw.ai.original_model=vm-e14-404 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:28.980603Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60990 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=404 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-404 agw.ai.original_model=vm-e14-404 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:29.134733Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60992 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=404 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-404 agw.ai.original_model=vm-e14-404 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:29.336592Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60995 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=408 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-408 agw.ai.original_model=vm-e14-408 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:29.505931Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60997 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=408 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-408 agw.ai.original_model=vm-e14-408 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:29.659408Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:60999 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=408 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-408 agw.ai.original_model=vm-e14-408 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:29.833414Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61002 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-429 agw.ai.original_model=vm-e14-429 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:30.004456Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61004 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-429 agw.ai.original_model=vm-e14-429 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:30.158125Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61006 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=429 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-429 agw.ai.original_model=vm-e14-429 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:30.359099Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61009 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=499 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-499 agw.ai.original_model=vm-e14-499 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:30.514172Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61011 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=499 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-499 agw.ai.original_model=vm-e14-499 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:30.701250Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61013 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=499 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-499 agw.ai.original_model=vm-e14-499 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:30.854977Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61016 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=500 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-500 agw.ai.original_model=vm-e14-500 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:31.007885Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61018 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-500 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:31.184658Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61020 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-500 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:31.367057Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61023 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=502 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-502 agw.ai.original_model=vm-e14-502 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:31.521066Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61025 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-502 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:31.695017Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61027 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-502 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:31.895632Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61030 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=503 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-503 agw.ai.original_model=vm-e14-503 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:32.065524Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61032 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-503 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:32.218899Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61034 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-503 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=0ms\n2026-11-18T17:51:32.412140Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61037 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=504 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-504 agw.ai.original_model=vm-e14-504 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-18T17:51:32.595886Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61039 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-504 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:32.766543Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61041 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-504 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:32.952415Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61044 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=505 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-505 agw.ai.original_model=vm-e14-505 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:33.123337Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61046 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-505 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:33.279619Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61049 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-505 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=2ms\n2026-11-18T17:51:33.466414Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61052 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=520 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-520 agw.ai.original_model=vm-e14-520 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:33.636607Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61054 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-520 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:33.806936Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61056 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-520 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:33.993219Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61059 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=599 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-599 agw.ai.original_model=vm-e14-599 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:34.163856Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61061 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-599 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:51:34.338344Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61063 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-599 gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:52:04.540592Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61066 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-timeout-40 agw.ai.original_model=vm-e14-timeout gen_ai.request.max_tokens=16 duration=30013ms\n2026-11-18T17:52:06.620748Z\terror\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8098 src.addr=127.0.0.1:61079 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=503 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=code-200 agw.ai.original_model=vm-e14-dead gen_ai.request.max_tokens=16 error=\"upstream call failed: Connect: 由于目标计算机积极拒绝，无法连接。 (os error 10061)\" reason=UpstreamFailure duration=2062ms\n2026-11-18T17:52:06.793242Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61082 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-dead gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms\n2026-11-18T17:52:06.964737Z\tinfo\trequest gateway=default/default listener=llm route=internal/llm:request endpoint=127.0.0.1:8099 src.addr=127.0.0.1:61085 http.method=POST http.host=127.0.0.1 http.path=/v1/chat/completions http.version=HTTP/1.1 http.status=200 protocol=llm gen_ai.operation.name=chat gen_ai.provider.name=openai gen_ai.request.model=model-ok gen_ai.response.model=model-ok agw.ai.original_model=vm-e14-dead gen_ai.usage.input_tokens=5 gen_ai.usage.output_tokens=3 gen_ai.request.max_tokens=16 duration=1ms",
  "binary": {
    "binary": "C:\\Users\\microsoft\\worksapce\\webdev\\slipstream-agentgateway\\ops\\experiments\\ag-lab\\bin-e14\\agentgateway.exe",
    "version": "v1.7.0 (upstream --version prints 'True')",
    "git_revision": "26f5aebe99a36a037fe54f8080a608aca5547e15",
    "sha256": "909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c",
    "source": "github releases v1.7.0 agentgateway-windows-amd64.exe"
  },
  "notes_post_run": [
    "AG binary: v1.7.0 re-downloaded from GitHub releases into ../bin-e14/ (legacy C:/Users/microsoft/agentgateway/ dir no longer exists); sha256 909b93dc8fb5486cc0418a818b4a28fa60046cbd619013e33d1e4b20b889ed3c, git_revision 26f5aebe99a36a037fe54f8080a608aca5547e15 (same build as E1-E13 runs).",
    "Mock design: each code has its own provider prefix /sc<code> and model 'code-<code>'; target B is m-ok (/ok prefix). counters after each trial = upstream hits of that single client request (mock /reset before each trial).",
    "matrix['200'] trial1 client=502 is a mock artifact AND a finding: the mock returned HTTP 200 with an error-shaped body ({'error':...}); AG parses upstream 200 bodies on the LLM path, log line: agent_llm failed to parse response: missing field `model` -> client 502 reason=UpstreamFailure. Trials 2-3 then went to m-ok (p1 evicted after UpstreamFailure).",
    "No trial ever shows 2 different upstream prefixes hit within ONE client request -> 0 in-request target switches across all 48 code trials; 5xx eviction affects only subsequent requests (trials 2-3), consistent with E1/E3.",
    "Stall (model code-timeout-40, upstream sleeps 40s): client (urllib timeout=30s) aborted; AG logged no upstream timeout within 30s; request_logs row has http_status=NULL, error=NULL, duration_ms=30013 - the request ended when the client disconnected.",
    "Connection refused (provider points at closed port 8098): trial1 client=503 body='connection refused', request_logs error='upstream call failed: Connect: ... (os error 10061)', duration 2062ms; trials 2-3 went to m-ok (evicted after one connect failure).",
    "request_logs: 49 client requests -> 49 rows (1:1). trace_id/span_id are NULL on every row (not populated without tracing config). error column is filled only for AG-generated failures (502 parse failure, 503 connect failure); pass-through upstream 4xx/5xx rows have error=NULL. Plain-HTTP (non-LLM) requests are not written to request_logs at all (see E14a-route-retry-layer.json.md)."
  ]
}