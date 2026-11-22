/**
 * 会话消息 → 上游请求消息（W5 票05）。
 *
 * 系统提示词置顶；没有产出内容的助手消息（失败或空响应）不进上下文；
 * 附件以文本块附在用户消息后面（后端没有多模态入口）。
 */

import type { ChatMessage, PlaygroundAttachment } from "./types";

/** 会话里能进上游请求的最小消息形状；PlaygroundMessage 结构上兼容。 */
export interface ChatTurnMessage {
  role: string;
  content: string;
}

/** 附件以文本块的形式附在用户消息后面：只保留文件名与文本内容。 */
export function buildUserContent(text: string, attachments: PlaygroundAttachment[] = []): string {
  const base = text.trim();
  if (!attachments.length) return base;
  const blocks = attachments.map((item) =>
    item.text ? `[附件 ${item.name}]\n${item.text}` : `[附件 ${item.name}]（无文本内容）`,
  );
  return base ? `${base}\n\n${blocks.join("\n\n")}` : blocks.join("\n\n");
}

/** 聊天记录 → 上游请求的 messages：系统提示词置顶，跳过空助手消息。 */
export function toRequestMessages(
  messages: readonly ChatTurnMessage[],
  systemPrompt: string,
): ChatMessage[] {
  const result: ChatMessage[] = [];
  const system = systemPrompt.trim();
  if (system) result.push({ role: "system", content: system });
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "assistant" && !message.content.trim()) continue;
    result.push({ role: message.role, content: message.content });
  }
  return result;
}

export const chatMessages = { buildUserContent, toRequestMessages } as const;
