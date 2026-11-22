/**
 * 离线演示用的 mock 流（W5 票05）：按真实后端的 SSE 线上形状产帧。
 *
 * 不直接产出「事件」：mock 与真实 HTTP 都只给文本分片，交给 sse.ts 的同一套
 * 解析器，离线演示与真实后端的事件形状因此不会分叉（票05 验收）。
 */

import type { ChatMessage } from "./types";

/** mock 演示用的模型清单：只在 VITE_MOCK=1 时出现，不冒充真实目录。 */
export const MOCK_PLAYGROUND_MODELS = [
  { name: "demo-fast", targetCount: 1, routingMode: "failover" },
  { name: "demo-balanced", targetCount: 2, routingMode: "weighted" },
  { name: "demo-reasoning", targetCount: 1, routingMode: "conditional" },
] as const;

export interface MockChatInput {
  model: string;
  messages: readonly ChatMessage[];
  /** 请求里的 reasoning_effort；default/缺省时模拟「无思考」。 */
  reasoningEffort?: string | null;
  /** 仅测试：在 [DONE] 前注入一个上游 error 帧，覆盖错误事件形状。 */
  fail?: boolean;
  /** 仅测试：去掉演示延迟，让单测秒级跑完。 */
  instant?: boolean;
}

function lastUserText(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && message.role === "user") return message.content;
  }
  return "";
}

function mockReplyText(question: string): string {
  const text = question.trim().slice(0, 60) || "（空消息）";
  return (
    "已收到你的消息：「" +
    text +
    "」。当前管理台运行在 Mock 模式，这条回复由前端模拟生成，" +
    "用于验证会话渲染、参数摘要与用量统计，不代表真实模型输出。可在右侧调整温度、输出上限或思考开关后再次发送。"
  );
}

function tokensFor(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function sseFrame(payload: unknown): string {
  return "data: " + JSON.stringify(payload) + "\n\n";
}

function abortError(): DOMException {
  return new DOMException("已停止生成", "AbortError");
}

/** 与真实后端一致的 SSE 数据帧序列（含思考、正文、usage、finish、[DONE]）。 */
export async function* mockChatSseFrames(
  input: MockChatInput,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const signal = options.signal;
  const wait = (ms: number) =>
    input.instant || ms <= 0
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          }, ms);
          const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
          };
          signal?.addEventListener("abort", onAbort, { once: true });
        });

  const requestId = "req-mock-" + Date.now().toString(36);
  const thinkEnabled =
    input.reasoningEffort != null && input.reasoningEffort !== "none";

  if (thinkEnabled) {
    const steps = [
      "先拆解问题，确认用户真正想要的信息。",
      "检查可用上下文，排除无关细节。",
      "组织回答：结论先行，再补充说明。",
    ];
    for (const step of steps) {
      await wait(160);
      yield sseFrame({
        id: requestId,
        choices: [{ index: 0, delta: { reasoning_content: step } }],
      });
    }
  }

  if (input.fail) {
    yield sseFrame({
      error: { message: "模拟上游错误", code: "MOCK_UPSTREAM_ERROR", request_id: requestId },
    });
    return;
  }

  const question = lastUserText(input.messages);
  const reply = mockReplyText(question);
  for (let i = 0; i < reply.length; i += 12) {
    await wait(45);
    yield sseFrame({
      id: requestId,
      choices: [{ index: 0, delta: { content: reply.slice(i, i + 12) } }],
    });
  }

  const promptTokens = tokensFor(question);
  const completionTokens = Math.max(1, Math.round(reply.length / 4));
  yield sseFrame({
    id: requestId,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  });
  yield "data: [DONE]\n\n";
}
