// 模型试验（游乐场）用的网络层与纯函数。
//
// 真实路径只有一条：POST /admin/playground/stream。后端以 SSE 逐块透传上游
// chunk，所以无论是「流式渲染」还是「整段返回」，都走这个端点；HTTP 基址与
// 错误形状统一来自 lib/api，不自己拼 URL、不自己造错误类型。
// VITE_MOCK=1（lib/mock.ts 的 useMock）时退回本地模拟流，只用于演示。

import { API_BASE, ApiError, api } from "@/lib/api";
import { useMock } from "@/lib/mock";
import type { ModelTarget, PublicModel } from "@/types";

/** Mock 演示用的模型清单：只在 useMock 时出现，不冒充真实目录。 */
const DEMO_PLAYGROUND_MODELS: PlaygroundModel[] = [
  { name: "demo-fast", targetCount: 1, routingMode: "failover" },
  { name: "demo-balanced", targetCount: 2, routingMode: "weighted" },
  { name: "demo-reasoning", targetCount: 1, routingMode: "conditional" },
];

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") return m.content;
  }
  return "";
}

function mockReplyText(question: string): string {
  const q = question.trim().slice(0, 60) || "（空消息）";
  return (
    "已收到你的消息：「" + q + "」。当前管理台运行在 Mock 模式，这条回复由前端模拟生成，" +
    "用于验证会话渲染、参数摘要与用量统计，不代表真实模型输出。可在右侧调整温度、输出上限或思考开关后再次发送。"
  );
}

function tokensFor(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}
import type {
  HealthStatus,
  ModelParameters,
  ModelSchedule,
  VisibleStatus,
} from "@/lib/playground-model-options";

export interface CatalogItem {
  id: string;
  name: string;
  upstream_id: string;
  upstream_slug: string;
  upstream_name: string;
  protocol: string;
  upstream_model: string;
  call_model: string;
  parameters: ModelParameters;
  input_price_per_1m: number;
  output_price_per_1m: number;
  /** 缓存命中 / 写入价（每百万词元）；后端已透传，可能为 null。 */
  cache_read_price_per_1m?: number | null;
  cache_write_price_per_1m?: number | null;
  enabled: boolean;
  created_at: number;
  probe_status?: string;
  probe_message?: string;
  probed_at?: number | null;
  health_status?: HealthStatus | null;
  visible_status?: VisibleStatus | null;
  cooldown_until?: number | null;
  fault_until?: number | null;
  status_message?: string;
}

export interface CatalogList {
  items: CatalogItem[];
  total: number;
}

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatResponse {
  id?: string;
  object?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: ChatMessagePayload;
    delta?: ChatMessagePayload;
    finish_reason?: string | null;
  }>;
  usage?: ChatUsage;
}

export interface RequestLog {
  id: string;
  request_id: string;
  api_key_label: string;
  requested_model: string;
  upstream_name: string;
  upstream_model: string;
  response_model: string;
  http_status: number;
  error_code: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  ttft_ms: number | null;
  total_ms: number;
  throughput_tps: number | null;
  usage_estimated: boolean;
  created_at: number;
}

export interface RequestLogList {
  items: RequestLog[];
  total: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type ResponseFormatType = "text" | "json_object";

/**
 * 思考档位全集（票18）：default 表示不发送 reasoning_effort，
 * 其余档位控制面按值转发到数据面。选择器按模型声明收敛（见 reasoningLevelOptions）。
 */
export type ReasoningLevel = "default" | ReasoningEffort;

/** 档位既定顺序；与后端 model_params.REASONING_LEVELS 同源。 */
export const REASONING_LEVELS: ReasoningLevel[] = [
  "default",
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** 思考控件的标签；面板、对话框与摘要共用一处。 */
export const REASONING_LEVEL_LABELS: Record<ReasoningLevel, string> = {
  default: "默认（不发送）",
  none: "none",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/** 模型声明的档位集合 → 选择器可选项：未声明回退全部，未知值过滤，空则回退。 */
export function reasoningLevelOptions(declared?: string[] | null): ReasoningLevel[] {
  if (!declared || declared.length === 0) return [...REASONING_LEVELS];
  const known = declared.filter((value): value is ReasoningLevel =>
    (REASONING_LEVELS as string[]).includes(value),
  );
  return known.length > 0 ? known : [...REASONING_LEVELS];
}

/** 模型声明的默认档 → 选择器初始值；未声明或非法回退 default（不发送）。 */
export function normalizeDeclaredDefault(declared?: string | null): ReasoningLevel {
  return declared && (REASONING_LEVELS as string[]).includes(declared)
    ? (declared as ReasoningLevel)
    : "default";
}

/** 仅 chat 类模型显示思考档位控件；无能力数据时按未声明处理（隐藏）。 */
export function isChatModel(
  modelInfo: { model_type: string } | null | undefined,
): boolean {
  return modelInfo?.model_type === "chat";
}

/** 思考内容的载体；顺序即归一化优先级。 */
export type ThinkingCarrier =
  | "reasoning_content"
  | "reasoning"
  | "thinking"
  | "parts"
  | "inline_tag"
  | "none";

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

export interface ThinkingExtraction {
  /** 去掉思考内容后的正文。 */
  content: string;
  reasoning: string;
  carrier: ThinkingCarrier;
}

export interface ThinkingMarker {
  label: string;
  source: "reasoning_effort" | "think" | "inline_tag";
}

/**
 * 请求级参数：网关只改写 model/messages/stream，其余字段原样透传上游，
 * 所以这里的字段名必须与 OpenAI Chat Completions 一致。
 * 值为 undefined 表示这次请求不发送该参数。
 */
export interface ChatParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string[];
  n?: number;
  response_format?: { type: ResponseFormatType };
  logprobs?: boolean;
  top_logprobs?: number;
  user?: string;
  reasoning_effort?: ReasoningEffort;
  /** 额外请求字段（JSON 透传框）；标准字段优先，保留键不会被覆盖。 */
  extraFields?: Record<string, unknown>;
}

export interface ExtraFieldsResult {
  ok: boolean;
  value: Record<string, unknown>;
  error?: string;
}

/** 「额外请求字段（JSON）」框：空=不发送；非对象或非法 JSON 直接拦下。 */
export function parseExtraFields(raw: string | undefined): ExtraFieldsResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, value: {} };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, value: {}, error: "额外请求字段需是一个 JSON 对象。" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, value: {}, error: "额外请求字段不是合法 JSON。" };
  }
}

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
  return OPEN_TAG_PREFIXES.some((tag) => tag.toLowerCase().startsWith(tail))
    ? lastOpen
    : -1;
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
export function splitContentParts(content: string | ChatContentPart[] | null | undefined): {
  text: string;
  thinking: string;
} {
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
  params: ChatParams,
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

export interface ChatResult {
  data: ChatResponse;
  requestId: string;
  elapsedMs: number;
  /** 去掉思考内容后的正文。 */
  content: string;
  /** 非流式响应里的思考内容；上游没回就是空串。 */
  reasoning: string;
  /** 思考内容是从哪个字段/载体识别出来的。 */
  carrier: ThinkingCarrier;
}

export interface ErrorBody {
  error?: {
    message?: string;
    code?: string;
    type?: string;
    request_id?: string;
  };
  message?: string;
  code?: string;
  request_id?: string;
}

export class ChatError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;
  readonly requestId: string;

  constructor(status: number, body: ErrorBody) {
    const detail = body.error ?? body;
    super(detail.message || `请求失败（HTTP ${status}）`);
    this.name = "ChatError";
    this.status = status;
    this.code = detail.code || "UNKNOWN";
    this.type = ("type" in detail ? detail.type : undefined) || "unknown";
    this.requestId = detail.request_id || "";
  }
}

/** 游乐场的模型选择项：对外模型名 + 目标数（v1 三层寻址：PublicModel → ModelTarget）。 */
export interface PlaygroundModel {
  name: string;
  targetCount: number;
  /** 路由模式：对话框按它分组（故障转移 / 加权 / 条件）。 */
  routingMode: PublicModel["routing_mode"];
}

/** 最近使用的模型名（本地存储，仅用于对话框排序）。 */
export const PLAYGROUND_RECENT_MODELS_KEY = "slipstream.playground.recentModels.v1";
export const PLAYGROUND_RECENT_MODELS_LIMIT = 8;

/** 读最近使用的模型；坏数据整段丢弃，不让旧格式把对话框打挂。 */
export function loadRecentPlaygroundModels(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(PLAYGROUND_RECENT_MODELS_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .slice(0, PLAYGROUND_RECENT_MODELS_LIMIT);
  } catch {
    return [];
  }
}

/** 记一次选择并返回新的最近列表（最新在前）。 */
export function rememberPlaygroundModel(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return loadRecentPlaygroundModels();
  const next = [
    trimmed,
    ...loadRecentPlaygroundModels().filter((item) => item !== trimmed),
  ].slice(0, PLAYGROUND_RECENT_MODELS_LIMIT);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PLAYGROUND_RECENT_MODELS_KEY, JSON.stringify(next));
    } catch {
      // 隐私模式写不进去：只影响最近列表，不影响选择。
    }
  }
  return next;
}

/** 参数面板的模型清单：只列启用的对外模型；Mock 模式给一份演示清单。 */
export async function listPlaygroundModels(): Promise<PlaygroundModel[]> {
  if (useMock) return DEMO_PLAYGROUND_MODELS;
  const [rows, targets] = await Promise.all([
    api.get<PublicModel[]>("/admin/public-models"),
    api.get<ModelTarget[]>("/admin/model-targets").catch(() => [] as ModelTarget[]),
  ]);
  const counts = new Map<string, number>();
  for (const target of targets) {
    counts.set(target.public_model_id, (counts.get(target.public_model_id) ?? 0) + 1);
  }
  return rows
    .filter((row) => row.enabled)
    .map((row) => ({
      name: row.name,
      targetCount: counts.get(row.id) ?? 0,
      routingMode: row.routing_mode,
    }));
}

/**
 * 非流式调用：后端只提供 SSE 端点，所以由前端把整段流收完后一次性返回。
 * 走的是同一条真实路径，不是另一套实现。
 */
export async function sendChat(
  model: string,
  messages: ChatMessage[],
  params: ChatParams = {},
  signal?: AbortSignal,
): Promise<StreamStats> {
  return sendChatStream(model, messages, { params, signal });
}

export class StreamAbortedError extends Error {
  constructor() {
    super("已停止生成");
    this.name = "StreamAbortedError";
  }
}

export function isAbortError(reason: unknown): boolean {
  if (reason instanceof StreamAbortedError) return true;
  return (
    typeof reason === "object" &&
    reason !== null &&
    (reason as { name?: string }).name === "AbortError"
  );
}

export interface StreamStats {
  /** 去掉内联思考标签后的正文。 */
  content: string;
  /** 流式回复里累积的思考内容。 */
  reasoning: string;
  /** 思考内容载体（reasoning_content / reasoning / thinking / parts / inline_tag / none）。 */
  carrier: ThinkingCarrier;
  model: string;
  requestId: string;
  ttftMs: number | null;
  elapsedMs: number;
  finishReason: string | null;
  usage: ChatUsage | null;
  sawDone: boolean;
}

export interface StreamOptions {
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  /** 思考内容增量；参数是累积到当前为止的全文，方便直接渲染。 */
  onReasoning?: (text: string) => void;
  params?: ChatParams;
  /** 前端填写的调用密钥；只随 Authorization 头发送，控制面仍用服务端密钥。 */
  apiKey?: string;
  /** false = 前端收完整段再一次性渲染（接口本身仍是 SSE）。 */
  stream?: boolean;
}

/** 上游错误体 → lib/api 的统一错误形状（与 request() 的解析口径保持一致）。 */
async function toApiError(res: Response): Promise<ApiError> {
  let code = "http_" + res.status;
  let message = res.statusText || "请求失败";
  let requestId = "";
  const raw = await res.text().catch(() => "");
  try {
    const body = JSON.parse(raw) as { code?: string; message?: string; request_id?: string };
    if (body.code) code = body.code;
    if (body.message) message = body.message;
    if (body.request_id) requestId = body.request_id;
  } catch {
    if (raw.trim()) message = raw.trim().slice(0, 300);
  }
  return new ApiError(res.status, code, message, requestId);
}

/** 标准 ChatParams 字段；有值才写进请求体。reasoning_effort 的 default 档
 * 在 chatParamsFromInput 就不产生值，控制面接受其余全部档位（票18）。 */
const FORWARDED_CHAT_PARAMS = [
  "temperature",
  "top_p",
  "top_k",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "max_tokens",
  "max_completion_tokens",
  "stop",
  "n",
  "response_format",
  "logprobs",
  "top_logprobs",
  "user",
  "reasoning_effort",
] as const satisfies ReadonlyArray<keyof ChatParams>;

/** delta.content 可能是字符串，也可能是 content parts 数组（Anthropic/Gemini 兼容层）。 */
function deltaContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) =>
        typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

/** 上游只在结尾帧回 usage；没回就是 null，由页面按字符数估算。 */
function normalizeUsage(raw: unknown): ChatUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  const prompt = typeof value.prompt_tokens === "number" ? value.prompt_tokens : 0;
  const completion = typeof value.completion_tokens === "number" ? value.completion_tokens : 0;
  if (typeof value.prompt_tokens !== "number" && typeof value.completion_tokens !== "number") return null;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: typeof value.total_tokens === "number" ? value.total_tokens : prompt + completion,
  };
}

interface ParsedChunk {
  id: string;
  content: string;
  reasoning: string;
  carrier: ThinkingCarrier | null;
  finishReason: string | null;
  usage: ChatUsage | null;
}

/** 从 chat.completion.chunk 里取本次增量；字段缺失一律按「没有」处理。 */
function parseChunk(payload: Record<string, unknown>): ParsedChunk {
  const id = typeof payload.id === "string" ? payload.id : "";
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = (choices[0] ?? {}) as Record<string, unknown>;
  const delta = (
    typeof choice.delta === "object" && choice.delta !== null ? choice.delta : {}
  ) as ChatMessagePayload;
  let reasoning = "";
  let carrier: ThinkingCarrier | null = null;
  const carrierByField = {
    reasoning_content: "reasoning_content",
    reasoning: "reasoning",
    thinking: "thinking",
  } as const satisfies Record<string, ThinkingCarrier>;
  for (const field of ["reasoning_content", "reasoning", "thinking"] as const) {
    const text = deltaContent(delta[field]);
    if (text) {
      reasoning += text;
      carrier = carrier ?? carrierByField[field];
    }
  }
  const finish = choice.finish_reason;
  return {
    id,
    content: deltaContent(delta.content),
    reasoning,
    carrier,
    finishReason: typeof finish === "string" ? finish : null,
    usage: normalizeUsage(payload.usage),
  };
}

/**
 * 真实流式调用：POST /admin/playground/stream，逐块解析 SSE。
 *
 * 后端只是把上游 chunk 原样透传，所以这里兼容三处差异：delta.content 为
 * parts 数组、思考内容分别落在 reasoning_content / reasoning / thinking、
 * 结尾帧才带 usage。[DONE] 之后不再等待，连接由 finally 释放。
 */
export async function sendChatStream(
  model: string,
  messages: ChatMessage[],
  options: StreamOptions = {},
): Promise<StreamStats> {
  if (useMock) return mockStreamChat(model, messages, options);
  const started = performance.now();
  const params = options.params ?? {};
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: options.stream ?? true,
  };
  // 票19：额外字段整包随 extra_fields 上行，由控制面合并进转发体——标准字段
  // 优先、model/messages/stream/stream_options 保留键不开放覆盖（单一裁决点
  // 在后端 relay）。控制面会把它拍平回顶层，上游看到的仍是 OpenAI 形状。
  if (params.extraFields && Object.keys(params.extraFields).length > 0) {
    body.extra_fields = params.extraFields;
  }
  for (const key of FORWARDED_CHAT_PARAMS) {
    const value = params[key];
    if (value !== undefined) body[key] = value;
  }

  let res: Response;
  try {
    res = await fetch(API_BASE + "/admin/playground/stream", {
      method: "POST",
      // httpOnly 会话 cookie 是控制面的唯一凭据；跨端口 Vite 源必须 include。
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.apiKey?.trim()
          ? { Authorization: "Bearer " + options.apiKey.trim() }
          : {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw new StreamAbortedError();
    throw error;
  }
  if (!res.ok) throw await toApiError(res);

  // 控制面当前只有 SSE 端点；如果将来改成 JSON，这里也能直接收完整响应。
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    let payload: ChatResponse;
    try {
      payload = (await res.json()) as ChatResponse;
    } catch {
      throw new ApiError(0, "bad_response", "控制面返回了无法解析的响应", "");
    }
    const choice = (payload.choices?.[0] ?? {}) as {
      message?: ChatMessagePayload;
      finish_reason?: string | null;
    };
    const message = choice.message ?? {};
    const inline = splitInlineThinking(deltaContent(message.content), true);
    let reasoning = "";
    for (const field of ["reasoning_content", "reasoning", "thinking"] as const) {
      reasoning += deltaContent(message[field]);
    }
    options.onDelta?.(inline.visible);
    if (reasoning) options.onReasoning?.(reasoning);
    return {
      content: inline.visible,
      reasoning: reasoning || (inline.hasTag ? inline.thinking : ""),
      carrier: reasoning ? "reasoning_content" : inline.hasTag ? "inline_tag" : "none",
      model,
      requestId: typeof payload.id === "string" ? payload.id : "",
      ttftMs: null,
      elapsedMs: Math.round(performance.now() - started),
      finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
      usage: normalizeUsage(payload.usage),
      sawDone: true,
    };
  }

  if (!res.body) {
    throw new ApiError(0, "stream_unsupported", "当前浏览器不支持流式读取响应", "");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawContent = "";
  let rawReasoning = "";
  let deltaCarrier: ThinkingCarrier | null = null;
  let ttftMs: number | null = null;
  let finishReason: string | null = null;
  let usage: ChatUsage | null = null;
  let requestId = "";
  let sawDone = false;

  const consume = (event: string) => {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") {
      sawDone = true;
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const upstreamError = payload.error;
    if (typeof upstreamError === "object" && upstreamError !== null) {
      const detail = upstreamError as { message?: string; code?: string; request_id?: string };
      throw new ChatError(200, {
        error: { message: detail.message, code: detail.code, request_id: detail.request_id },
      });
    }
    const chunk = parseChunk(payload);
    if (chunk.id) requestId = chunk.id;
    if (chunk.usage) usage = chunk.usage;
    if (chunk.finishReason) finishReason = chunk.finishReason;
    if (chunk.content) {
      if (ttftMs === null) ttftMs = Math.round(performance.now() - started);
      rawContent += chunk.content;
      // 内联思考标签在流未结束时可能只有半截，交给 splitInlineThinking 保留原文。
      options.onDelta?.(splitInlineThinking(rawContent, false).visible);
    }
    if (chunk.reasoning) {
      rawReasoning += chunk.reasoning;
      deltaCarrier = deltaCarrier ?? chunk.carrier;
      options.onReasoning?.(rawReasoning);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode().replace(/\r\n/g, "\n");
    if (buffer.trim()) consume(buffer);
  } catch (error) {
    if (isAbortError(error)) throw new StreamAbortedError();
    throw error;
  } finally {
    void reader.cancel().catch(() => undefined);
  }

  const inline = splitInlineThinking(rawContent, true);
  const reasoning = rawReasoning || (inline.hasTag ? inline.thinking : "");
  let carrier: ThinkingCarrier = "none";
  if (rawReasoning) carrier = deltaCarrier ?? "reasoning_content";
  else if (inline.hasTag && inline.thinking) carrier = "inline_tag";
  return {
    content: inline.visible,
    reasoning,
    carrier,
    model,
    requestId,
    ttftMs,
    elapsedMs: Math.round(performance.now() - started),
    finishReason,
    usage,
    sawDone,
  };
}

/**
 * Mock 模式：本地模拟流（逐块回调 + 可中断）。
 * 只在 useMock 或后端未就绪时用于演示，不代表真实模型输出。
 */
async function mockStreamChat(
  model: string,
  messages: ChatMessage[],
  options: StreamOptions = {},
): Promise<StreamStats> {
  const started = performance.now();
  const params = options.params ?? {};
  const thinkEnabled =
    params.reasoning_effort !== undefined && params.reasoning_effort !== "none";

  const abortPromise = new Promise<never>((_, reject) => {
    if (options.signal?.aborted) {
      reject(new StreamAbortedError());
      return;
    }
    options.signal?.addEventListener("abort", () => reject(new StreamAbortedError()), { once: true });
  });
  abortPromise.catch(() => undefined);
  const wait = (ms: number) =>
    Promise.race([new Promise<void>((resolve) => setTimeout(resolve, ms)), abortPromise]);

  let reasoning = "";
  let full = "";
  let ttftMs: number | null = null;

  if (thinkEnabled) {
    const steps = [
      "先拆解问题，确认用户真正想要的信息。",
      "检查可用上下文，排除无关细节。",
      "组织回答：结论先行，再补充说明。",
    ];
    for (const step of steps) {
      await wait(160);
      reasoning += step;
      options.onReasoning?.(reasoning);
    }
  }

  const question = lastUserText(messages);
  const reply = mockReplyText(question);
  for (let i = 0; i < reply.length; i += 12) {
    await wait(45);
    if (ttftMs === null) ttftMs = Math.round(performance.now() - started);
    full += reply.slice(i, i + 12);
    options.onDelta?.(full);
  }

  const promptTokens = tokensFor(question);
  const completionTokens = Math.max(1, Math.round(full.length / 4));
  return {
    content: full,
    reasoning,
    carrier: "none",
    model,
    requestId: "req-mock-" + Date.now().toString(36),
    ttftMs,
    elapsedMs: Math.round(performance.now() - started),
    finishReason: "stop",
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    sawDone: true,
  };
}

export function describeChatError(error: unknown): string {
  if (error instanceof ChatError) {
    const parts = [error.message];
    if (error.code && error.code !== "UNKNOWN") parts.push(`(${error.code})`);
    if (error.requestId) parts.push(`请求编号 ${error.requestId}`);
    return parts.join(" · ");
  }
  if (error instanceof Error) return error.message;
  return "请求失败，请稍后重试";
}

export interface CatalogEntry extends CatalogItem {
  /** ADR-067：条目只有直连与组合两种；组合的来源由 origin 区分。 */
  kind: "direct" | "combo";
  origin?: "manual" | "auto" | null;
  /** 定时关闭到期时刻（epoch ms）；null/缺省表示没有定时封禁。 */
  banned_until?: number | null;
  status: string;
  /** 后端派生状态（api/src/l06_api/schemas.py 的 CatalogEntry，与 lib/playground-model-options.ts 的 Literal 一致）。 */
  health_status?: HealthStatus | null;
  visible_status?: VisibleStatus | null;
  cooldown_until?: number | null;
  fault_until?: number | null;
  /** 熔断器连续失败次数（后端目录接口透传后用于「可用但近期失败」提示）。 */
  consecutive_failures?: number | null;
  status_message?: string;
  /** 目录下发的排期（v2；v1 历史行后端出口已归一成 weekly）。null/缺省表示没有排期。 */
  schedule?: ModelSchedule | null;
  /** 目录下发的原因码；null 表示按普通状态展示，值域与后端 Literal 一致。 */
  cooldown_reason?: "MODEL_BANNED" | "MODEL_COOLDOWN" | "COOLDOWN_WINDOW" | null;
}

export interface CatalogEntries {
  items: CatalogEntry[];
  total: number;
}

/**
 * 目录类型的查询已迁回模型管理页自己的 lib（v1 只有 /admin/public-models 等真实端点），
 * 游乐场不再需要「目录」视图，这里只保留聊天与参数相关的纯函数。
 */

/* ---------------------------------------------------------------------------
 * 模型试验（聊天界面）用的纯函数。
 *
 * 聊天记录只保存在浏览器本地（lib 侧只提供纯函数，存储读写在
 * components/playground/history-store.ts），不经过任何后端接口。
 * ------------------------------------------------------------------------- */

/** 会话记录在浏览器里的存储键（v1 新名；旧仓 llmapi.* 前缀已废弃）。 */
export const PLAYGROUND_HISTORY_KEY = "slipstream.playground.sessions.v1";

/** 只保留最近若干条，避免单次会话把 localStorage 撑爆。 */
export const PLAYGROUND_HISTORY_LIMIT = 200;

export interface PlaygroundAttachment {
  name: string;
  size: number;
  /** 附件的文本内容；后端没有多模态入口，附件只能以文本形式随消息发送。 */
  text: string;
}

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

export interface PlaygroundMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  model?: string;
  createdAt: number;
  /** 助手消息仍在流式接收中。 */
  streaming?: boolean;
  /** 用户手动停了生成，已收到的部分内容保留。 */
  stopped?: boolean;
  /** 这条回复是流式（SSE）逐字渲染出来的。 */
  streamed?: boolean;
  /** 思考型模型返回的思考内容；为空表示这次回复没有思考块。 */
  reasoning?: string;
  /** 思考块来源标记（reasoning_effort=low / thinking=on / think / think 标签）。 */
  thinkingLabel?: string;
  /** 请求失败的原因（只在前端展示，不入请求体）。 */
  error?: string;
  requestId?: string;
  usage?: PlaygroundUsage;
  attachments?: PlaygroundAttachment[];
}

/** combobox 的本地过滤：调用串、上游名与上游模型名任一命中即保留。 */
export function filterCatalogEntries(items: CatalogEntry[], query: string): CatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    `${item.name} ${item.upstream_name} ${item.upstream_model}`.toLowerCase().includes(needle),
  );
}

/** 空串 → undefined；非数字 → undefined（由 validateChatParams 报错）。 */
export function parseOptionalNumber(raw: string | undefined): number | undefined {
  const text = (raw ?? "").trim();
  if (!text) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export interface ChatParamInput {
  temperature?: string;
  topP?: string;
  topK?: string;
  frequencyPenalty?: string;
  presencePenalty?: string;
  seed?: string;
  maxTokens?: string;
  maxCompletionTokens?: string;
  /** stop 多值：单行逗号分隔；旧换行输入在解析时折算成同一语义（票19）。 */
  stop?: string;
  n?: string;
  responseFormat?: ResponseFormatType;
  logprobs?: boolean;
  topLogprobs?: string;
  user?: string;
  /** 思考控件：default 不发送 reasoning_effort，其余档位按值转发（票18）。 */
  thinkingMode?: ReasoningLevel;
  /** 额外请求字段（JSON 对象）；厂商私有字段的兜底透传。 */
  extraFields?: string;
}

/** 参数面板 label 下方那行小字的文案：取值范围 + 一句话用途。 */
export interface ParamHint {
  /** OpenAI 兼容口径的取值区间；注明「上游未校验」表示越界由上游自行决定。 */
  range: string;
  /** 一句话用途，写给第一次用这个参数的人。 */
  usage: string;
}

/**
 * 参数说明文案的唯一来源：面板只负责排版，文案集中在这里，
 * 和 validateChatParams 的区间一起校对（改口径先改这里）。
 */
export const PARAM_HINTS = {
  temperature: { range: "0.0–2.0", usage: "越高输出越随机，越低越确定" },
  topP: { range: "0.0–1.0（> 0）", usage: "与 temperature 二选一调整，越小候选越少" },
  topK: { range: "≥ 0 的整数", usage: "只从概率最高的前 k 个候选里挑；上游未校验" },
  frequencyPenalty: { range: "−2.0–2.0", usage: "按出现次数压低重复词，越高越不容易复读" },
  presencePenalty: { range: "−2.0–2.0", usage: "按是否出现过压低，越高越愿意换话题" },
  seed: { range: "整数", usage: "固定随机种子便于复现；上游未校验，可能被忽略" },
  maxTokens: { range: "1–模型上限", usage: "本次回复最多生成的词元数" },
  maxCompletionTokens: { range: "1–模型上限", usage: "与 max_tokens 二选一，新版接口用它替代" },
  n: { range: "1–128", usage: "一次生成几份候选回复；多数上游只支持 1" },
  stop: { range: "最多 4 条，逗号分隔", usage: "命中任一条就停止生成，停止词不进回复" },
  responseFormat: { range: "text / json_object", usage: "json_object 要求提示词里明确要求 JSON" },
  logprobs: { range: "开 / 关", usage: "返回每个生成词元的对数概率，用于排查" },
  topLogprobs: { range: "0–20", usage: "返回前 k 个候选词的概率；需先打开 logprobs" },
  user: { range: "≤ 256 字符", usage: "给上游的稳定用户标识，用于滥用追踪" },
  thinkingMode: {
    range: "default / none / low / medium / high / xhigh / max",
    usage: "default 表示不发送该参数；其余档位控制面按值转发到上游",
  },
  extraFields: { range: "顶层 JSON 对象", usage: "厂商私有字段原样合并进请求体；与标准参数同名时以标准参数为准" },
  systemPrompt: { range: "可选", usage: "作为 system 消息置顶，本会话每次请求都带" },
  apiKey: { range: "留空用登录凭证", usage: "只留在浏览器内存，随请求发 Authorization" },
  streamMode: { range: "开 / 关", usage: "开=逐条收 SSE；关=等完整回复一次返回" },
  reasoningLevel: { range: "只读", usage: "当前选择的思考档位；在模型对话框或高级参数里调整" },
} satisfies Record<string, ParamHint>;

export type ParamHintKey = keyof typeof PARAM_HINTS;

/** 组装面板那行小字：取值范围 · 用途；range 可覆盖（如 max_tokens 的实际上限）。 */
export function paramHintText(key: ParamHintKey, range?: string): string {
  const hint = PARAM_HINTS[key];
  return (range ?? hint.range) + " · " + hint.usage;
}

/** 模型没登记 max_output_tokens 时沿用旧页的输出上限。 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32768;

/** 输出上限：优先用上游模型登记的 parameters.max_output_tokens，0=未登记则回退。 */
export function maxOutputTokensFor(registered: number | null | undefined): number {
  return registered && registered > 0 ? registered : DEFAULT_MAX_OUTPUT_TOKENS;
}

export interface ChatParamValidation {
  valid: boolean;
  message?: string;
}

export interface ChatParamValidationOptions {
  /** 所选上游模型登记的 parameters.max_output_tokens；0/缺省表示未登记。 */
  maxOutputTokens?: number | null;
}

/**
 * stop 的分隔符（票19）：主用逗号；旧多行输入的换行在解析时折算成同一语义
 * （一次性迁移，存量换行写法继续工作）。分号从来不是分隔符，保持为内容。
 * 注意是单字符集、不带 +：连续逗号必须各自成段，空条目才检测得出来。
 */
const STOP_SEPARATORS = /[\n,]/;

/** stop 多值输入 → 真正发出去的数组；逗号/换行拆分，trim，去空，保序。 */
export function parseStopSequences(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(STOP_SEPARATORS)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 空条目检测（票19 行内校验）：「a,,b」「a,」这类写法会产生空 stop 条目，
 * 上游会拒绝，发送前拦下并提示。与 parseStopSequences 共用同一份分隔符定义。
 */
export function stopHasEmptyItems(raw: string | undefined): boolean {
  const text = raw ?? "";
  if (!text.trim()) return false;
  return text.split(STOP_SEPARATORS).some((item) => item.trim().length === 0);
}

function isIntegerInRange(value: number | undefined, min: number, max: number): boolean {
  return value !== undefined && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 请求前的内联校验：只要有一条不合法就拦住发送，错误文案直接显示在输入区。
 * 输出去上限来自所选模型（见 maxOutputTokensFor），不再写死 32768。
 */
export function validateChatParams(
  input: ChatParamInput,
  options: ChatParamValidationOptions = {},
): ChatParamValidation {
  const limit = maxOutputTokensFor(options.maxOutputTokens);
  const temperature = parseOptionalNumber(input.temperature);
  const topP = parseOptionalNumber(input.topP);
  const topK = parseOptionalNumber(input.topK);
  const frequencyPenalty = parseOptionalNumber(input.frequencyPenalty);
  const presencePenalty = parseOptionalNumber(input.presencePenalty);
  const seed = parseOptionalNumber(input.seed);
  const maxTokens = parseOptionalNumber(input.maxTokens);
  const maxCompletionTokens = parseOptionalNumber(input.maxCompletionTokens);
  const n = parseOptionalNumber(input.n);
  const topLogprobs = parseOptionalNumber(input.topLogprobs);

  if (input.temperature?.trim() && (temperature === undefined || temperature < 0 || temperature > 2)) {
    return { valid: false, message: "temperature 需在 0–2 之间。" };
  }
  if (input.topP?.trim() && (topP === undefined || topP <= 0 || topP > 1)) {
    return { valid: false, message: "top_p 需大于 0 且不超过 1。" };
  }
  if (input.topK?.trim() && !isIntegerInRange(topK, 0, Number.MAX_SAFE_INTEGER)) {
    return { valid: false, message: "top_k 需是 ≥0 的整数。" };
  }
  if (
    input.frequencyPenalty?.trim() &&
    (frequencyPenalty === undefined || frequencyPenalty < -2 || frequencyPenalty > 2)
  ) {
    return { valid: false, message: "frequency_penalty 需在 −2–2 之间。" };
  }
  if (
    input.presencePenalty?.trim() &&
    (presencePenalty === undefined || presencePenalty < -2 || presencePenalty > 2)
  ) {
    return { valid: false, message: "presence_penalty 需在 −2–2 之间。" };
  }
  if (input.seed?.trim() && !isIntegerInRange(seed, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) {
    return { valid: false, message: "seed 需是整数。" };
  }
  if (input.maxTokens?.trim() && !isIntegerInRange(maxTokens, 1, limit)) {
    return { valid: false, message: `max_tokens 需是 1–${limit} 的整数（上限取自所选模型）。` };
  }
  if (
    input.maxCompletionTokens?.trim() &&
    !isIntegerInRange(maxCompletionTokens, 1, limit)
  ) {
    return {
      valid: false,
      message: `max_completion_tokens 需是 1–${limit} 的整数（上限取自所选模型）。`,
    };
  }
  if (input.n?.trim() && !isIntegerInRange(n, 1, 128)) {
    return { valid: false, message: "n 需是 1–128 的整数。" };
  }
  // 票19：stop 单行逗号分隔（旧换行输入在解析层折算）；空条目上游会拒绝，
  // 发送前拦下并各给一句可操作的提示。
  if (parseStopSequences(input.stop).length > 4) {
    return { valid: false, message: "stop 最多 4 条，逗号分隔。" };
  }
  if (stopHasEmptyItems(input.stop)) {
    return { valid: false, message: "stop 含空条目，请去掉多余或连续的逗号。" };
  }
  if (input.topLogprobs?.trim()) {
    if (!input.logprobs) {
      return { valid: false, message: "top_logprobs 需要先打开 logprobs。" };
    }
    if (!isIntegerInRange(topLogprobs, 0, 20)) {
      return { valid: false, message: "top_logprobs 需是 0–20 的整数。" };
    }
  }
  if (input.user?.trim() && input.user.trim().length > 256) {
    return { valid: false, message: "user 最多 256 个字符。" };
  }
  const extra = parseExtraFields(input.extraFields);
  if (!extra.ok) {
    return { valid: false, message: extra.error };
  }
  return { valid: true };
}

/** 输入框里的字符串 → 上游认识的请求参数；留空的一律不发送。 */
export function chatParamsFromInput(input: ChatParamInput): ChatParams {
  const stop = parseStopSequences(input.stop);
  const mode = input.thinkingMode ?? "default";
  const effort = mode === "default" ? undefined : mode;
  return {
    temperature: parseOptionalNumber(input.temperature),
    top_p: parseOptionalNumber(input.topP),
    top_k: parseOptionalNumber(input.topK),
    frequency_penalty: parseOptionalNumber(input.frequencyPenalty),
    presence_penalty: parseOptionalNumber(input.presencePenalty),
    seed: parseOptionalNumber(input.seed),
    max_tokens: parseOptionalNumber(input.maxTokens),
    max_completion_tokens: parseOptionalNumber(input.maxCompletionTokens),
    stop: stop.length ? stop : undefined,
    n: parseOptionalNumber(input.n),
    response_format:
      input.responseFormat === "json_object" ? { type: "json_object" } : undefined,
    logprobs: input.logprobs ? true : undefined,
    top_logprobs: input.logprobs ? parseOptionalNumber(input.topLogprobs) : undefined,
    user: input.user?.trim() || undefined,
    reasoning_effort: effort,
    extraFields: parseExtraFields(input.extraFields).value,
  };
}

/** 输入区顶部的一句话摘要：只列这次真正会发送的字段。 */
export function summarizeChatParams(input: ChatParamInput): string {
  const thinkingMode = input.thinkingMode ?? "default";
  const fields: Array<[string, string | undefined]> = [
    ["temperature", input.temperature],
    ["top_p", input.topP],
    ["top_k", input.topK],
    ["max_tokens", input.maxTokens],
    ["stop", parseStopSequences(input.stop).length ? String(parseStopSequences(input.stop).length) + " 条" : undefined],
    [
      "思考",
      thinkingMode === "default" ? undefined : "reasoning_effort=" + thinkingMode,
    ],
    [
      "额外字段",
      Object.keys(parseExtraFields(input.extraFields).value).length
        ? String(Object.keys(parseExtraFields(input.extraFields).value).length) + " 个"
        : undefined,
    ],
  ];
  const parts = fields
    .filter(([, value]) => Boolean(value?.trim()))
    .map(([name, value]) => name + " " + value?.trim());
  return parts.length ? parts.join(" · ") : "全部默认";
}

/**
 * 附件以文本块的形式附在用户消息后面：后端没有多模态入口，
 * 图片/二进制文件无法直接送上游，只保留文件名。
 */
export function buildUserContent(text: string, attachments: PlaygroundAttachment[] = []): string {
  const base = text.trim();
  if (!attachments.length) return base;
  const blocks = attachments.map((item) =>
    item.text ? `[附件 ${item.name}]\n${item.text}` : `[附件 ${item.name}]（无文本内容）`,
  );
  return base ? `${base}\n\n${blocks.join("\n\n")}` : blocks.join("\n\n");
}

/**
 * 聊天记录 → 上游请求的 messages：系统提示词置顶，
 * 没有产出内容的助手消息（失败或空响应）不进上下文。
 */
export function toRequestMessages(messages: PlaygroundMessage[], systemPrompt: string): ChatMessage[] {
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

/**
 * 管理端日志里的成本 / TTFT / 吞吐比浏览器拿到的 usage 更准，
 * 有日志时用日志覆盖，没有的字段保留原值。
 */
export function mergeLogUsage(
  usage: PlaygroundUsage | undefined,
  log: RequestLog | null | undefined,
): PlaygroundUsage | undefined {
  if (!usage) return undefined;
  if (!log) return usage;
  return {
    promptTokens: log.prompt_tokens ?? usage.promptTokens,
    completionTokens: log.completion_tokens ?? usage.completionTokens,
    totalTokens: log.prompt_tokens + log.completion_tokens || usage.totalTokens,
    ttftMs: log.ttft_ms ?? usage.ttftMs,
    elapsedMs: log.total_ms ?? usage.elapsedMs,
    throughput: log.throughput_tps ?? usage.throughput,
    costUsd: log.cost_usd ?? usage.costUsd,
    estimated: log.usage_estimated || usage.estimated,
  };
}

/** 解析浏览器里存的聊天记录；坏数据整段丢弃，不让旧格式把页面打挂。 */
export function parsePlaygroundHistory(raw: string | null): PlaygroundMessage[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPlaygroundMessage).slice(-PLAYGROUND_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function isPlaygroundMessage(value: unknown): value is PlaygroundMessage {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<PlaygroundMessage>;
  return (
    typeof item.id === "string" &&
    (item.role === "user" || item.role === "assistant" || item.role === "system") &&
    typeof item.content === "string" &&
    typeof item.createdAt === "number"
  );
}

/** 落盘前的序列化：去掉「正在流式」这类临时状态，并截断到上限条数。 */
export function serializePlaygroundHistory(messages: PlaygroundMessage[]): string {
  const trimmed = messages.slice(-PLAYGROUND_HISTORY_LIMIT).map((message) => ({
    ...message,
    streaming: false,
  }));
  return JSON.stringify(trimmed);
}

