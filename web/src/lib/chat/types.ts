/**
 * 对话模块的公共类型（W5 票05）：线上请求形状、思考载体、展示用量与附件。
 *
 * 参数白名单/默认值/转发映射只在 params.ts 的那张表里；这里只放跨文件共享的类型。
 */

import type { PlaygroundRequest } from "@/generated/contract";

/** 上游 chat.completions 的一条消息（= 控制面 PlaygroundRequest.messages 的元素）。 */
export type ChatMessage = PlaygroundRequest["messages"][number];

/** 控制面请求体里由参数表生成的字段（model / messages 由 sendTurn 另填）。 */
export type ChatRequestParams = Omit<PlaygroundRequest, "model" | "messages">;

/** 思考档位：default 表示不发送 reasoning_effort，其余档位按值转发。 */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type ReasoningLevel = "default" | ReasoningEffort;

export type ResponseFormatType = "text" | "json_object";

/** 上游只在结尾帧回 usage；缺字段由模块补齐或按字符估算。 */
export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** 部分厂商把 message.content 写成 content parts 数组（Anthropic / Gemini 兼容层）。 */
export interface ChatContentPart {
  type?: string;
  text?: string;
  thinking?: string;
  thought?: boolean;
  [key: string]: unknown;
}

/** 响应里一条 message / delta 的思考相关字段。 */
export interface ChatMessagePayload {
  role?: string;
  content?: string | ChatContentPart[] | null;
  /** DeepSeek / Qwen / Gemini 兼容层。 */
  reasoning_content?: string | null;
  /** Anthropic 聚合层常见。 */
  reasoning?: string | null;
  /** 部分网关只回 thinking 字符串。 */
  thinking?: string | null;
}

/** 思考内容的载体；顺序即归一化优先级。 */
export type ThinkingCarrier =
  | "reasoning_content"
  | "reasoning"
  | "thinking"
  | "parts"
  | "inline_tag"
  | "none";

export interface ThinkingExtraction {
  /** 去掉思考内容后的正文。 */
  content: string;
  reasoning: string;
  carrier: ThinkingCarrier;
}

/** 思考块标记：由「这次请求发了什么」决定，标签内容不参与猜测。 */
export interface ThinkingMarker {
  label: string;
  source: "reasoning_effort" | "think" | "inline_tag";
}

/** 会话消息里的附件：后端没有多模态入口，只以文本形式随消息发送。 */
export interface PlaygroundAttachment {
  name: string;
  size: number;
  /** 附件的文本内容。 */
  text: string;
}

/** 消息下面展示的一组用量指标：上游 usage 或前端估算，成本由日志补。 */
export interface PlaygroundUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 首字耗时（毫秒）；非流式请求拿不到时为 null。 */
  ttftMs: number | null;
  /** 本次请求总耗时（毫秒）。 */
  elapsedMs: number | null;
  /** 输出吞吐（token/s）。 */
  throughput: number | null;
  costUsd: number | null;
  /** 账本成本（整数微单位，来自 /admin/logs 的 cost_micro）；null 表示还没核出来。 */
  costMicro?: number | null;
  /** 账本花费（整数微单位，来自 /admin/logs 的 charge_micro）。 */
  chargeMicro?: number | null;
  /** 账本币种；空串表示未知。 */
  currency?: string;
  /** 用量是按字符估算的（上游没回 usage）。 */
  estimated: boolean;
}
