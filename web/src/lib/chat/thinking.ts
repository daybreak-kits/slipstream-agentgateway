/**
 * 思考内容归一化（W5 票05，自 lib/playground 收进 chat 模块）。
 *
 * 兼容三处厂商差异：思考内容分别落在 reasoning_content / reasoning / thinking，
 * 正文可能是 content parts 数组，或把思考写进 <think> / ＜think＞ 内联标签。
 */

import type {
  ChatContentPart,
  ChatMessagePayload,
  ThinkingCarrier,
  ThinkingExtraction,
  ThinkingMarker,
} from "./types";

const THINK_OPEN_RE = /<think(?:ing)?>|＜think(?:ing)?＞/i;
const THINK_CLOSE_RE = /<\/think(?:ing)?>|＜\/think(?:ing)?＞/i;
const OPEN_TAG_PREFIXES = [
  "<think>",
  "<thinking>",
  "<reasoning>",
  "＜think＞",
  "＜thinking＞",
  "＜reasoning＞",
];

/** 流式时末尾可能是半个开标签（"<thi"），先扣住不显示，等下一块补全。 */
function trailingPartialTagIndex(text: string): number {
  const lastOpen = Math.max(text.lastIndexOf("<"), text.lastIndexOf("＜"));
  if (lastOpen < 0) return -1;
  const tail = text.slice(lastOpen).toLowerCase();
  return OPEN_TAG_PREFIXES.some((tag) => tag.toLowerCase().startsWith(tail)) ? lastOpen : -1;
}

/**
 * 从正文里拆内联思考标签（<think> /  thinking / <reasoning>，含全角括号）。
 * final=false 用于流式：还没闭合的标签内容算思考，末尾半个标签先不显示。
 */
export function splitInlineThinking(
  text: string,
  final = true,
): { visible: string; thinking: string; hasTag: boolean } {
  let rest = text;
  let visible = "";
  let thinking = "";
  let hasTag = false;
  while (rest.length > 0) {
    const openMatch = THINK_OPEN_RE.exec(rest);
    if (!openMatch || openMatch.index === undefined) {
      if (!final) {
        const partial = trailingPartialTagIndex(rest);
        if (partial >= 0) {
          visible += rest.slice(0, partial);
          break;
        }
      }
      visible += rest;
      break;
    }
    visible += rest.slice(0, openMatch.index);
    const afterOpen = rest.slice(openMatch.index + openMatch[0].length);
    const closeMatch = THINK_CLOSE_RE.exec(afterOpen);
    hasTag = true;
    if (!closeMatch || closeMatch.index === undefined) {
      thinking += afterOpen;
      break;
    }
    thinking += afterOpen.slice(0, closeMatch.index);
    rest = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  }
  return { visible, thinking, hasTag };
}

/** 正文可能是字符串，也可能是 content parts 数组；思考型 part 单独收走。 */
export function splitContentParts(
  content: string | ChatContentPart[] | null | undefined,
): { text: string; thinking: string } {
  if (!Array.isArray(content)) {
    return { text: typeof content === "string" ? content : "", thinking: "" };
  }
  let text = "";
  let thinking = "";
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const value =
      typeof part.thinking === "string"
        ? part.thinking
        : typeof part.text === "string"
          ? part.text
          : "";
    if (part.type === "thinking" || part.type === "reasoning" || part.thought === true) {
      thinking += value;
    } else {
      text += value;
    }
  }
  return { text, thinking };
}

/**
 * 离线的思考归一化：reasoning_content → reasoning → thinking → content parts
 * → 正文内联标签，只认第一个非空载体。
 */
export function extractThinkingFromMessage(
  message: ChatMessagePayload | null | undefined,
): ThinkingExtraction {
  const payload = message ?? {};
  const directText = (value: string | null | undefined): string =>
    typeof value === "string" ? value : "";
  const body = splitContentParts(payload.content);
  if (directText(payload.reasoning_content).trim()) {
    return {
      content: body.text,
      reasoning: directText(payload.reasoning_content),
      carrier: "reasoning_content",
    };
  }
  if (directText(payload.reasoning).trim()) {
    return { content: body.text, reasoning: directText(payload.reasoning), carrier: "reasoning" };
  }
  if (directText(payload.thinking).trim()) {
    return { content: body.text, reasoning: directText(payload.thinking), carrier: "thinking" };
  }
  if (body.thinking.trim()) {
    return { content: body.text, reasoning: body.thinking, carrier: "parts" };
  }
  const tagged = splitInlineThinking(body.text, true);
  if (tagged.hasTag && tagged.thinking.trim()) {
    return { content: tagged.visible, reasoning: tagged.thinking, carrier: "inline_tag" };
  }
  return { content: tagged.hasTag ? tagged.visible : body.text, reasoning: "", carrier: "none" };
}

/**
 * 思考块标记：由「这次请求发了什么」决定，标签内容不参与猜测。
 * 内联标签是唯一例外：它只能从收到的正文里识别。
 */
export function describeThinking(
  params: { reasoning_effort?: string | null },
  reasoning: string,
  carrier: ThinkingCarrier,
): ThinkingMarker | null {
  if (carrier === "inline_tag") {
    return { label: "think 标签", source: "inline_tag" };
  }
  if (params.reasoning_effort) {
    return { label: "reasoning_effort=" + params.reasoning_effort, source: "reasoning_effort" };
  }
  if (reasoning.trim()) {
    return { label: "think", source: "think" };
  }
  return null;
}

/** delta.content 可能是字符串，也可能是 content parts 数组（Anthropic/Gemini 兼容层）。 */
export function deltaText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) =>
        typeof part === "object" &&
        part !== null &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

/** delta 里的思考载体：reasoning_content → reasoning → thinking，按字段顺序拼接。 */
export function deltaReasoning(delta: ChatMessagePayload): {
  text: string;
  carrier: ThinkingCarrier | null;
} {
  let text = "";
  let carrier: ThinkingCarrier | null = null;
  for (const field of ["reasoning_content", "reasoning", "thinking"] as const) {
    const part = deltaText(delta[field]);
    if (part) {
      text += part;
      carrier = carrier ?? field;
    }
  }
  return { text, carrier };
}
