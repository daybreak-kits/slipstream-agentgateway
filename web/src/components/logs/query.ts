import { dayStartMs, timeWindowEquals, type TimeWindow } from "@/components/time-range-picker";
import { SELECT_ALL_VALUE } from "@/lib/select-sentinels";

/** 表头可排序的字段：后端 /admin/logs sort 白名单的子集（费用列需 billing:spend）。 */
export type LogSortField = "started_at" | "duration_ms" | "total_tokens" | "charge_micro";
export type LogSortOrder = "asc" | "desc";

export interface LogSort {
  field: LogSortField;
  order: LogSortOrder;
}

/** 默认排序：时间倒序；表头排序「取消」回到这里。 */
export const DEFAULT_LOG_SORT: LogSort = { field: "started_at", order: "desc" };

/**
 * 表头点击循环：未排此列 → 升；已升 → 降；已降 → 取消（回默认时间倒序）。
 * 时间列的「降」本身就是默认态，所以从降再点回升，循环不落空。
 */
export function cycleLogSort(current: LogSort, field: LogSortField): LogSort {
  if (current.field !== field) return { field, order: "asc" };
  if (current.order === "asc") return { field, order: "desc" };
  if (field === "started_at") return { field: "started_at", order: "asc" };
  return DEFAULT_LOG_SORT;
}

/** 状态下拉五态：全部 / 全部错误（has_error）/ 全部成功（has_error）/ 2XX·4XX·5XX（status 段）。 */
export type LogStatusFilter = typeof SELECT_ALL_VALUE | "error" | "ok" | "2xx" | "4xx" | "5xx";

/** 页面草稿：改动不立即请求，点「查询」后才写入 applied。 */
export interface LogFilterDraft {
  window: TimeWindow;
  /** 公开模型名（model: token）；空串 = 不限。 */
  model: string;
  /** 上游渠道 id（upstream: token 匹配事件里的 provider=上游 id）；空串 = 不限。 */
  upstream: string;
  /** 用户 id（user: token 匹配 id 或名称）；空串 = 不限。 */
  user: string;
  status: LogStatusFilter;
  /** 关键词 / 查询语法原文。 */
  keyword: string;
}

const DAY_MS = 24 * 3_600_000;

/**
 * 时间窗 → from_ms/to_ms。预设枚举沿用旧口径（相对窗口以 now 收尾、
 * 「今天」尾部留 1 小时余量防刚产生的日志漏行）；自定义窗直接用显式毫秒。
 */
export function logWindowBounds(
  window: TimeWindow,
  now = Date.now(),
): { start?: number; end?: number } {
  if (window.kind === "custom") return { start: window.fromMs, end: window.toMs };
  if (window.value === "24h") return { start: now - DAY_MS, end: now };
  if (window.value === "7d") return { start: now - 7 * DAY_MS, end: now };
  if (window.value === "30d") return { start: now - 30 * DAY_MS, end: now };
  if (window.value === "today") return { start: dayStartMs(now), end: now + 3_600_000 };
  return {};
}

export function createDefaultLogFilters(): LogFilterDraft {
  return {
    // W9：日志默认窗口改为「今天」（本地 00:00 → 现在），不再默认近 24 小时。
    window: { kind: "range", value: "today" },
    model: "",
    upstream: "",
    user: "",
    status: SELECT_ALL_VALUE,
    keyword: "",
  };
}

/** 与后端一致的语法校验：非法 token 后端返回 422，这里先给出提示，避免白跑一次请求。 */
export function validateLogQuery(query: string): string | null {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token.startsWith("model:")) {
      if (token.length <= 6) return "model: 后需要模型关键词，例如 model:glm";
      continue;
    }
    if (token.startsWith("upstream:")) {
      if (token.length <= 9) return "upstream: 后需要上游关键词，例如 upstream:zai";
      continue;
    }
    if (token.startsWith("user:")) {
      if (token.length <= 5) return "user: 后需要用户 ID 或名称，例如 user:alice";
      continue;
    }
    if (token.startsWith("key:")) {
      if (token.length <= 4) return "key: 后需要密钥后缀或前缀，例如 key:WXYZ";
      continue;
    }
    if (token.startsWith("status:")) {
      const value = token.slice(7);
      if (!/^([1-5]\d\d|[1-5]xx)$/.test(value)) {
        return "status: 只支持 3 位状态码（如 200）或 1xx 至 5xx";
      }
      continue;
    }
    if (token.startsWith("latency>") || token.startsWith("latency<")) {
      const value = token.slice(8);
      if (!/^\d+$/.test(value)) {
        return "latency> / latency< 后需要毫秒整数，例如 latency>500";
      }
      continue;
    }
    if (token.startsWith("ttft>")) {
      const value = token.slice(5);
      if (!/^\d+$/.test(value)) return "ttft> 后需要毫秒整数，例如 ttft>300";
      continue;
    }
    if (token.startsWith("cache>")) {
      const value = token.slice(6);
      const ratio = Number(value);
      if (!/^\d+(\.\d+)?$/.test(value) || ratio > 100) {
        return "cache> 后需要 0 至 100 的百分比，例如 cache>30";
      }
      continue;
    }
    if (token.startsWith("stream:")) {
      const value = token.slice(7).toLowerCase();
      if (value !== "true" && value !== "false") return "stream: 只接受 true / false，例如 stream:true";
    }
  }
  return null;
}

/** 把筛选控件拼成后端参数；空格分隔的 token 之间是 AND。 */
export function buildLogQuery(draft: LogFilterDraft): {
  query: string;
  hasError: boolean | undefined;
  error: string | null;
} {
  const model = draft.model.trim();
  const upstream = draft.upstream.trim();
  const user = draft.user.trim();
  if (/\s/.test(model)) return { query: "", hasError: undefined, error: "模型过滤值不能包含空格，请换一个公开模型" };
  if (/\s/.test(upstream)) return { query: "", hasError: undefined, error: "上游过滤值不能包含空格" };
  if (/\s/.test(user)) return { query: "", hasError: undefined, error: "用户过滤值不能包含空格" };

  const parts: string[] = [];
  if (model) parts.push("model:" + model);
  if (upstream) parts.push("upstream:" + upstream);
  if (user) parts.push("user:" + user);
  if (draft.status === "2xx" || draft.status === "4xx" || draft.status === "5xx") {
    parts.push("status:" + draft.status);
  }
  if (draft.keyword.trim()) parts.push(draft.keyword.trim());

  const query = parts.join(" ");
  const error = validateLogQuery(query);
  if (error) return { query: "", hasError: undefined, error };
  const hasError =
    draft.status === "error" ? true : draft.status === "ok" ? false : undefined;
  return { query, hasError, error: null };
}

export function filterDraftEqual(a: LogFilterDraft, b: LogFilterDraft): boolean {
  return (
    timeWindowEquals(a.window, b.window) &&
    a.model === b.model &&
    a.upstream === b.upstream &&
    a.user === b.user &&
    a.status === b.status &&
    a.keyword === b.keyword
  );
}

/** 草稿里是否有起作用的筛选（不含时间窗）：用于区分「无数据 / 无匹配」空态。 */
export function hasActiveLogFilters(draft: LogFilterDraft): boolean {
  return (
    draft.model !== "" ||
    draft.upstream !== "" ||
    draft.user !== "" ||
    draft.status !== SELECT_ALL_VALUE ||
    draft.keyword.trim() !== ""
  );
}
