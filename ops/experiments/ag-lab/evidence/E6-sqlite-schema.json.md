{
  "tables": [
    "_agentgateway_request_log_migrations",
    "budget_usage",
    "request_log_payloads",
    "request_logs"
  ],
  "schema": {
    "_agentgateway_request_log_migrations": [
      {
        "cid": 0,
        "name": "version",
        "type": "BIGINT",
        "notnull": 0,
        "pk": 1
      },
      {
        "cid": 1,
        "name": "description",
        "type": "TEXT",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 2,
        "name": "installed_on",
        "type": "TIMESTAMP",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 3,
        "name": "success",
        "type": "BOOLEAN",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 4,
        "name": "checksum",
        "type": "BLOB",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 5,
        "name": "execution_time",
        "type": "BIGINT",
        "notnull": 1,
        "pk": 0
      }
    ],
    "budget_usage": [
      {
        "cid": 0,
        "name": "budget_id",
        "type": "TEXT",
        "notnull": 0,
        "pk": 1
      },
      {
        "cid": 1,
        "name": "window_start",
        "type": "INTEGER",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 2,
        "name": "window_end",
        "type": "INTEGER",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 3,
        "name": "unit",
        "type": "TEXT",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 4,
        "name": "used_amount",
        "type": "INTEGER",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 5,
        "name": "updated_at",
        "type": "INTEGER",
        "notnull": 1,
        "pk": 0
      }
    ],
    "request_log_payloads": [
      {
        "cid": 0,
        "name": "log_id",
        "type": "TEXT",
        "notnull": 0,
        "pk": 1
      },
      {
        "cid": 1,
        "name": "request_prompt_json",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 2,
        "name": "response_completion_json",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      }
    ],
    "request_logs": [
      {
        "cid": 0,
        "name": "id",
        "type": "TEXT",
        "notnull": 0,
        "pk": 1
      },
      {
        "cid": 1,
        "name": "started_at",
        "type": "TEXT",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 2,
        "name": "completed_at",
        "type": "TEXT",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 3,
        "name": "duration_ms",
        "type": "INTEGER",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 4,
        "name": "trace_id",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 5,
        "name": "span_id",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 6,
        "name": "http_status",
        "type": "INTEGER",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 7,
        "name": "error",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 8,
        "name": "gen_ai_operation_name",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 9,
        "name": "gen_ai_provider_name",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 10,
        "name": "gen_ai_request_model",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 11,
        "name": "gen_ai_response_model",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 12,
        "name": "input_tokens",
        "type": "INTEGER",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 13,
        "name": "output_tokens",
        "type": "INTEGER",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 14,
        "name": "total_tokens",
        "type": "INTEGER",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 15,
        "name": "cost",
        "type": "REAL",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 16,
        "name": "agentgateway_user",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 17,
        "name": "agentgateway_group",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 18,
        "name": "user_agent_name",
        "type": "TEXT",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 19,
        "name": "has_payload",
        "type": "INTEGER",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 20,
        "name": "attributes_json",
        "type": "TEXT",
        "notnull": 1,
        "pk": 0
      },
      {
        "cid": 21,
        "name": "cache_read_input_tokens",
        "type": "INTEGER",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 22,
        "name": "cache_creation_input_tokens",
        "type": "INTEGER",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 23,
        "name": "reasoning_tokens",
        "type": "INTEGER",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 24,
        "name": "time_to_first_token_ms",
        "type": "REAL",
        "notnull": 0,
        "pk": 0
      },
      {
        "cid": 25,
        "name": "time_per_output_token_ms",
        "type": "REAL",
        "notnull": 0,
        "pk": 0
      }
    ]
  },
  "samples": {
    "_agentgateway_request_log_migrations": {
      "columns": [
        "version",
        "description",
        "installed_on",
        "success",
        "checksum",
        "execution_time"
      ],
      "rows": [
        [
          "1",
          "create request log schema",
          "2026-11-16 18:14:06",
          "1",
          "b\"\\xc22]G\\xe7he\\xde\\x835\\x8b\\x1f{9\\x90\\xe3\\xa9u\\x1b\\xb1J#\\xf8\\x8aw\\xee\\xee\\xf6\\xd7\\x99y3\\xb0\\x0e@\\xc2\\x14\\x07'n@\\xf00\\x95/\\x89\\xda3\"",
          "17721500"
        ],
        [
          "2",
          "add request log analytics columns",
          "2026-11-16 18:14:06",
          "1",
          "b'\\xb2\\xed\\xce\\x89\\xe3$c\\x9d\\xc9_\\xbb\\x95\\xb3\\x188a\\xde0\\xf2hn\\xaf\\xba\\xf0\\xa4\\xbf\\x9d\\xc9\\xe7\\x05\\xf3kx\\xfaC\\x18\\x8e\\xb7J\\x99\\xef\\x06\\xec<\\x04\\xa4\\xe9D'",
          "13631100"
        ]
      ]
    },
    "budget_usage": {
      "columns": [],
      "rows": []
    },
    "request_log_payloads": {
      "columns": [
        "log_id",
        "request_prompt_json",
        "response_completion_json"
      ],
      "rows": [
        [
          "01a1e591-0005-74b2-b627-548c78cc2824",
          "[{\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"hello\"}]}]",
          "[{\"role\":\"assistant\",\"parts\":[{\"type\":\"text\",\"text\":\"ok\"}]}]"
        ],
        [
          "01a1e591-000c-7511-ab70-3bbc100d3933",
          "[{\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"hello\"}]}]",
          "[{\"role\":\"assistant\",\"parts\":[{\"type\":\"text\",\"text\":\"ok\"}]}]"
        ]
      ]
    },
    "request_logs": {
      "columns": [
        "id",
        "started_at",
        "completed_at",
        "duration_ms",
        "trace_id",
        "span_id",
        "http_status",
        "error",
        "gen_ai_operation_name",
        "gen_ai_provider_name",
        "gen_ai_request_model",
        "gen_ai_response_model",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "cost",
        "agentgateway_user",
        "agentgateway_group",
        "user_agent_name",
        "has_payload",
        "attributes_json",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
        "reasoning_tokens",
        "time_to_first_token_ms",
        "time_per_output_token_ms"
      ],
      "rows": [
        [
          "01a1e591-0005-74b2-b627-548c78cc2824",
          "2026-11-16T18:14:07.603795+00:00",
          "2026-11-16T18:14:07.620995+00:00",
          "17",
          "None",
          "None",
          "200",
          "None",
          "chat",
          "openai",
          "model-t2",
          "model-t2",
          "5",
          "3",
          "8",
          "None",
          "lab-client",
          "None",
          "Python-urllib",
          "1",
          "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:8679\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/",
          "None",
          "None",
          "None",
          "None",
          "None"
        ],
        [
          "01a1e591-000c-7511-ab70-3bbc100d3933",
          "2026-11-16T18:14:07.624577+00:00",
          "2026-11-16T18:14:07.628087+00:00",
          "3",
          "None",
          "None",
          "200",
          "None",
          "chat",
          "openai",
          "model-t2",
          "model-t2",
          "5",
          "3",
          "8",
          "None",
          "lab-client",
          "None",
          "Python-urllib",
          "1",
          "{\"gateway\":\"default/default\",\"listener\":\"llm\",\"route\":\"internal/llm:request\",\"endpoint\":\"127.0.0.1:8099\",\"src.addr\":\"127.0.0.1:8681\",\"http.method\":\"POST\",\"http.host\":\"127.0.0.1\",\"http.path\":\"/v1/chat/",
          "None",
          "None",
          "None",
          "None",
          "None"
        ]
      ]
    }
  }
}
