/**
 * usage / 耗时归一化（W5 票05）：上游结尾帧 usage → 页面展示的指标。
 *
 * 上游没回 usage 时按字符估算（中文约 1.5 字/token，英文约 4 字符/token），
 * 并标记 estimated，页面据此如实展示「估算」而不是冒充上游计数。
 */

import type { ChatUsage, PlaygroundUsage } from "./types";

/** 上游只在结尾帧回 usage；没回就是 null，由调用方按字符估算。 */
export function normalizeUsage(raw: unknown): ChatUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  const prompt = typeof value.prompt_tokens === "number" ? value.prompt_tokens : 0;
  const completion = typeof value.completion_tokens === "number" ? value.completion_tokens : 0;
  if (typeof value.prompt_tokens !== "number" && typeof value.completion_tokens !== "number") {
    return null;
  }
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: typeof value.total_tokens === "number" ? value.total_tokens : prompt + completion,
  };
}

/** 上游没回 usage 时的兜底估算：按字符数折算词元。 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

export interface UsageInput {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  ttftMs?: number | null;
  elapsedMs?: number | null;
  throughput?: number | null;
  costUsd?: number | null;
  estimated?: boolean;
}

/** 把上游 usage / 计时打散成消息下面要展示的一组指标。 */
export function buildUsage(input: UsageInput): PlaygroundUsage {
  const promptTokens = input.promptTokens ?? 0;
  const completionTokens = input.completionTokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: input.totalTokens ?? promptTokens + completionTokens,
    ttftMs: input.ttftMs ?? null,
    elapsedMs: input.elapsedMs ?? null,
    throughput: input.throughput ?? null,
    costUsd: input.costUsd ?? null,
    estimated: input.estimated ?? false,
  };
}
