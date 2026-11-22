import { describe, expect, it } from "vitest";

import { sendTurn, type ChatStreamTransport, type ChatTurnRequest } from "./send-turn";
import type { PlaygroundChatRequest } from "@/lib/control-plane/operations/playground";

function frame(payload: unknown): string {
  return "data: " + JSON.stringify(payload) + "\n\n";
}

interface Captured {
  request: PlaygroundChatRequest;
  options: { signal?: AbortSignal; apiKey?: string; timeoutMs?: number } | undefined;
}

/** 假 transport：把预设 SSE 文本分片按块交给解析器，并记录实际请求体。 */
function fakeTransport(frames: string[], captured: Captured[]): ChatStreamTransport {
  return async (request, options) => {
    captured.push({ request, options });
    async function* source() {
      for (const chunk of frames) yield chunk;
    }
    return source();
  };
}

const DONE_FRAMES = [
  frame({ id: "req_1", choices: [{ delta: { reasoning_content: "先想" } }] }),
  frame({ id: "req_1", choices: [{ delta: { content: "你" } }] }),
  frame({ id: "req_1", choices: [{ delta: { content: "好" } }] }),
  frame({
    id: "req_1",
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  }),
  "data: [DONE]\n\n",
];

function baseRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    model: "flagship",
    messages: [
      { role: "user", content: "你好" },
      { role: "assistant", content: "" },
    ],
    systemPrompt: "你是助手",
    params: { temperature: "0.7", thinkingMode: "high", stop: "END,DONE" },
    maxOutputTokens: 128000,
    apiKey: "sk-browser",
    stream: true,
    ...overrides,
  };
}

describe("sendTurn：唯一发送命令（transport 可注入）", () => {
  it("done：累积正文/思考、TTFT、结束原因与上游 usage，并记录请求体", async () => {
    const captured: Captured[] = [];
    const deltas: string[] = [];
    const reasonings: string[] = [];
    const outcome = await sendTurn(
      baseRequest({
        onDelta: (text) => deltas.push(text),
        onReasoning: (text) => reasonings.push(text),
      }),
      fakeTransport(DONE_FRAMES, captured),
    );

    expect(outcome.status).toBe("done");
    expect(outcome.content).toBe("你好");
    expect(outcome.reasoning).toBe("先想");
    expect(outcome.thinkingLabel).toBe("reasoning_effort=high");
    expect(outcome.requestId).toBe("req_1");
    expect(outcome.ttftMs).not.toBeNull();
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(outcome.finishReason).toBe("stop");
    expect(outcome.sawDone).toBe(true);
    expect(outcome.error).toBeNull();
    expect(outcome.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      estimated: false,
    });
    expect(outcome.usage?.throughput).not.toBeNull();
    expect(deltas).toEqual(["你", "你好"]);
    expect(reasonings).toEqual(["先想"]);

    const capturedRequest = captured[0];
    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.request).toEqual({
      model: "flagship",
      messages: [
        { role: "system", content: "你是助手" },
        { role: "user", content: "你好" },
      ],
      stream: true,
      temperature: 0.7,
      stop: ["END", "DONE"],
      reasoning_effort: "high",
    });
    expect(capturedRequest?.options?.apiKey).toBe("sk-browser");
    expect(capturedRequest?.options?.timeoutMs).toBe(0);
  });

  it("上游没回 usage 时按字符估算并标记 estimated", async () => {
    const frames = [
      frame({ id: "req_2", choices: [{ delta: { content: "abcd" } }] }),
      "data: [DONE]\n\n",
    ];
    const outcome = await sendTurn(baseRequest({ messages: [{ role: "user", content: "hi" }] }), fakeTransport(frames, []));
    expect(outcome.status).toBe("done");
    expect(outcome.usage?.estimated).toBe(true);
    expect(outcome.usage?.promptTokens).toBeGreaterThan(0);
    expect(outcome.usage?.completionTokens).toBe(1);
    expect(outcome.usage?.totalTokens).toBe(
      (outcome.usage?.promptTokens ?? 0) + (outcome.usage?.completionTokens ?? 0),
    );
  });

  it("上游 error 帧：status=error，错误文案带 code 与请求编号", async () => {
    const frames = [
      frame({ id: "req_3", choices: [{ delta: { content: "半" } }] }),
      frame({ error: { message: "上游炸了", code: "UPSTREAM_500", request_id: "r9" } }),
    ];
    const outcome = await sendTurn(baseRequest(), fakeTransport(frames, []));
    expect(outcome.status).toBe("error");
    expect(outcome.content).toBe("半");
    expect(outcome.usage).toBeNull();
    expect(outcome.error).toBe("上游炸了 · (UPSTREAM_500) · 请求编号 r9");
  });

  it("取消：保留已收到的正文/思考，status=aborted，不弹错误", async () => {
    const controller = new AbortController();
    const transport: ChatStreamTransport = async () => {
      async function* source() {
        yield frame({ id: "req_4", choices: [{ delta: { reasoning_content: "想" } }] });
        yield frame({ id: "req_4", choices: [{ delta: { content: "部分" } }] });
        controller.abort();
        throw new DOMException("已停止生成", "AbortError");
      }
      return source();
    };
    const outcome = await sendTurn(baseRequest({ signal: controller.signal }), transport);
    expect(outcome.status).toBe("aborted");
    expect(outcome.content).toBe("部分");
    expect(outcome.reasoning).toBe("想");
    expect(outcome.error).toBeNull();
    expect(outcome.usage).toBeNull();
  });

  it("非流式渲染仍走同一条 SSE 路径（stream=false 原样带给控制面）", async () => {
    const captured: Captured[] = [];
    const outcome = await sendTurn(baseRequest({ stream: false }), fakeTransport(DONE_FRAMES, captured));
    expect(outcome.status).toBe("done");
    expect(captured[0]?.request.stream).toBe(false);
  });

  it("内联思考标签：正文剥离标签、思考进入 reasoning 并标记 think 标签", async () => {
    const frames = [
      frame({ id: "req_5", choices: [{ delta: { content: "<thi" } }] }),
      frame({ id: "req_5", choices: [{ delta: { content: "nk>秘密</think>正文" } }] }),
      "data: [DONE]\n\n",
    ];
    const seen: string[] = [];
    const outcome = await sendTurn(
      baseRequest({ params: {}, onDelta: (text) => seen.push(text) }),
      fakeTransport(frames, []),
    );
    expect(outcome.content).toBe("正文");
    expect(outcome.reasoning).toBe("秘密");
    expect(outcome.thinkingLabel).toBe("think 标签");
    expect(seen[seen.length - 1]).toBe("正文");
  });
});
