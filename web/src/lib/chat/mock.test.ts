import { describe, expect, it } from "vitest";

import { mockChatSseFrames } from "./mock";
import { parseSseEvents, type ChatEvent } from "./sse";

async function collect(frames: AsyncIterable<string>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of parseSseEvents(frames)) events.push(event);
  return events;
}

/** 真实后端会透传的同类帧（与 _StubSSEHandler / 上游 chunk 同形状）。 */
const REAL_FRAMES = [
  'data: {"id":"req_real","choices":[{"index":0,"delta":{"content":"你好"}}]}\n\n',
  'data: {"id":"req_real","choices":[{"index":0,"delta":{"content":"！"}}]}\n\n',
  'data: {"id":"req_real","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}\n\n',
  "data: [DONE]\n\n",
];

async function collectReal(): Promise<ChatEvent[]> {
  async function* source() {
    for (const frame of REAL_FRAMES) yield frame;
  }
  return collect(source());
}

const MESSAGES = [{ role: "user", content: "介绍一下网关" }];

describe("离线 mock 与真实后端的事件形状一致（同一套解析器）", () => {
  it("mock 帧解析出的非增量事件序列与真实帧一致", async () => {
    const real = await collectReal();
    const mock = await collect(
      mockChatSseFrames({ model: "demo-fast", messages: MESSAGES }, {}),
    );
    const shape = (events: ChatEvent[]) => {
      const types: string[] = [];
      for (const event of events) {
        if (event.type === "content") continue;
        if (types[types.length - 1] !== event.type) types.push(event.type);
      }
      return types;
    };
    expect(shape(mock)).toEqual(shape(real));
    expect(shape(mock)).toEqual(["request-id", "finish", "usage", "done"]);
    expect(mock.some((event) => event.type === "content")).toBe(true);
    expect(real[0]?.type).toBe("request-id");
    expect(mock[0]?.type).toBe("request-id");
    expect(mock[mock.length - 1]?.type).toBe("done");
  });

  it("思考档位：非 none/default 时 mock 发 reasoning_content 帧，与真实后端载体一致", async () => {
    const lit = await collect(
      mockChatSseFrames({ model: "demo-reasoning", messages: MESSAGES, reasoningEffort: "low" }, {}),
    );
    const reasonings = lit.filter((event) => event.type === "reasoning");
    expect(reasonings.length).toBeGreaterThan(0);
    for (const event of reasonings) {
      if (event.type === "reasoning") expect(event.carrier).toBe("reasoning_content");
    }
    const plain = await collect(
      mockChatSseFrames({ model: "demo-reasoning", messages: MESSAGES, reasoningEffort: "none" }, {}),
    );
    expect(plain.some((event) => event.type === "reasoning")).toBe(false);
  });

  it("错误事件：mock 的失败分支产出与真实上游 error 帧同一形状", async () => {
    const events = await collect(
      mockChatSseFrames({ model: "demo-fast", messages: MESSAGES, fail: true }, {}),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", message: "模拟上游错误", code: "MOCK_UPSTREAM_ERROR" });
  });
});
