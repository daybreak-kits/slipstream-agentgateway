{
  "headers_only": {
    "response_status": 200,
    "response_headers": {
      "x-lab-resp": "resp-set"
    },
    "mock_entry": {
      "ts": 1794853156.517,
      "prefix": "/t1",
      "path": "/t1/v1/chat/completions",
      "model": "model-t1",
      "stream": false,
      "auth": "Bearer test-key",
      "headers": {
        "authorization": "Bearer test-key",
        "x-trace-in": "trace-123",
        "x-lab-added": "add-val",
        "x-lab-req": "set-by-ag",
        "x-slipstream-trace": "trace-123"
      },
      "messages": [
        {
          "role": "user",
          "content": "hello"
        }
      ],
      "max_tokens": 16,
      "count": 1
    }
  },
  "body_replace": {
    "response_status": 200,
    "response_body": "{\"rewritten_by\": \"ag\", \"model\": \"model-t1\"}",
    "mock_messages": [
      {
        "role": "user",
        "content": "rewritten-by-ag"
      }
    ],
    "mock_max_tokens": 7,
    "mock_model": "model-t1"
  },
  "model_level_request_transformation": {
    "response_status": 200,
    "response_body": "{\"model\":\"model-t1\",\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3,\"total_tokens\":8},\"choices\":[{\"message\":{\"content\":\"ok\",\"role\":\"assistant\"},\"index\":0,\"finish_reason\":\"stop\"}],\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\"}",
    "mock_headers": {
      "x-lab-req": "set-model-level",
      "authorization": "Bearer test-key",
      "x-lab-added": "add-model-level"
    },
    "mock_messages": [
      {
        "role": "user",
        "content": "model-level-rewrite"
      }
    ],
    "mock_max_tokens": 9
  }
}
