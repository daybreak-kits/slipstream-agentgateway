/**
 * SSE 解析（W5 票05）：控制面透传的上游 chat.completion.chunk → 对话事件。
 *
 * 传输层只给文本分片（真实 HTTP 与离线 mock 同一形状）；本文件负责把
 * "data:" 帧解成结构化事件，流结束/错误/usage/思考都在这里定型，页面与
 * mock 都不再各自解析。
 */

import { deltaReasoning, deltaText } from "./thinking";
import { normalizeUsage } from "./usage";
import type { ChatMessagePayload, ChatUsage, ThinkingCarrier } from "./types";

/** 一帧 SSE 能产出的全部事件；sendTurn 按事件累积，mock 也按同一事件集断言。 */
export type ChatEvent =
  | { type: "request-id"; requestId: string }
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string; carrier: ThinkingCarrier }
  | { type: "usage"; usage: ChatUsage }
  | { type: "finish"; finishReason: string }
  | { type: "done" }
  | { type: "error"; message: string; code: string; requestId: string };

/** 一帧 data 的 payload → 事件列表；坏 JSON 静默忽略（与旧实现一致）。 */
export function interpretSseData(data: string): ChatEvent[] {
  if (data === "[DONE]") return [{ type: "done" }];
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return [];
  }
  const upstreamError = payload.error;
  if (typeof upstreamError === "object" && upstreamError !== null) {
    const detail = upstreamError as { message?: unknown; code?: unknown; request_id?: unknown };
    return [
      {
        type: "error",
        message: typeof detail.message === "string" ? detail.message : "上游返回错误",
        code: typeof detail.code === "string" ? detail.code : "UPSTREAM_ERROR",
        requestId: typeof detail.request_id === "string" ? detail.request_id : "",
      },
    ];
  }
  const events: ChatEvent[] = [];
  if (typeof payload.id === "string" && payload.id) {
    events.push({ type: "request-id", requestId: payload.id });
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = (choices[0] ?? {}) as Record<string, unknown>;
  const delta = (
    typeof choice.delta === "object" && choice.delta !== null ? choice.delta : {}
  ) as ChatMessagePayload;
  const content = deltaText(delta.content);
  if (content) events.push({ type: "content", delta: content });
  const reasoning = deltaReasoning(delta);
  if (reasoning.text && reasoning.carrier) {
    events.push({ type: "reasoning", delta: reasoning.text, carrier: reasoning.carrier });
  }
  const finish = choice.finish_reason;
  if (typeof finish === "string") events.push({ type: "finish", finishReason: finish });
  const usage = normalizeUsage(payload.usage);
  if (usage) events.push({ type: "usage", usage });
  return events;
}

/** 从 SSE 文本分片迭代器解析出事件；跨分片的半帧先缓冲，[DONE] 原样作为 done。 */
export async function* parseSseEvents(chunks: AsyncIterable<string>): AsyncGenerator<ChatEvent> {
  let buffer = "";
  const consume = (raw: string): ChatEvent[] => {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return data ? interpretSseData(data) : [];
  };
  for await (const chunk of chunks) {
    buffer = (buffer + chunk).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const event of consume(raw)) yield event;
      boundary = buffer.indexOf("\n\n");
    }
  }
  const tail = consume(buffer);
  for (const event of tail) yield event;
}
