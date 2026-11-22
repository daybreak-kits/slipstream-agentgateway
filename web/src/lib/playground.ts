/**
 * 模型试验（游乐场）页面领域的纯函数（W5 票05 收口）。
 *
 * 对话请求、参数表与流解析已收进 lib/chat/：本文件只保留游乐场的页面本地状态
 * ——最近使用的模型（localStorage）、聊天记录读写与目录条目类型。对话网络路径
 * 不存在第二份实现，页面只调 lib/chat 的 sendTurn。
 */

import type { PlaygroundAttachment, PlaygroundUsage } from "@/lib/chat";
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
