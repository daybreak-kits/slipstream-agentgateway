import { describe, expect, it } from "vitest";

import { parseSseEvents, interpretSseData, type ChatEvent } from "./sse";
import {
  deltaReasoning,
  deltaText,
  describeThinking,
  extractThinkingFromMessage,
  splitContentParts,
  splitInlineThinking,
} from "./thinking";
import { buildUsage, estimateTokens, normalizeUsage } from "./usage";

function frame(payload: unknown): string {
  return "data: " + JSON.stringify(payload) + "\n\n";
}

async function collect(chunks: string[]): Promise<ChatEvent[]> {
  async function* source() {
    for (const chunk of chunks) yield chunk;
  }
  const events: ChatEvent[] = [];
  for await (const event of parseSseEvents(source())) events.push(event);
  return events;
}

describe("SSE 解析：事件集覆盖 content/reasoning/usage/finish/done/error", () => {
  it("完整帧序列 → 事件序列（request-id/content/usage/finish/done）", async () => {
    const events = await collect([
      frame({ id: "req_1", choices: [{ index: 0, delta: { content: "你" } }] }),
      frame({ id: "req_1", choices: [{ index: 0, delta: { content: "好" } }] }),
      frame({
        id: "req_1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
      "data: [DONE]\n\n",
    ]);
    expect(events).toEqual([
      { type: "request-id", requestId: "req_1" },
      { type: "content", delta: "你" },
      { type: "request-id", requestId: "req_1" },
      { type: "content", delta: "好" },
      { type: "request-id", requestId: "req_1" },
      { type: "finish", finishReason: "stop" },
      { type: "usage", usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
      { type: "done" },
    ]);
  });

  it("思考载体：reasoning_content → reasoning 事件；正文与思考同帧并存", async () => {
    const events = await collect([
      frame({
        id: "req_2",
        choices: [{ delta: { reasoning_content: "先想", content: "答" } }],
      }),
    ]);
    expect(events).toEqual([
      { type: "request-id", requestId: "req_2" },
      { type: "content", delta: "答" },
      { type: "reasoning", delta: "先想", carrier: "reasoning_content" },
    ]);
  });

  it("跨分片的半帧与 CRLF、多行 data 都按 SSE 规范拼回", async () => {
    const first = 'data: {"id":"req_3","choices":[{"delta":{"content":"跨"';
    const second = '}}]}\n\ndata: [DONE]\n\n';
    const events = await collect([first, second]);
    expect(events).toEqual([
      { type: "request-id", requestId: "req_3" },
      { type: "content", delta: "跨" },
      { type: "done" },
    ]);
    const crlf = await collect([
      'data: {"id":"r","choices":[{"delta":{"content":"x"}}]}\r\n\r\n',
      "data: [DONE]\r\n\r\n",
    ]);
    expect(crlf.map((event) => event.type)).toEqual(["request-id", "content", "done"]);
  });

  it("坏 JSON 静默忽略；上游 error 帧转成 error 事件", async () => {
    expect(await collect(["data: {oops}\n\n"])).toEqual([]);
    expect(
      interpretSseData(
        JSON.stringify({ error: { message: "上游炸了", code: "UPSTREAM_500", request_id: "r9" } }),
      ),
    ).toEqual([{ type: "error", message: "上游炸了", code: "UPSTREAM_500", requestId: "r9" }]);
  });
});

describe("thinking：内联标签、载体优先级与标记", () => {
  it("内联 <think> / 全角标签：流式未闭合时内容算思考，半截标签先扣住", () => {
    expect(splitInlineThinking("a<think>b</think>c")).toEqual({
      visible: "ac",
      thinking: "b",
      hasTag: true,
    });
    expect(splitInlineThinking("前＜think＞中")).toEqual({
      visible: "前",
      thinking: "中",
      hasTag: true,
    });
    expect(splitInlineThinking("可见<thi", false)).toEqual({
      visible: "可见",
      thinking: "",
      hasTag: false,
    });
    expect(splitInlineThinking("可见<thi", true).visible).toBe("可见<thi");
  });

  it("content parts 数组：thinking/reasoning part 单收", () => {
    expect(
      splitContentParts([
        { type: "text", text: "正文" },
        { type: "thinking", thinking: "思考" },
        { type: "reasoning", text: "推理" },
        { type: "text", text: "结尾" },
      ]),
    ).toEqual({ text: "正文结尾", thinking: "思考推理" });
    expect(splitContentParts("纯文本")).toEqual({ text: "纯文本", thinking: "" });
    expect(deltaText([{ text: "a" }, { text: "b" }])).toBe("ab");
  });

  it("完整消息归一化优先级：reasoning_content > reasoning > thinking > parts > 标签", () => {
    expect(
      extractThinkingFromMessage({
        reasoning_content: "A",
        reasoning: "B",
        thinking: "C",
        content: "正文",
      }),
    ).toEqual({ content: "正文", reasoning: "A", carrier: "reasoning_content" });
    expect(
      extractThinkingFromMessage({ reasoning: "B", content: [{ type: "thinking", text: "parts" }] }),
    ).toEqual({ content: "", reasoning: "B", carrier: "reasoning" });
    expect(extractThinkingFromMessage({ content: [{ type: "thinking", text: "P" }] })).toEqual({
      content: "",
      reasoning: "P",
      carrier: "parts",
    });
    expect(extractThinkingFromMessage({ content: "<think>标签</think>正文" })).toEqual({
      content: "正文",
      reasoning: "标签",
      carrier: "inline_tag",
    });
    expect(extractThinkingFromMessage({ content: "正文" })).toEqual({
      content: "正文",
      reasoning: "",
      carrier: "none",
    });
  });

  it("delta 思考字段按顺序拼接并记录首个载体", () => {
    expect(deltaReasoning({ reasoning_content: "A", reasoning: "B" })).toEqual({
      text: "AB",
      carrier: "reasoning_content",
    });
    expect(deltaReasoning({ thinking: "C" })).toEqual({ text: "C", carrier: "thinking" });
    expect(deltaReasoning({ content: "正文" })).toEqual({ text: "", carrier: null });
  });

  it("思考标记：内联标签优先、按请求参数/实际思考兜底", () => {
    expect(describeThinking({ reasoning_effort: "high" }, "r", "inline_tag")?.label).toBe("think 标签");
    expect(describeThinking({ reasoning_effort: "high" }, "r", "reasoning_content")?.label).toBe(
      "reasoning_effort=high",
    );
    expect(describeThinking({}, "r", "reasoning")).toEqual({ label: "think", source: "think" });
    expect(describeThinking({}, "  ", "none")).toBeNull();
  });
});

describe("usage 归一化", () => {
  it("有 prompt/completion 时补齐 total；只有 total 时不冒充 usage", () => {
    expect(normalizeUsage({ prompt_tokens: 3, completion_tokens: 2 })).toEqual({
      prompt_tokens: 3,
      completion_tokens: 2,
      total_tokens: 5,
    });
    expect(normalizeUsage({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 9 })).toEqual({
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 9,
    });
    expect(normalizeUsage({ total_tokens: 9 })).toBeNull();
    expect(normalizeUsage(null)).toBeNull();
    expect(normalizeUsage("x")).toBeNull();
  });

  it("估算与展示用量：estimated 标记、total 由分项求和", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    const usage = buildUsage({ promptTokens: 3, completionTokens: 2, ttftMs: 12, elapsedMs: 100, estimated: true });
    expect(usage).toMatchObject({
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
      ttftMs: 12,
      elapsedMs: 100,
      throughput: null,
      costUsd: null,
      estimated: true,
    });
  });
});
