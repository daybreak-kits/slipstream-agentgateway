import { toast } from "@/lib/notify";
import { pushErrorNotificationOnce } from "@/lib/notification-store";

import { mockRequest, useMock } from "./mock";

/** 同源部署（单端口）时为 ""；独立前端部署或需要跨源时用 VITE_API_BASE 覆盖。 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";
/** 界面展示用的「控制面地址」：同源部署显示当前 origin，而不是空串。 */
export const API_BASE_LABEL: string =
  API_BASE || (typeof window === "undefined" ? "" : window.location.origin);

/** 后端管理 API 的统一错误形状：{code, message, details?, request_id} */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  /** Backend validation errors live in details.errors; join them for display. */
  errorLines(): string[] {
    const errors = this.details.errors;
    if (Array.isArray(errors)) return errors.map((item) => String(item));
    return [];
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let code = "http_" + res.status;
  let message = res.statusText || "请求失败";
  let requestId = "";
  const raw = await res.text();
  let details: Record<string, unknown> = {};
  try {
    const body = JSON.parse(raw) as {
      code?: string;
      message?: string;
      request_id?: string;
      details?: Record<string, unknown>;
    };
    if (body.code) code = body.code;
    if (body.message) message = body.message;
    if (body.request_id) requestId = body.request_id;
    if (body.details) details = body.details;
  } catch {
    // 认证失败等返回纯文本（如 401 Unauthorized，text/plain）：原样展示，不硬套 JSON 形状
    if (raw.trim()) message = raw.trim().slice(0, 200);
  }
  return new ApiError(res.status, code, message, requestId, details);
}

/** 401 统一跳登录页并带回跳地址；登录页自身不跳，避免死循环。 */
function redirectToLogin(): void {
  if (window.location.pathname === "/login") return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign("/login?next=" + next);
}

/**
 * 失败反馈（W6 票07）：查询（GET）失败不再逐查询弹 toast——同因（code+message）
 * 只在通知中心记一条（去重见 notification-store），页面内联/空态照常渲染；
 * 写操作（非 GET）保留右上角 toast：用户刚做了一个动作，需要即时反馈。
 * request_id 进描述但不进去重键：后端每次请求都会生成新的 id。
 */
function reportFailure(err: ApiError, isQuery: boolean): void {
  const description =
    err.code +
    "：" +
    err.message +
    (err.requestId ? "（request_id " + err.requestId + "）" : "");
  if (!isQuery) {
    toast.error("请求失败", { description });
    return;
  }
  pushErrorNotificationOnce({
    title: "查询失败",
    description,
    dedupeKey: err.code + "|" + err.message,
  });
}

/** 网络/超时类失败与 HTTP 失败同策略：查询进通知中心去重，写操作弹 toast。 */
function reportNetworkFailure(title: string, description: string, isQuery: boolean): void {
  if (!isQuery) {
    toast.error(title, { description });
    return;
  }
  pushErrorNotificationOnce({ title, description, dedupeKey: "network|" + title });
}

/** 单请求可选项：signal 透传（react-query 换 key 自动取消旧请求）；timeoutMs=0 表示不设超时（流式用）。 */
export interface ApiOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function request<T>(path: string, init?: RequestInit & ApiOpts): Promise<T> {
  if (useMock) return mockRequest<T>(path, init);
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: external, ...rest } = init ?? {};
  // W6 票07：GET 是查询——失败进通知中心去重，不逐查询弹 toast。
  const isQuery = (rest.method ?? "GET").toUpperCase() === "GET";
  const controller = new AbortController();
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener("abort", () => controller.abort(external.reason), { once: true });
  }
  const timer =
    timeoutMs > 0
      ? window.setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs)
      : 0;
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...rest,
      signal: controller.signal,
      // httpOnly 会话 cookie 是唯一凭据；跨端口 Vite 源需要 include。
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    });
  } catch (e) {
    if (external?.aborted) throw e; // 外部取消（切区间/换页）：静默，由调用方处理
    if (e instanceof DOMException && e.name === "TimeoutError") {
      reportNetworkFailure(
        "请求超时",
        path + " 超过 " + Math.round(timeoutMs / 1000) + "s 未响应",
        isQuery,
      );
      throw e;
    }
    reportNetworkFailure(
      "无法连接控制面 API",
      String(API_BASE) + "（" + String((e as Error).message) + "）",
      isQuery,
    );
    throw e;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
  if (res.status === 401) {
    const err = await parseError(res);
    redirectToLogin();
    throw err;
  }
  if (!res.ok) {
    const err = await parseError(res);
    reportFailure(err, isQuery);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 列表信封：后端有的接口回裸数组，有的回 {items,total}；统一归一化。 */
export interface ListEnvelope<T> {
  items: T[];
  total: number;
}

export function unwrapList<T>(payload: T[] | ListEnvelope<T>): ListEnvelope<T> {
  if (Array.isArray(payload)) return { items: payload, total: payload.length };
  return { items: payload.items, total: payload.total };
}

/** 列表统一入口：裸数组 → {items,total}；分页一律客户端做（DataTable 25/50/100/200）。 */
export async function apiList<T>(path: string): Promise<ListEnvelope<T>> {
  const payload = await api.get<T[] | ListEnvelope<T>>(path);
  return unwrapList(payload);
}

/** 后端真实路径（docs/api-contract.md 对齐）；页面只允许从这里取路径。 */
export const ENDPOINTS = {
  overview: "/admin/reports/overview",
  upstreams: "/admin/upstreams",
  upstreamModels: "/admin/upstream-models",
  discoverModels: (code: string) => "/admin/upstreams/" + code + "/discover-models",
  upstreamDetail: (code: string) => "/admin/upstreams/" + code,
  upstreamBatch: "/admin/upstreams/batch",
  upstreamKeys: (code: string) => "/admin/upstreams/" + code + "/keys",
  upstreamKey: (code: string, keyId: string) => "/admin/upstreams/" + code + "/keys/" + keyId,
  upstreamKeysBatchDelete: (code: string) => "/admin/upstreams/" + code + "/keys/batch-delete",
  upstreamKeysTest: (code: string) => "/admin/upstreams/" + code + "/keys/test",
  upstreamTest: (code: string) => "/admin/upstreams/" + code + "/test-connection",
  upstreamModelsProbe: (code: string) => "/admin/upstreams/" + code + "/models/probe",
  upstreamImportModels: (code: string) => "/admin/upstreams/" + code + "/import-models",
  transforms: (code: string) => "/admin/upstreams/" + code + "/transforms",
  transformsPreview: (code: string) => "/admin/upstreams/" + code + "/transforms/preview",
  publicModels: "/admin/public-models",
  apiKeys: "/admin/api-keys",
  users: "/admin/users",
  userLedger: (id: string) => "/admin/users/" + id + "/ledger",
  userBalance: (id: string) => "/admin/users/" + id + "/balance",
  modelTargets: "/admin/model-targets",
  authLogin: "/admin/auth/login",
  reportsTrend: "/admin/reports/trend",
  reportsFlow: "/admin/reports/flow",
  reportsTimeseries: "/admin/reports/timeseries",
  reportsLatency: "/admin/reports/latency",
  reportsHeatmap: "/admin/reports/heatmap",
  health: "/admin/health",
  logs: "/admin/logs",
  logAttempts: (id: string) => "/admin/logs/" + encodeURIComponent(id) + "/attempts",
  upstreamCreate: "/admin/upstreams",
  upstreamUpdate: (code: string) => "/admin/upstreams/" + code,
  upstreamModelCreate: "/admin/upstream-models",
  upstreamModelUpdate: (id: string) => "/admin/upstream-models/" + id,
  publicModelCreate: "/admin/public-models",
  // ticket 12：公开模型保存只走单 PATCH（基本信息 + 策略 + 启用 + targets 整批替换）
  publicModelUpdate: (id: string) => "/admin/public-models/" + id,
  apiKeyReveal: (id: string) => "/admin/api-keys/" + id + "/reveal",
  apiKeyRotate: (id: string) => "/admin/api-keys/" + id + "/rotate",
  apiKeyTopup: (id: string) => "/admin/api-keys/" + id + "/topup",
  configRevisions: "/admin/config/revisions",
  auditLogs: "/admin/audit-logs",
  policies: "/admin/policies",
  policiesValidate: "/admin/policies/validate",
  guardrails: "/admin/guardrails",
  guardrailsValidate: "/admin/guardrails/validate",
  mcpServers: "/admin/mcp-servers",
  mcpServer: (name: string) => "/admin/mcp-servers/" + encodeURIComponent(name),
  mcpValidate: "/admin/mcp-servers/validate",
  configApply: "/admin/config/apply",
  settings: "/admin/settings",
  settingsSchema: "/admin/settings/schema",
  connection: "/admin/connection",
  preferences: "/admin/auth/preferences",
  costEntries: "/admin/cost/entries",
  chargeEntries: "/admin/charge/entries",
  pricesUpstream: "/admin/prices/upstream",
  pricesExport: "/admin/prices/export",
  pricesImport: "/admin/prices/import",
  // ticket 05：公开模型价格是派生只读值；账本带成本/花费/毛利（按字段权限裁剪）
  pricesPublicModels: "/admin/prices/public-models",
  billingLedger: "/admin/billing/ledger",
  // ticket 17：我的花费（后端按字段权限裁剪 cost/margin）
  mySpend: "/admin/bills/my-spend",
  unpriced: "/admin/unpriced",
  unpricedRecompute: "/admin/unpriced/recompute",
  availabilityRules: "/admin/availability-rules",
  availabilityRule: (id: string) => "/admin/availability-rules/" + id,
  // ticket 10：模型管理（上游模型 / 公开模型两个 Tab）
  upstreamModelBatch: "/admin/upstream-models/batch",
  publicModelBatch: "/admin/public-models/batch",
  // ticket 12：删除 PUT /admin/public-models/{id}/targets，成员随单 PATCH 提交
  // W4-H：models.dev 快照兑入（单条=编辑弹窗按钮，批量=工具条同步按钮）与用户侧模型参数
  upstreamModelAdopt: (id: string) => "/admin/upstream-models/" + id + "/adopt-modelsdev",
  upstreamModelsAdopt: "/admin/upstream-models/adopt-modelsdev",
  upstreamModelsModelsDevStatus: "/admin/upstream-models/modelsdev-status",
  myModels: "/admin/my/models",
  // ticket 08：每日状态检查结果 + 当前提醒（通知中心轮询）
  systemStatus: "/admin/system-status",
} as const;

export const api = {
  get: <T>(path: string, opts?: ApiOpts) => request<T>(path, { method: "GET", ...opts }),
  post: <T>(path: string, body?: unknown, opts?: ApiOpts) =>
    request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      ...opts,
    }),
  patch: <T>(path: string, body: unknown, opts?: ApiOpts) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body), ...opts }),
  put: <T>(path: string, body: unknown, opts?: ApiOpts) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body), ...opts }),
  del: <T>(path: string, opts?: ApiOpts) => request<T>(path, { method: "DELETE", ...opts }),
};
