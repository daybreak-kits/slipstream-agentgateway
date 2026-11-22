import { describe, expect, it } from "vitest";

import { chatParams } from "./index";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  REASONING_LEVELS,
  REASONING_LEVEL_LABELS,
  isChatModel,
  maxOutputTokensFor,
  normalizeDeclaredDefault,
  paramHintText,
  parseStopSequences,
  reasoningLevelOptions,
  summarizeChatParams,
  toRequestParams,
  validateChatParams,
  type ChatParamInput,
} from "./params";

/** 参数全填的输入：用于验证「一张表」同时驱动校验、转发与摘要。 */
const FULL_INPUT: ChatParamInput = {
  temperature: "0.7",
  topP: "0.9",
  topK: "40",
  frequencyPenalty: "-0.5",
  presencePenalty: "0.5",
  seed: "42",
  maxTokens: "1024",
  maxCompletionTokens: "2048",
  stop: "END, DONE",
  n: "2",
  responseFormat: "json_object",
  logprobs: true,
  topLogprobs: "5",
  user: " operator-7 ",
  thinkingMode: "high",
  extraFields: '{"vendor_x":"v"}',
};

describe("参数表：允许字段/default/校验/转发只有一个事实源", () => {
  it("全填时一次覆盖后端 PlaygroundRequest 的全部标准字段", () => {
    expect(toRequestParams(FULL_INPUT)).toEqual({
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      frequency_penalty: -0.5,
      presence_penalty: 0.5,
      seed: 42,
      max_tokens: 1024,
      max_completion_tokens: 2048,
      stop: ["END", "DONE"],
      n: 2,
      response_format: { type: "json_object" },
      logprobs: true,
      top_logprobs: 5,
      user: "operator-7",
      reasoning_effort: "high",
      extra_fields: { vendor_x: "v" },
    });
  });

  it("留空/default 一律不发送：参数表决定默认语义", () => {
    expect(toRequestParams({})).toEqual({});
    expect(
      toRequestParams({
        responseFormat: "text",
        logprobs: false,
        thinkingMode: "default",
        extraFields: "  ",
      }),
    ).toEqual({});
  });

  it("思考档位 default/none/low/medium/high/xhigh/max：default 不发，其余原样转发", () => {
    expect(REASONING_LEVELS).toEqual(["default", "none", "low", "medium", "high", "xhigh", "max"]);
    for (const level of REASONING_LEVELS) {
      const params = toRequestParams({ thinkingMode: level });
      if (level === "default") {
        expect(params.reasoning_effort).toBeUndefined();
      } else {
        expect(params.reasoning_effort).toBe(level);
      }
    }
    expect(REASONING_LEVEL_LABELS.default).toContain("不发送");
    for (const level of REASONING_LEVELS) {
      expect(REASONING_LEVEL_LABELS[level].length).toBeGreaterThan(0);
    }
  });

  it("stop：单行逗号分隔、最多 4 条；旧换行折算；空条目拦截", () => {
    expect(parseStopSequences("a, b , c")).toEqual(["a", "b", "c"]);
    expect(parseStopSequences("a\nb")).toEqual(["a", "b"]);
    expect(parseStopSequences("a,\nb,c")).toEqual(["a", "b", "c"]);
    expect(parseStopSequences("")).toEqual([]);
    expect(parseStopSequences(undefined)).toEqual([]);
    expect(parseStopSequences("a,,b")).toEqual(["a", "b"]);
    expect(toRequestParams({ stop: "a\nb" })).toEqual({ stop: ["a", "b"] });

    expect(validateChatParams({ stop: "a,b,c,d" }).valid).toBe(true);
    const over = validateChatParams({ stop: "a,b,c,d,e" });
    expect(over.valid).toBe(false);
    expect(over.message).toContain("4");
    const empty = validateChatParams({ stop: "a,,b" });
    expect(empty.valid).toBe(false);
    expect(empty.message).toContain("空");
    expect(validateChatParams({ stop: "a,b," }).valid).toBe(false);
  });

  it("数字参数区间与文案：成功放行、越界/非数字拦下", () => {
    const ok: ChatParamInput = {
      temperature: "2",
      topP: "0.001",
      topK: "0",
      frequencyPenalty: "-2",
      presencePenalty: "2",
      seed: "1",
      maxTokens: "1",
      maxCompletionTokens: "1",
      n: "128",
      topLogprobs: "0",
      logprobs: true,
      user: "u",
    };
    expect(validateChatParams(ok, { maxOutputTokens: 128000 }).valid).toBe(true);

    const cases: Array<[ChatParamInput, string]> = [
      [{ temperature: "2.1" }, "temperature"],
      [{ temperature: "abc" }, "temperature"],
      [{ topP: "0" }, "top_p"],
      [{ topP: "1.01" }, "top_p"],
      [{ topK: "-1" }, "top_k"],
      [{ topK: "1.5" }, "top_k"],
      [{ frequencyPenalty: "-2.1" }, "frequency_penalty"],
      [{ presencePenalty: "2.1" }, "presence_penalty"],
      [{ seed: "1.5" }, "seed"],
      [{ maxTokens: "0" }, "max_tokens"],
      [{ maxCompletionTokens: "999999" }, "max_completion_tokens"],
      [{ n: "0" }, "n"],
      [{ n: "129" }, "n"],
      [{ topLogprobs: "5" }, "top_logprobs"],
      [{ logprobs: true, topLogprobs: "21" }, "top_logprobs"],
      [{ user: "x".repeat(257) }, "user"],
    ];
    for (const [input, field] of cases) {
      const result = validateChatParams(input, { maxOutputTokens: 128000 });
      expect(result.valid, JSON.stringify(input)).toBe(false);
      expect(result.message ?? "").toContain(field);
    }
    expect(validateChatParams({ extraFields: "[1]" }).message).toContain("JSON 对象");
    expect(validateChatParams({ extraFields: "{" }).message).toContain("合法 JSON");
  });

  it("输出上限：登记值优先，未登记回退安全默认；校验与转发同一口径", () => {
    expect(maxOutputTokensFor(128000)).toBe(128000);
    expect(maxOutputTokensFor(0)).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(maxOutputTokensFor(null)).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(maxOutputTokensFor(undefined)).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(validateChatParams({ maxTokens: "128000" }, { maxOutputTokens: 128000 }).valid).toBe(true);
    const over = validateChatParams({ maxTokens: "128001" }, { maxOutputTokens: 128000 });
    expect(over.valid).toBe(false);
    expect(over.message).toContain("128000");
    expect(validateChatParams({ maxTokens: "32768" }, { maxOutputTokens: null }).valid).toBe(true);
    expect(validateChatParams({ maxTokens: "32769" }, { maxOutputTokens: null }).valid).toBe(false);
  });

  it("摘要只列会发送的字段；全默认时给「全部默认」", () => {
    expect(summarizeChatParams({})).toBe("全部默认");
    expect(
      summarizeChatParams({ temperature: "0.7", topP: "0.9", maxTokens: "1024", stop: "a,b", thinkingMode: "low" }),
    ).toBe("temperature 0.7 · top_p 0.9 · max_tokens 1024 · stop 2 条 · 思考 reasoning_effort=low");
    expect(summarizeChatParams({ extraFields: '{"a":1,"b":2}' })).toContain("额外字段 2 个");
  });

  it("思考档位选项按模型声明收敛；chat 判定与默认档归一", () => {
    expect(reasoningLevelOptions(["low", "default"])).toEqual(["low", "default"]);
    expect(reasoningLevelOptions([])).toHaveLength(7);
    expect(reasoningLevelOptions(undefined)).toHaveLength(7);
    expect(reasoningLevelOptions(["ultra"])).toHaveLength(7);
    expect(normalizeDeclaredDefault("high")).toBe("high");
    expect(normalizeDeclaredDefault("")).toBe("default");
    expect(normalizeDeclaredDefault("ultra")).toBe("default");
    expect(isChatModel({ model_type: "chat" })).toBe(true);
    expect(isChatModel({ model_type: "embedding" })).toBe(false);
    expect(isChatModel(null)).toBe(false);
  });

  it("chunkParams 分组暴露面板需要的全部命令（页面/面板只依赖它）", () => {
    expect(chatParams.validate({}).valid).toBe(true);
    expect(chatParams.summarize({})).toBe("全部默认");
    expect(chatParams.maxOutputTokens(0)).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(chatParams.defaultMaxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(chatParams.hint("temperature")).toContain("0.0 至 2.0");
    expect(paramHintText("stop", "最多 4 条")).toContain("最多 4 条");
    expect(chatParams.isChatModel({ model_type: "chat" })).toBe(true);
    expect(chatParams.thinkingOptions(undefined)).toHaveLength(7);
    expect(chatParams.thinkingLabel("xhigh")).toBe("xhigh");
    expect(chatParams.normalizeThinking("max")).toBe("max");
  });
});
