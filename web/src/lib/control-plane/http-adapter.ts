/**
 * HTTP 适配器：把 control-plane 的 typed operations 落到真实 /admin API。
 *
 * 页面不 import 本文件的传输层细节；只通过组合根（control-plane/index.ts）拿到
 * 一个 ControlPlane。本文件同时承载：
 *  - 请求管道（fetch、超时、401 跳登录、失败反馈：查询去重进通知中心 / 写操作 toast）；
 *  - 各领域操作的真实实现（URL/query/body 组装、响应信封归一）；
 *  - 展示用控制面地址 API_BASE_LABEL。
 *
 * 本文件的 reportFailure/reportNetworkFailure 是 W6 票07「错误治理」的唯一接线点，
 * scripts/check-ui-foundation.mjs 会读本文件的语义断言。
 */

import { pushErrorNotificationOnce } from "@/lib/notification-store";
import { toast } from "@/lib/notify";

import type {
  AdoptModelsDevBatchResult,
  AdoptModelsDevResult,
  FlowReportOut,
  LogAttemptsOut,
  LogQuerySyntaxOut,
  HeatmapReportOut,
  LatencyReportOut,
  ModelsDevSnapshotStatus,
  ReportsOverviewOut,
  TimeseriesReportOut,
} from "@/generated/contract";
import type { LogDetail, LogListResponse, LogPayload } from "@/components/logs/types";
import type { LedgerEntry } from "@/components/governance/types";
import type { SettingsSchemaPayload } from "@/components/governance/settings-schema";
import type { MyModelOut, SelfPasswordChange } from "@/generated/contract";
import type {
  ApiKey,
  AuditLogList,
  AvailabilityRule,
  ConfigRevision,
  ConnectionInfo,
  ModelBatchResult,
  ModelTarget,
  MySpendResponse,
  PublicModel,
  PublicModelPrice,
  UpstreamModel,
  UserPreferences,
  UserTreeResponse,
  UserTreeNode,
} from "@/types";

import { apiErrorFromResponse, networkError, timeoutError, ApiError } from "./errors";
import type { ControlPlane } from "./operations";
import type { AvailabilityPatchResult, ModelListOptions, ModelsOperations } from "./operations/models";
import type { LogListQuery, LogsOperations } from "./operations/logs";
import type { BalanceResult, CreatedUser, DeleteUserResult, PasswordResetResult, UsersOperations } from "./operations/users";
import type { AdminIdentity, AuthOperations, LoginOutcome } from "./operations/auth";
import type { AuditsOperations } from "./operations/audits";
import type { PlaygroundOperations } from "./operations/playground";
import type { SystemOperations, SystemStatus } from "./operations/system";
import type { ClientKeysOperations, IssuedApiKey } from "./operations/client-keys";
import type { ApplyRevision, ConfigOperations } from "./operations/config";
import type { PricesOperations, PriceExportFile, UpstreamPriceInput, UpstreamPriceRow } from "./operations/prices";
import type {
  GovernanceOperations,
  GuardrailConfig,
  GuardrailsResponse,
  McpServersResponse,
  PoliciesResponse,
  PolicyConfig,
  ValidateResult,
} from "./operations/governance";
import type { PermissionGroup, RoleDefinition, RolesOperations } from "./operations/roles";
import type { SettingsOperations, SettingsResponse } from "./operations/settings";
import type {
  FlowQuery,
  HealthReport,
  HeatmapQuery,
  ReportWindow,
  ReportsOperations,
  RevisionLike,
  TimeseriesQuery,
} from "./operations/reports";
import type {
  KeyBatchDeleteResult,
  KeyTestResult,
  ModelProbeResponse,
  ProbeResultView,
  UpstreamRow,
  UpstreamsOperations,
} from "./operations/upstreams";
import { unwrapList, type ListEnvelope, type OperationOptions } from "./types";

/** 同源部署（单端口）时为 ""；独立前端部署或需要跨源时用 VITE_API_BASE 覆盖。 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";
/** 界面展示用的「控制面地址」：同源部署显示当前 origin，而不是空串。 */
export const API_BASE_LABEL: string =
  API_BASE || (typeof window === "undefined" ? "" : window.location.origin);

const DEFAULT_TIMEOUT_MS = 30_000;

/** 一次 HTTP 调用的描述：方法 + 已拼好的后端路径 + JSON body + 调用选项。 */
export interface HttpRequest {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  options?: OperationOptions;
}

/** 传输层接口：测试注入捕获实现，验证操作拼出的 method/path/body。 */
export type HttpRequester = <T>(request: HttpRequest) => Promise<T>;

/**
 * 失败反馈（W6 票07）：查询（GET）失败不再逐查询弹 toast——同因（code+message）
 * 只在通知中心记一条（去重见 notification-store），页面内联/空态照常渲染；
 * 写操作（非 GET）保留右上角 toast：用户刚做了一个动作，需要即时反馈。
 * request_id 进描述但不进去重键：后端每次请求都会生成新的 id。
 */
export function reportFailure(err: ApiError, isQuery: boolean): void {
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
export function reportNetworkFailure(title: string, description: string, isQuery: boolean): void {
  if (!isQuery) {
    toast.error(title, { description });
    return;
  }
  pushErrorNotificationOnce({ title, description, dedupeKey: "network|" + title });
}

/** 401 统一跳登录页并带回跳地址；登录页自身不跳，避免死循环。 */
function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign("/login?next=" + next);
}

/** 真实 fetch 管道：AbortController 透传 + 超时 + 错误归一 + 失败反馈。 */
export function createHttpRequester(options: { baseUrl?: string } = {}): HttpRequester {
  const baseUrl = options.baseUrl ?? API_BASE;
  return async function request<T>({ method, path, body, options: opts }: HttpRequest): Promise<T> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: external } = opts ?? {};
    const isQuery = method === "GET";
    const controller = new AbortController();
    if (external) {
      if (external.aborted) controller.abort(external.reason);
      else external.addEventListener("abort", () => controller.abort(external.reason), { once: true });
    }
    const timer =
      timeoutMs > 0 ? setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs) : 0;
    let res: Response;
    try {
      res = await fetch(baseUrl + path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        // httpOnly 会话 cookie 是唯一凭据；跨端口 Vite 源需要 include。
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      if (external?.aborted) throw error; // 外部取消（切区间/换页）：静默，由调用方处理
      if (controller.signal.aborted && controller.signal.reason instanceof DOMException) {
        const timeout = timeoutError(path, timeoutMs);
        reportNetworkFailure("请求超时", timeout.message, isQuery);
        throw timeout;
      }
      reportNetworkFailure(
        "无法连接控制面 API",
        String(baseUrl) + "（" + (error instanceof Error ? error.message : String(error)) + "）",
        isQuery,
      );
      throw networkError("无法连接控制面 API：" + String(baseUrl));
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 401) {
      const err = await apiErrorFromResponse(res);
      redirectToLogin();
      throw err;
    }
    if (!res.ok) {
      const err = await apiErrorFromResponse(res);
      reportFailure(err, isQuery);
      throw err;
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };
}

/** 上游渠道领域的 HTTP 实现。 */
export function createHttpUpstreams(request: HttpRequester): UpstreamsOperations {
  const base = "/admin/upstreams";
  const one = (id: string) => base + "/" + encodeURIComponent(id);
  const keys = (id: string) => one(id) + "/keys";
  return {
    list: async (opts) => {
      const payload = await request<UpstreamRow[] | ListEnvelope<UpstreamRow>>({ method: "GET", path: base, options: opts });
      return unwrapList(payload).items;
    },
    get: (id, opts) => request<UpstreamRow>({ method: "GET", path: one(id), options: opts }),
    create: (input) => request<UpstreamRow>({ method: "POST", path: base, body: input }),
    update: (id, input) => request<UpstreamRow>({ method: "PATCH", path: one(id), body: input }),
    remove: async (id) => {
      await request<unknown>({ method: "DELETE", path: one(id) });
    },
    batch: (input) => request({ method: "PATCH", path: base + "/batch", body: input }),
    discoverModels: (id, input) => request<ProbeResultView>({ method: "POST", path: one(id) + "/discover-models", body: input }),
    importModels: (id, input) => request({ method: "POST", path: one(id) + "/import-models", body: input }),
    listKeys: (id, opts) => request({ method: "GET", path: keys(id), options: opts }),
    createKey: (id, input) => request({ method: "POST", path: keys(id), body: input }),
    updateKey: (id, keyId, input) =>
      request({ method: "PATCH", path: keys(id) + "/" + encodeURIComponent(keyId), body: input }),
    removeKey: async (id, keyId) => {
      await request<unknown>({ method: "DELETE", path: keys(id) + "/" + encodeURIComponent(keyId) });
    },
    batchDeleteKeys: (id, input) =>
      request<KeyBatchDeleteResult>({ method: "POST", path: keys(id) + "/batch-delete", body: input }),
    testKeys: (id, input) => request<KeyTestResult>({ method: "POST", path: keys(id) + "/test", body: input }),
    probeModels: (id, input, opts) =>
      request<ModelProbeResponse>({ method: "POST", path: one(id) + "/models/probe", body: input, options: opts }),
    getTransforms: (id) => request({ method: "GET", path: one(id) + "/transforms" }),
    saveTransforms: (id, value) => request({ method: "PUT", path: one(id) + "/transforms", body: value }),
    previewTransforms: (id, value) => request({ method: "POST", path: one(id) + "/transforms/preview", body: value }),
  };
}

/** 模型域的 HTTP 实现。 */
export function createHttpModels(request: HttpRequester): ModelsOperations {
  const upstream = "/admin/upstream-models";
  const publicModels = "/admin/public-models";
  const rules = "/admin/availability-rules";
  const pageQuery = (options?: ModelListOptions) =>
    options?.pageSize ? "?page_size=" + String(options.pageSize) : "";
  const modelPath = (kind: "upstream" | "public", id: string) =>
    (kind === "upstream" ? upstream : publicModels) + "/" + encodeURIComponent(id);
  return {
    listUpstreamModels: async (options) => {
      const payload = await request<UpstreamModel[] | ListEnvelope<UpstreamModel>>({
        method: "GET",
        path: upstream + pageQuery(options),
        options: options as OperationOptions | undefined,
      });
      return unwrapList(payload).items;
    },
    updateUpstreamModel: (id, input) =>
      request<UpstreamModel>({ method: "PATCH", path: upstream + "/" + encodeURIComponent(id), body: input }),
    createUpstreamModel: (input) => request<UpstreamModel>({ method: "POST", path: upstream, body: input }),
    removeUpstreamModel: async (id) => {
      await request<unknown>({ method: "DELETE", path: upstream + "/" + encodeURIComponent(id) });
    },
    bulkUpstreamModels: (input) =>
      request<ModelBatchResult>({ method: "PATCH", path: upstream + "/batch", body: input }),
    adoptModelsDev: (id) =>
      request<AdoptModelsDevResult>({ method: "POST", path: upstream + "/" + encodeURIComponent(id) + "/adopt-modelsdev" }),
    adoptAllModelsDev: () => request<AdoptModelsDevBatchResult>({ method: "POST", path: upstream + "/adopt-modelsdev" }),
    modelsDevStatus: (options) =>
      request<ModelsDevSnapshotStatus>({ method: "GET", path: upstream + "/modelsdev-status", options }),

    listModelTargets: async (options) => {
      const payload = await request<ModelTarget[] | ListEnvelope<ModelTarget>>({
        method: "GET",
        path: "/admin/model-targets",
        options,
      });
      return unwrapList(payload).items;
    },

    listPublicModels: async (options) => {
      const payload = await request<PublicModel[] | ListEnvelope<PublicModel>>({
        method: "GET",
        path: publicModels + pageQuery(options),
        options: options as OperationOptions | undefined,
      });
      return unwrapList(payload).items;
    },
    createPublicModel: (input) => request<PublicModel>({ method: "POST", path: publicModels, body: input }),
    updatePublicModel: (id, input) =>
      request<PublicModel>({ method: "PATCH", path: publicModels + "/" + encodeURIComponent(id), body: input }),
    removePublicModel: async (id) => {
      await request<unknown>({ method: "DELETE", path: publicModels + "/" + encodeURIComponent(id) });
    },
    bulkPublicModels: (input) =>
      request<ModelBatchResult>({ method: "PATCH", path: publicModels + "/batch", body: input }),

    listRules: async (options) => {
      const payload = await request<AvailabilityRule[] | ListEnvelope<AvailabilityRule>>({
        method: "GET",
        path: rules + "?page_size=200",
        options,
      });
      return unwrapList(payload).items;
    },
    createRule: (input) => request<AvailabilityRule>({ method: "POST", path: rules, body: input }),
    updateRule: async (id, input) => {
      await request<unknown>({ method: "PATCH", path: rules + "/" + encodeURIComponent(id), body: input });
    },
    removeRule: async (id) => {
      await request<unknown>({ method: "DELETE", path: rules + "/" + encodeURIComponent(id) });
    },
    setAvailability: (kind, id, input) =>
      request<AvailabilityPatchResult>({ method: "PATCH", path: modelPath(kind, id), body: input }),
  };
}

/** 时间窗 → query：预设只传 range；自定义成对传 from_ms/to_ms（后端成对生效）。 */
function windowQuery(window: ReportWindow): string {
  const params = new URLSearchParams();
  if (window.kind === "range") {
    params.set("range", window.value);
  } else {
    params.set("range", "7d");
    params.set("from_ms", String(window.fromMs));
    params.set("to_ms", String(window.toMs));
  }
  return params.toString();
}

/** 报表域的 HTTP 实现。 */
export function createHttpReports(request: HttpRequester): ReportsOperations {
  return {
    overview: (window, options) => {
      const query = window.kind === "custom"
        ? "?from_ms=" + String(window.fromMs) + "&to_ms=" + String(window.toMs)
        : "";
      return request<ReportsOverviewOut>({ method: "GET", path: "/admin/reports/overview" + query, options });
    },
    timeseries: (query: TimeseriesQuery, options) => {
      const params = new URLSearchParams(windowQuery(query.window));
      params.set("dimension", query.dimension);
      if (query.metric === "money") params.set("metrics", "cost_micro,charge_micro");
      else params.set("metric", query.metric);
      return request<TimeseriesReportOut>({
        method: "GET",
        path: "/admin/reports/timeseries?" + params.toString(),
        options,
      });
    },
    latency: (window, options) => {
      const query = window ? "?" + windowQuery(window) : "";
      return request<LatencyReportOut>({ method: "GET", path: "/admin/reports/latency" + query, options });
    },
    heatmap: (query: HeatmapQuery, options) =>
      request<HeatmapReportOut>({
        method: "GET",
        path: "/admin/reports/heatmap?range=" + query.range + "&metric=" + query.metric,
        options,
      }),
    flow: (query: FlowQuery, options) => {
      const params = new URLSearchParams(windowQuery(query.window));
      params.set("metric", query.metric);
      const hidden = [...(query.collapse ?? [])].sort().join(",");
      if (hidden) params.set("collapse", hidden);
      if (query.focus?.trim()) params.set("focus", query.focus.trim());
      if (query.q?.trim()) params.set("q", query.q.trim());
      if (query.topN && query.topN > 0) params.set("top_n", String(query.topN));
      return request<FlowReportOut>({ method: "GET", path: "/admin/reports/flow?" + params.toString(), options });
    },
    health: (options) => request<HealthReport>({ method: "GET", path: "/admin/health", options }),
    revisions: async (limit, options) => {
      const rows = await request<RevisionLike[]>({
        method: "GET",
        path: "/admin/config/revisions?page_size=25&offset=0",
        options,
      });
      return rows.slice(0, limit);
    },
  };
}

/** 登录失败文案：JSON {message} 优先，纯文本取前 200 字。 */
async function loginFailureMessage(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const body = JSON.parse(raw) as { message?: string };
    if (body.message) return body.message;
  } catch {
    if (raw.trim()) return raw.trim().slice(0, 200);
  }
  return response.statusText || "登录失败";
}

/**
 * 控制台会话的 HTTP 实现：登录/退出沿用直连 fetch 语义（401 是业务结果，
 * 不能走通用请求层的「跳登录」分支），me 的 401/403 归一为 null。
 */
export function createHttpAuth(): AuthOperations {
  const base = API_BASE;
  return {
    login: async (username, password): Promise<LoginOutcome> => {
      try {
        const response = await fetch(base + "/admin/auth/login", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (!response.ok) return { kind: "error", message: await loginFailureMessage(response) };
        const payload = (await response.json()) as { user: AdminIdentity };
        return { kind: "ok", user: payload.user };
      } catch (error) {
        return {
          kind: "error",
          message: "无法连接控制面 API：" + base + "（" + String((error as Error).message) + "）",
        };
      }
    },
    me: async (): Promise<AdminIdentity | null> => {
      try {
        const response = await fetch(base + "/admin/auth/me", { credentials: "include" });
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok) return null;
        return (await response.json()) as AdminIdentity;
      } catch {
        return null;
      }
    },
    logout: async (): Promise<void> => {
      try {
        await fetch(base + "/admin/auth/logout", { method: "POST", credentials: "include" });
      } catch {
        // 网络失败时不阻塞前端退出；cookie 会在下次请求时过期。
      }
    },
  };
}

/** 用户/运营设置的 HTTP 实现。 */
export function createHttpSettings(request: HttpRequester): SettingsOperations {
  return {
    connection: (options) => request<ConnectionInfo>({ method: "GET", path: "/admin/connection", options }),
    preferences: (options) => request<UserPreferences>({ method: "GET", path: "/admin/auth/preferences", options }),
    savePreferences: (next) => request<UserPreferences>({ method: "PUT", path: "/admin/auth/preferences", body: next }),
    saveProfile: async (body) => {
      await request<unknown>({ method: "PATCH", path: "/admin/auth/me", body: { name: body.name } });
    },
    getSettings: (options) => request<SettingsResponse>({ method: "GET", path: "/admin/settings", options }),
    saveSettings: (values) =>
      request<{ values: Record<string, string> }>({ method: "PUT", path: "/admin/settings", body: { values } }),
    getSettingsSchema: (options) => request<SettingsSchemaPayload>({ method: "GET", path: "/admin/settings/schema", options }),
    changePassword: (body: SelfPasswordChange) =>
      request<{ ok: boolean; revoked_sessions: number }>({
        method: "POST",
        path: "/admin/auth/change-password",
        body,
      }),
    mySpend: (query, options) => {
      const params = new URLSearchParams({ range: query.range, scope: query.scope });
      return request<MySpendResponse>({ method: "GET", path: "/admin/bills/my-spend?" + params.toString(), options });
    },
  };
}

/** 价目（ADR-020）的 HTTP 实现。 */
export function createHttpPrices(request: HttpRequester): PricesOperations {
  return {
    upstreamPrices: (options) =>
      request<UpstreamPriceRow[]>({ method: "GET", path: "/admin/prices/upstream?page_size=200", options }),
    addUpstreamPrice: (body: UpstreamPriceInput) =>
      request<UpstreamPriceRow>({ method: "POST", path: "/admin/prices/upstream", body }),
    publicModelPrices: (options) =>
      request<PublicModelPrice[]>({ method: "GET", path: "/admin/prices/public-models", options }),
    exportPrices: (options) => request<PriceExportFile>({ method: "GET", path: "/admin/prices/export", options }),
    importPrices: (body) =>
      request<{ changed: number; skipped?: number }>({ method: "POST", path: "/admin/prices/import", body }),
  };
}

/** 网关策略三文档（ADR-023 #3）的 HTTP 实现。 */
export function createHttpGovernance(request: HttpRequester): GovernanceOperations {
  return {
    policies: (options) => request<PoliciesResponse>({ method: "GET", path: "/admin/policies", options }),
    savePolicies: (config: PolicyConfig) =>
      request<PoliciesResponse>({ method: "PUT", path: "/admin/policies", body: { config } }),
    resetPolicies: () => request<PoliciesResponse>({ method: "DELETE", path: "/admin/policies" }),
    guardrails: (options) => request<GuardrailsResponse>({ method: "GET", path: "/admin/guardrails", options }),
    saveGuardrails: (config: GuardrailConfig) =>
      request<GuardrailsResponse>({ method: "PUT", path: "/admin/guardrails", body: { config } }),
    resetGuardrails: () => request<GuardrailsResponse>({ method: "DELETE", path: "/admin/guardrails" }),
    mcpServers: (options) => request<McpServersResponse>({ method: "GET", path: "/admin/mcp-servers", options }),
    saveMcpServers: (config) => request<McpServersResponse>({ method: "PUT", path: "/admin/mcp-servers", body: config }),
    validatePolicies: (config) =>
      request<ValidateResult>({ method: "POST", path: "/admin/policies/validate", body: { config } }),
    validateGuardrails: (config) =>
      request<ValidateResult>({ method: "POST", path: "/admin/guardrails/validate", body: { config } }),
    validateMcp: (config) => request<ValidateResult>({ method: "POST", path: "/admin/mcp-servers/validate", body: config }),
  };
}

/** 配置版本与下发（ticket 07 链路终点）的 HTTP 实现。 */
export function createHttpConfig(request: HttpRequester): ConfigOperations {
  return {
    revisions: (options) => {
      const path = "/admin/config/revisions" + (options?.limit ? "?limit=" + String(options.limit) : "");
      return request<ConfigRevision[]>({ method: "GET", path, options });
    },
    rollback: (id) => request<ConfigRevision>({ method: "POST", path: "/admin/config/rollback/" + encodeURIComponent(id) }),
    apply: (reason) =>
      request<ApplyRevision>({ method: "POST", path: "/admin/config/apply", body: reason ? { reason } : {} }),
  };
}

/** 角色与权限注册表（ADR-023 #4）的 HTTP 实现。 */
export function createHttpRoles(request: HttpRequester): RolesOperations {
  const base = "/admin/roles";
  return {
    list: async (options) => {
      const payload = await request<{ items: RoleDefinition[]; total: number }>({ method: "GET", path: base, options });
      return payload.items;
    },
    permissions: async (options) => {
      const payload = await request<{ groups: PermissionGroup[] }>({ method: "GET", path: "/admin/permissions", options });
      return payload.groups;
    },
    create: (body) => request<RoleDefinition>({ method: "POST", path: base, body }),
    update: (id, body) => request<RoleDefinition>({ method: "PATCH", path: base + "/" + encodeURIComponent(id), body }),
    remove: (id) => request<void>({ method: "DELETE", path: base + "/" + encodeURIComponent(id) }),
  };
}

/** 连接密钥（ADR-023）的 HTTP 实现。 */
export function createHttpClientKeys(request: HttpRequester): ClientKeysOperations {
  const base = "/admin/api-keys";
  const one = (id: string) => base + "/" + encodeURIComponent(id);
  return {
    list: (options) => request<ApiKey[]>({ method: "GET", path: base + "?page_size=200&offset=0", options }),
    issue: (userId, body) =>
      request<IssuedApiKey>({ method: "POST", path: "/admin/users/" + encodeURIComponent(userId) + "/api-keys", body }),
    setStatus: (id, body) => request<ApiKey>({ method: "PATCH", path: one(id) + "/status", body }),
    rename: (id, body) => request<ApiKey>({ method: "PATCH", path: one(id), body }),
    rotate: (id) => request<{ key: string }>({ method: "POST", path: one(id) + "/rotate", body: {} }),
    remove: (id) => request<void>({ method: "DELETE", path: one(id) }),
    reveal: (id) => request<{ key: string }>({ method: "POST", path: one(id) + "/reveal", body: {} }),
  };
}

/** 用户表（ADR-019）的 HTTP 实现；流水首页大小沿用页面既有口径 100。 */
export function createHttpUsers(request: HttpRequester): UsersOperations {
  const one = (id: string) => "/admin/users/" + encodeURIComponent(id);
  return {
    list: (options) => request<UserTreeNode[]>({ method: "GET", path: "/admin/users", options }),
    tree: (options) => request<UserTreeResponse>({ method: "GET", path: "/admin/users/tree", options }),
    create: (body) => request<CreatedUser>({ method: "POST", path: "/admin/users", body }),
    update: (id, body) => request<UserTreeNode>({ method: "PATCH", path: one(id), body }),
    remove: (id) => request<DeleteUserResult>({ method: "DELETE", path: one(id) }),
    resetPassword: (id, body) => request<PasswordResetResult>({ method: "PUT", path: one(id) + "/password", body }),
    topup: (id, body) => request<BalanceResult>({ method: "POST", path: one(id) + "/balance", body }),
    adjust: (id, body) => request<BalanceResult>({ method: "POST", path: one(id) + "/balance/adjust", body }),
    ledger: (id, options) =>
      request<LedgerEntry[]>({ method: "GET", path: one(id) + "/ledger?page_size=100&offset=0", options }),
  };
}

/** 使用日志域的 HTTP 实现。 */
export function createHttpLogs(request: HttpRequester): LogsOperations {
  const base = "/admin/logs";
  const one = (eventId: string) => base + "/" + encodeURIComponent(eventId);
  return {
    list: (query: LogListQuery, options) => {
      const params = new URLSearchParams({
        query: query.query,
        page_size: String(query.pageSize),
        offset: String(query.offset),
        sort: query.sort,
        order: query.order,
      });
      if (query.fromMs !== undefined) params.set("from_ms", String(query.fromMs));
      if (query.toMs !== undefined) params.set("to_ms", String(query.toMs));
      if (query.hasError !== undefined) params.set("has_error", String(query.hasError));
      return request<LogListResponse>({ method: "GET", path: base + "?" + params.toString(), options });
    },
    detail: (eventId, options) => request<LogDetail>({ method: "GET", path: one(eventId), options }),
    payload: (eventId, options) => request<LogPayload>({ method: "GET", path: one(eventId) + "/payload", options }),
    attempts: (eventId, options) => request<LogAttemptsOut>({ method: "GET", path: one(eventId) + "/attempts", options }),
    querySyntax: (options) => request<LogQuerySyntaxOut>({ method: "GET", path: base + "/query-syntax", options }),
  };
}

/** 审计域的 HTTP 实现。 */
export function createHttpAudits(request: HttpRequester): AuditsOperations {
  return {
    list: (query, options) => {
      const params = new URLSearchParams({
        limit: String(query.limit),
        offset: String(query.offset),
      });
      if (query.actor) params.set("actor", query.actor);
      if (query.action) params.set("action", query.action);
      return request<AuditLogList>({ method: "GET", path: "/admin/audit-logs?" + params.toString(), options });
    },
  };
}

/** Playground 非 chat 操作的 HTTP 实现（chat 流式请求留待 W5 票05）。 */
export function createHttpPlayground(request: HttpRequester): PlaygroundOperations {
  return {
    myModels: (options) => request<MyModelOut[]>({ method: "GET", path: "/admin/my/models", options }),
  };
}

/** 系统状态域的 HTTP 实现。 */
export function createHttpSystem(request: HttpRequester): SystemOperations {
  return {
    status: (options) => request<SystemStatus>({ method: "GET", path: "/admin/system-status", options }),
  };
}

/** 组合出真实 HTTP 后端上的 ControlPlane；测试可注入捕获版 request。 */
export function createHttpControlPlane(deps: { request?: HttpRequester } = {}): ControlPlane {
  const request = deps.request ?? createHttpRequester();
  return {
    upstreams: createHttpUpstreams(request),
    models: createHttpModels(request),
    reports: createHttpReports(request),
    logs: createHttpLogs(request),
    users: createHttpUsers(request),
    clientKeys: createHttpClientKeys(request),
    roles: createHttpRoles(request),
    auth: createHttpAuth(),
    settings: createHttpSettings(request),
    config: createHttpConfig(request),
    governance: createHttpGovernance(request),
    prices: createHttpPrices(request),
    audits: createHttpAudits(request),
    playground: createHttpPlayground(request),
    system: createHttpSystem(request),
  };
}
