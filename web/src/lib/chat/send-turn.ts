/**
 * sendTurn：Playground 对话的唯一发送命令（W5 票05）。
 *
 * 负责：参数表 → 控制面请求体、通过 control-plane transport 取 SSE 文本流、
 * 事件解析与累积（正文/思考/usage/TTFT/结束原因）、取消与错误归一。
 * 页面只消费 ChatTurnOutcome，不再自己拼请求、解析流或拼错误文案。
 */

import { controlPlane } from "@/lib/control-plane";
import type { PlaygroundChatRequest } from "@/lib/control-plane/operations/playground";

import { chatMessages } from "./messages";
import { toRequestParams, type ChatParamInput } from "./params";
import { parseSseEvents } from "./sse";
import { describeThinking, splitInlineThinking } from "./thinking";
import { buildUsage, estimateTokens } from "./usage";
import type { ChatUsage, PlaygroundUsage, ThinkingCarrier } from "./types";

/** 取 SSE 文本分片的传输函数；默认走 control-plane，测试注入假实现。 */
export type ChatStreamTransport = (
  request: PlaygroundChatRequest,
  options?: { signal?: AbortSignal; apiKey?: string; timeoutMs?: number },
) => Promise<AsyncIterable<string>>;

const defaultTransport: ChatStreamTransport = (request, options) =>
  controlPlane.playground.streamChat(request, options);

export interface ChatTurnRequest {
  model: string;
  /** 会话消息（可含 system 消息；内部归一成上游 messages）。 */
  messages: readonly { role: string; content: string }[];
  /** 面板里的系统提示词；非空时置顶为 system 消息。 */
  systemPrompt?: string;
  /** 参数面板状态（PlaygroundParamsState 结构上兼容）。 */
  params: ChatParamInput;
  /** 所选模型登记的 max_output_tokens（校验口径由调用方负责）。 */
  maxOutputTokens?: number | null;
  /** 浏览器端调用密钥；只随 Authorization 头发送。 */
  apiKey?: string;
  /** false = 前端收完整段再一次性渲染（端点仍是 SSE）。 */
  stream?: boolean;
  signal?: AbortSignal;
  /** 累积可见正文（内联思考已剥离）。 */
  onDelta?: (text: string) => void;
  /** 累积思考内容。 */
  onReasoning?: (text: string) => void;
}

export type ChatTurnStatus = "done" | "aborted" | "error";

export interface ChatTurnOutcome {
  status: ChatTurnStatus;
  /** 已完成/已收到部分的可见正文（内联思考已剥离）。 */
  content: string;
  /** 已完成/已收到部分的思考内容。 */
  reasoning: string;
  /** 思考块标记；只有 done 且确实有思考时非空。 */
  thinkingLabel: string | null;
  model: string;
  requestId: string;
  /** 首字耗时（毫秒）；一条正文都没收到时为 null。 */
  ttftMs: number | null;
  elapsedMs: number;
  finishReason: string | null;
  /** 流是否正常收到 [DONE]。 */
  sawDone: boolean;
  /** done 时一定存在（上游 usage 或前端估算）；aborted/error 时为 null。 */
  usage: PlaygroundUsage | null;
  /** error 时给用户看的失败原因；其余为 null。 */
  error: string | null;
}

/** 上游 error 帧：保留 code/request_id，错误文案与旧实现一致。 */
class ChatUpstreamError extends Error {
  readonly code: string;
  readonly requestId: string;

  constructor(message: string, code: string, requestId: string) {
    super(message);
    this.name = "ChatUpstreamError";
    this.code = code;
    this.requestId = requestId;
  }
}

/** 失败原因：上游错误带 code/请求编号；其余按 Error.message 展示。 */
export function describeChatError(error: unknown): string {
  if (error instanceof ChatUpstreamError) {
    const parts = [error.message];
    if (error.code) parts.push("(" + error.code + ")");
    if (error.requestId) parts.push("请求编号 " + error.requestId);
    return parts.join(" · ");
  }
  if (error instanceof Error) return error.message;
  return "请求失败，请稍后重试";
}

function isAbortError(reason: unknown): boolean {
  if (reason instanceof DOMException) return reason.name === "AbortError";
  return (
    typeof reason === "object" &&
    reason !== null &&
    (reason as { name?: string }).name === "AbortError"
  );
}

function elapsedMs(started: number): number {
  return Math.round(performance.now() - started);
}

/** 展示用量：有上游 usage 用它，否则按字符估算（与旧页口径一致）。 */
function turnUsage(args: {
  usage: ChatUsage | null;
  promptEstimate: number;
  content: string;
  ttftMs: number | null;
  elapsedMs: number;
}): PlaygroundUsage {
  const { usage, promptEstimate, content, ttftMs, elapsedMs } = args;
  if (usage) {
    return buildUsage({
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
      ttftMs,
      elapsedMs,
      throughput:
        elapsedMs > 0 ? (usage.completion_tokens ?? 0) / (elapsedMs / 1000) : null,
      estimated: false,
    });
  }
  const completionTokens = estimateTokens(content);
  return buildUsage({
    promptTokens: promptEstimate,
    completionTokens,
    ttftMs,
    elapsedMs,
    throughput: elapsedMs > 0 ? completionTokens / (elapsedMs / 1000) : null,
    estimated: true,
  });
}

/**
 * 发送一轮对话并收集完整结果。
 *
 * 传输层（真实 / 离线 mock）只提供与后端同形状的 SSE 文本分片；这里用同一套
 * 解析器处理，所以 mock 与真实后端的事件集不会分叉。取消与上游错误不抛出，
 * 统一折叠进 outcome.status（页面只需一个分支）。
 */
export async function sendTurn(
  request: ChatTurnRequest,
  transport: ChatStreamTransport = defaultTransport,
): Promise<ChatTurnOutcome> {
  const started = performance.now();
  const model = request.model;
  const params = toRequestParams(request.params, {
    maxOutputTokens: request.maxOutputTokens,
  });
  const messages = chatMessages.toRequestMessages(
    request.messages,
    request.systemPrompt ?? "",
  );
  const body: PlaygroundChatRequest = {
    model,
    messages,
    stream: request.stream ?? true,
    ...params,
  };

  let rawContent = "";
  let rawReasoning = "";
  let carrier: ThinkingCarrier | null = null;
  let ttftMs: number | null = null;
  let finishReason: string | null = null;
  let usage: ChatUsage | null = null;
  let requestId = "";
  let sawDone = false;

  const partial = () => ({
    content: splitInlineThinking(rawContent, false).visible,
    reasoning: rawReasoning,
  });

  try {
    const stream = await transport(body, {
      signal: request.signal,
      apiKey: request.apiKey,
      timeoutMs: 0,
    });
    for await (const event of parseSseEvents(stream)) {
      switch (event.type) {
        case "request-id":
          requestId = event.requestId;
          break;
        case "content":
          if (ttftMs === null) ttftMs = elapsedMs(started);
          rawContent += event.delta;
          // 内联思考标签在流未结束时可能只有半截，交给 splitInlineThinking 保留原文。
          request.onDelta?.(splitInlineThinking(rawContent, false).visible);
          break;
        case "reasoning":
          rawReasoning += event.delta;
          carrier = carrier ?? event.carrier;
          request.onReasoning?.(rawReasoning);
          break;
        case "usage":
          usage = event.usage;
          break;
        case "finish":
          finishReason = event.finishReason;
          break;
        case "done":
          sawDone = true;
          break;
        case "error":
          throw new ChatUpstreamError(event.message, event.code, event.requestId);
      }
    }
  } catch (error) {
    const live = partial();
    const aborted = request.signal?.aborted === true || isAbortError(error);
    return {
      status: aborted ? "aborted" : "error",
      content: live.content,
      reasoning: live.reasoning,
      thinkingLabel: null,
      model,
      requestId,
      ttftMs,
      elapsedMs: elapsedMs(started),
      finishReason,
      sawDone,
      usage: null,
      error: aborted ? null : describeChatError(error),
    };
  }

  const finished = splitInlineThinking(rawContent, true);
  const reasoning = rawReasoning || (finished.hasTag ? finished.thinking : "");
  let resultCarrier: ThinkingCarrier = "none";
  if (rawReasoning) resultCarrier = carrier ?? "reasoning_content";
  else if (finished.hasTag && finished.thinking) resultCarrier = "inline_tag";
  const duration = elapsedMs(started);
  const promptEstimate = messages.reduce(
    (sum, message) => sum + estimateTokens(message.content),
    0,
  );
  return {
    status: "done",
    content: finished.visible,
    reasoning,
    thinkingLabel:
      describeThinking(
        { reasoning_effort: params.reasoning_effort ?? undefined },
        reasoning,
        resultCarrier,
      )?.label ?? null,
    model,
    requestId,
    ttftMs,
    elapsedMs: duration,
    finishReason,
    sawDone,
    usage: turnUsage({
      usage,
      promptEstimate,
      content: finished.visible,
      ttftMs,
      elapsedMs: duration,
    }),
    error: null,
  };
}
