/** 上游渠道列表页与整页编辑器共用的小件：类型扩展、协议词表、探测展示、地址推导。
 *  放本目录而不是 types.ts：types.ts 归并行工位 F5（写锁），合流后可回迁。 */

import { ApiError } from "@/lib/control-plane/errors";
import type { ProbeResultView, ProbeStep } from "@/lib/control-plane/operations/upstreams";

// 响应类型归 control-plane（W4 票04）：页面从操作层取类型，不再在组件里维护 wire 形状。
export type {
  KeyTestItem,
  KeyTestResult,
  ProbeResultView,
  ProbeStep,
  UpstreamRow,
} from "@/lib/control-plane/operations/upstreams";

/** 新建上游时的草稿（名称/别名可随提交一起写，见 api-contract §3.2 / ADR-023 #6）。
 *  name 是唯一「上游标志」（重名 422）；alias 是仅展示的「上游别名」，可为空。 */
export interface UpstreamDraft {
  name: string;
  alias: string;
  baseUrl: string;
  /** "auto" 或四个具体风格 */
  apiStyle: string;
  enabled: boolean;
}

/** 新建未保存时挂在内存里的密钥行；明文只驻留本页内存，保存时首批提交。 */
export interface PendingKey {
  localId: string;
  label: string;
  apiKey: string;
}

export const API_STYLE_OPTIONS: Array<{ value: string; label: string; hint?: string }> = [
  { value: "auto", label: "自动探测（推荐）", hint: "保存 / 探测时自动识别 OpenAI · Responses · Anthropic · Gemini" },
  { value: "openai_chat", label: "OpenAI Chat" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "anthropic_messages", label: "Anthropic Messages" },
  { value: "gemini", label: "Gemini" },
];

export const API_STYLE_LABELS: Record<string, string> = {
  auto: "自动探测",
  openai_chat: "OpenAI Chat",
  openai_responses: "OpenAI Responses",
  anthropic_messages: "Anthropic Messages",
  gemini: "Gemini",
  other: "其他",
};

export const API_STYLE_SHORT: Record<string, string> = {
  auto: "自动探测",
  openai_chat: "OpenAI",
  openai_responses: "OpenAI Responses",
  anthropic_messages: "Anthropic",
  gemini: "Gemini",
};

/** 模型类型七值，与 l02_domain/models.ModelType 一致（值即 import-models 的 model_type）。 */
export const MODEL_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "chat", label: "chat · 对话" },
  { value: "embedding", label: "embedding · 向量化" },
  { value: "rerank", label: "rerank · 重排" },
  { value: "image_generation", label: "image_generation · 图像生成" },
  { value: "audio_tts", label: "audio_tts · 语音合成" },
  { value: "audio_transcription", label: "audio_transcription · 语音转写" },
  { value: "video", label: "video · 视频生成" },
];

/** 列表/状态卡的最近探测徽标；未知（无记录）中性。 */
export function probeStatusView(status?: string | null): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (status === "ok") return { label: "连通", tone: "success" };
  if (status === "timeout") return { label: "超时", tone: "warning" };
  if (status === "error") return { label: "失败", tone: "danger" };
  return { label: "未测试", tone: "neutral" };
}

/** 探测行 kind 三值：test / discover / detect（自动探测落库的行）。 */
export function probeKindLabel(kind?: string | null): string {
  if (kind === "test") return "连通性测试";
  if (kind === "discover") return "获取上游模型";
  if (kind === "detect") return "自动探测";
  return "探测";
}

/** 鉴权方式按已识别协议人话化（ADR-026：密钥逐把管理，匿名探测分支已删除）。 */
export function authStyleLabel(protocol?: string | null): string {
  switch (protocol) {
    case "gemini":
      return "x-goog-api-key 请求头";
    case "anthropic_messages":
      return "x-api-key 请求头";
    case "openai_chat":
    case "openai_responses":
      return "Authorization: Bearer";
    default:
      return "按协议默认方式";
  }
}

/* ── 最终请求地址推导：与后端 upstream_ops._pinned_url/_models_urls/_endpoint_url 同语义 ── */

/** 末尾 # 表示精确端点：不再拼接任何路径。 */
function pinnedUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  return trimmed.endsWith("#") ? trimmed.slice(0, -1) : null;
}

function baseWithoutTrailingSlash(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function baseHasVersionSegment(baseUrl: string): boolean {
  const last = baseWithoutTrailingSlash(baseUrl).split("/").pop() ?? "";
  return /^v\d+[^/]*$/.test(last);
}

const CHAT_PATHS: Record<string, string> = {
  openai_chat: "/chat/completions",
  openai_responses: "/responses",
  anthropic_messages: "/messages",
  gemini: "/models/{model}:generateContent",
};

export function chatUrlFor(baseUrl: string, apiStyle: string): string {
  const pinned = pinnedUrl(baseUrl);
  if (pinned) return pinned;
  const base = baseWithoutTrailingSlash(baseUrl);
  const path = CHAT_PATHS[apiStyle] ?? "/chat/completions";
  if (baseHasVersionSegment(baseUrl)) return base + path;
  const version = apiStyle === "gemini" ? "v1beta" : "v1";
  return base + "/" + version + path;
}

export function modelsUrlFor(baseUrl: string, apiStyle: string): string {
  const pinned = pinnedUrl(baseUrl);
  if (pinned) return pinned;
  const base = baseWithoutTrailingSlash(baseUrl);
  if (baseHasVersionSegment(baseUrl)) return base + "/models";
  const version = apiStyle === "gemini" ? "v1beta" : "v1";
  return base + "/" + version + "/models";
}

/** 探测步骤里的 URL 只显示路径部分，避免长地址挤压行宽。 */
export function urlPathOf(url: string): string {
  const withoutOrigin = url.replace(/^https?:\/\/[^/]+/, "");
  return withoutOrigin === "" ? "/" : withoutOrigin;
}

/** 批量粘贴：一行一把，去掉空行与行内注释；返回去重结果与重复计数。 */
export function parseKeyLines(
  text: string,
  existingPlain: string[],
): { entries: Array<{ label: string; apiKey: string }>; duplicates: number } {
  const seen = new Set<string>();
  const entries: Array<{ label: string; apiKey: string }> = [];
  let duplicates = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (seen.has(line) || existingPlain.includes(line)) {
      duplicates += 1;
      continue;
    }
    seen.add(line);
    entries.push({ label: "", apiKey: line });
  }
  return { entries, duplicates };
}

/* ── 上游详情四页签（W5 D7 / W3.2）：Tab 文案与 deep-link 的单一来源 ── */

/** 详情页四页签，顺序即 TabBar 展示顺序；routing 承载模型探测（路由与模型）。 */
export const UPSTREAM_TABS = [
  { key: "connection", label: "连接与模型" },
  { key: "routing", label: "路由与模型" },
  { key: "transforms", label: "请求与响应" },
  { key: "settings", label: "其他设置" },
] as const;

export type UpstreamTabKey = (typeof UPSTREAM_TABS)[number]["key"];

/** 列表页「测试」的快速跳转目标：详情页「路由与模型」Tab（?tab=routing）。 */
export function upstreamRoutingHref(upstreamId: string): string {
  return "/upstreams/" + upstreamId + "?tab=routing";
}

/** URL ?tab= 解析：只接受已知页签；缺省/非法值回落到「连接与模型」。 */
export function resolveUpstreamTab(value: string | null | undefined): UpstreamTabKey {
  return UPSTREAM_TABS.some((item) => item.key === value) ? (value as UpstreamTabKey) : "connection";
}

/** 保存/探测选 auto 失败（422，details 带 probe_steps）时，还原一个可展示的探测视图。 */
export function probeViewFromApiError(error: unknown): ProbeResultView | null {
  if (!(error instanceof ApiError)) return null;
  const steps = error.details.probe_steps;
  if (!Array.isArray(steps)) return null;
  return {
    kind: "detect",
    status: "error",
    http_status: 0,
    latency_ms: 0,
    message: error.message,
    model_count: 0,
    protocol: null,
    protocol_source: "auto",
    probe_steps: steps as ProbeStep[],
  };
}
