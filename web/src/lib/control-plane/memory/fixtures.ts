// 演示状态：部分 export let 由内存适配器的命令操作（登录/策略保存等）重写，fixtures 只给初始值。
/* eslint-disable prefer-const -- 演示状态会被命令操作重写 */
import type {
  AdminAccount, ApiKey, AuditLog, AvailabilityRule, ChargePrice, ChargeEntry, ConfigRevision,
  CostEntry, ModelTarget, MyModelOut, OverviewStats,
  PublicModel, PublicModelPrice, SettingItem, UnpricedList, Upstream,
  UpstreamModel, UpstreamPrice, UpstreamTransforms, UserPreferences, UserTreeNode,
} from "@/types";
// 页面契约类型（gateway-policies 三 Tab / 角色管理）：只做类型引用不产生运行时依赖
import type {
  GuardrailConfig, GuardrailsResponse, McpServerConfig, McpServersResponse,
  PoliciesResponse, PolicyConfig,
} from "@/lib/control-plane/operations/governance";
import type { RoleDefinition } from "@/lib/control-plane/operations/roles";
import type { LogAttemptsOut } from "@/generated/contract";
import type { LedgerEntry } from "@/components/governance/types";

/**
 * Mock 数据开关：只有显式设置 VITE_MOCK=1 才启用（默认关闭，全部走真实 /admin 接口）。
 * 离线开发 / 演示：`VITE_MOCK=1 npm run dev`；生产构建不设置即真实数据。
 */


/** mock 会话：登录成功置 true，退出置 false；刷新页面即回到未登录（演示足够）。 */
export let mockLoggedIn = false;
/** 与后端管理用户角色一致：mock 会话默认拥有全部权限，前端只做显隐不做安全边界。 */
export const MOCK_ALL_PERMISSIONS = [
  "upstreams:read", "upstreams:write",
  "upstream_models:read", "upstream_models:write", "public_models:read", "public_models:write",
  "model_targets:read", "model_targets:write", "availability:read", "availability:write",
  "transforms:read", "transforms:write", "config:read", "config:write", "settings:read",
  "settings:write", "audits:read", "policies:read", "policies:write", "prices:read", "prices:write",
  "billing:cost", "billing:spend", "billing:subtree", "ledger:read", "logs:read",
  "logs:pull", "reports:read", "users:read", "users:create", "users:update", "users:delete",
  "apikeys:read", "apikeys:write", "admins:read", "admins:write", "roles:read", "roles:write",
  "playground:use",
];
export const MOCK_ADMIN = {
  id: "adm_mock",
  username: "admin",
  name: "张三",
  role: "admin",
  status: "active",
  permissions: MOCK_ALL_PERMISSIONS,
  expires_at: "2026-11-18T00:00:00",
};
/** 客户镜像（l05_service/rbac.py _CUSTOMER_PERMISSIONS）：只读 + 己方花费 + 模型试验。 */
export const MOCK_CUSTOMER_PERMISSIONS = [
  "upstreams:read", "upstream_models:read", "public_models:read",
  "model_targets:read", "availability:read", "transforms:read", "config:read",
  "settings:read", "audits:read", "policies:read", "prices:read",
  "billing:spend", "reports:read", "users:read", "apikeys:read", "admins:read",
  "roles:read", "playground:use",
];
/** 受限演示账号（W4-E 验收：无 users:update/users:delete/ledger:read/roles:write 的显隐对照）。 */
export const MOCK_CUSTOMER = {
  id: "adm_mock_user",
  username: "user01",
  name: "李四",
  role: "customer",
  status: "active",
  permissions: MOCK_CUSTOMER_PERMISSIONS,
  expires_at: "2026-11-18T00:00:00",
};
/** 当前 mock 会话身份：登录时按账号切换。 */
export let mockSession: typeof MOCK_ADMIN | typeof MOCK_CUSTOMER = MOCK_ADMIN;

/** 登录/退出要切换会话：导入方不能直接赋值 export let，统一经此写回。 */
export function setMockSession(session: typeof MOCK_ADMIN | typeof MOCK_CUSTOMER): void {
  mockSession = session;
}

export function setMockLoggedIn(value: boolean): void {
  mockLoggedIn = value;
}

/** ADR-023 #6：名称由连接地址生成（host:port 折叠 [a-z0-9-]，默认端口去掉），重名加 -N。 */
export function upstreamNameFromBaseUrl(baseUrl: string, existing: Upstream[]): string {
  let host = baseUrl.replace(/^\w+:\/\//, "").split("/")[0] ?? "";
  try {
    const url = new URL(baseUrl);
    host = url.hostname;
    const drop = (url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443");
    if (url.port !== "" && !drop) host += ":" + url.port;
  } catch { /* 保留原样折叠 */ }
  const stem = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "upstream";
  let name = stem;
  let suffix = 2;
  while (existing.some((row) => row.name === name)) {
    name = stem + "-" + String(suffix);
    suffix += 1;
  }
  return name;
}

/** 实测 /admin/upstreams 形状：名称由 base_url 生成（ADR-023 #6）；alias 为 t04 展示名 */
export const upstreams: Upstream[] = [
  { id: "up_01", name: "zai-01", alias: "", base_url: "https://open.bigmodel.cn/api/paas/v4", api_style: "openai_chat", transforms: null, max_buffer_bytes: 2097152, enabled: true, created_at_ms: Date.parse("2026-11-01T09:00:00") },
  { id: "up_02", name: "or-01", alias: "", base_url: "https://openrouter.ai/api/v1", api_style: "openai_chat", transforms: null, max_buffer_bytes: 2097152, enabled: true, created_at_ms: Date.parse("2026-11-01T09:01:00") },
  { id: "up_03", name: "nebula-01", alias: "", base_url: "https://api.nebula.example/v1", api_style: "anthropic_messages", transforms: null, max_buffer_bytes: 2097152, enabled: false, created_at_ms: Date.parse("2026-11-01T09:02:00") },
];

export const upstreamModels: UpstreamModel[] = [
  { id: "um_01", upstream_id: "up_01", name: "glm-5.3", model_type: "chat", enabled: true, created_at_ms: Date.parse("2026-11-01T09:00:00"), upstream_name: "zai-01", cost_input_per_1m: "2.500000", cost_output_per_1m: "10.000000", markup: "1.2000" },
  { id: "um_02", upstream_id: "up_01", name: "glm-5.3-flash", model_type: "chat", enabled: true, created_at_ms: Date.parse("2026-11-01T09:00:00"), upstream_name: "zai-01", cost_input_per_1m: "0.300000", cost_output_per_1m: "1.200000", markup: "1.5000" },
  { id: "um_03", upstream_id: "up_01", name: "embedding-4", model_type: "embedding", enabled: true, created_at_ms: Date.parse("2026-11-01T09:00:00"), upstream_name: "zai-01", cost_input_per_1m: "0.050000", cost_output_per_1m: "0.000000", markup: "1.0000" },
  { id: "um_04", upstream_id: "up_02", name: "deepseek/v5-chat", model_type: "chat", enabled: true, created_at_ms: Date.parse("2026-11-02T09:00:00"), upstream_name: "or-01", cost_input_per_1m: null, cost_output_per_1m: null, markup: "1.0000" },
  { id: "um_05", upstream_id: "up_02", name: "qwen/max-next", model_type: "chat", enabled: false, created_at_ms: Date.parse("2026-11-02T09:00:00"), upstream_name: "or-01", cost_input_per_1m: "1.200000", cost_output_per_1m: "4.800000", markup: "1.1000" },
];

export const publicModels: PublicModel[] = [
  { id: "pm_01", name: "glm-5.3", routing_mode: "failover", note: "主力对话", enabled: true, created_at_ms: Date.parse("2026-11-05T10:00:00") },
  { id: "pm_02", name: "glm-flash", routing_mode: "weighted", note: "轻量对话", enabled: true, created_at_ms: Date.parse("2026-11-06T10:00:00") },
  { id: "pm_03", name: "embed-v4", routing_mode: "conditional", note: null, enabled: false, created_at_ms: Date.parse("2026-11-07T10:00:00") },
];

/** W4-H：GET /admin/my/models 的演示数据（启用公开模型 → 成员参数合集，无金额键）。 */
export const myModels: MyModelOut[] = [
  {
    name: "glm-5.3",
    model_type: "chat",
    sources: ["glm-5.3", "deepseek/v5-chat"],
    parameters: {
      max_input_tokens: 200_000,
      max_output_tokens: 128_000,
      reasoning_level: "high",
      reasoning_levels: ["default", "none", "low", "medium", "high", "xhigh"],
      default_reasoning_level: "medium",
      input_types: ["text", "image"],
      output_types: ["text"],
      tool_call: true,
      reasoning: true,
      attachment: false,
      structured_output: true,
    },
  },
  {
    name: "glm-flash",
    model_type: "chat",
    sources: ["glm-5.3-flash"],
    parameters: {
      max_input_tokens: 1_000_000,
      max_output_tokens: 131_072,
      reasoning_level: "",
      reasoning_levels: [],
      default_reasoning_level: "",
      input_types: ["text"],
      output_types: ["text"],
      tool_call: true,
      reasoning: false,
      attachment: false,
      structured_output: false,
    },
  },
];

export const modelTargets: ModelTarget[] = [
  { id: "mt_01", public_model_id: "pm_01", upstream_model_id: "um_01", upstream_model_name: "glm-5.3", upstream_name: "智谱直连", priority: 1, weight: null, when: null, enabled: true },
  { id: "mt_02", public_model_id: "pm_01", upstream_model_id: "um_04", upstream_model_name: "deepseek/v5-chat", upstream_name: "OpenRouter 聚合", priority: 2, weight: null, when: null, enabled: true },
  { id: "mt_03", public_model_id: "pm_02", upstream_model_id: "um_02", upstream_model_name: "glm-5.3-flash", upstream_name: "智谱直连", priority: null, weight: 12000, when: null, enabled: true },
  { id: "mt_04", public_model_id: "pm_03", upstream_model_id: "um_03", upstream_model_name: "embedding-4", upstream_name: "智谱直连", priority: null, weight: null, when: 'request.user_tier == "trial"', enabled: true },
];
export let mtSeq = 4;

export const clientKeys: ApiKey[] = [
  { id: "ak_01", user_id: "eu_01", mask: "sk-…G7H8", key_suffix: "G7H8", status: "active", created_at_ms: Date.parse("2026-11-01T10:00:00") },
  { id: "ak_02", user_id: "eu_02", mask: "sk-…R5S6", key_suffix: "R5S6", status: "active", created_at_ms: Date.parse("2026-11-10T14:30:00") },
  { id: "ak_03", user_id: "eu_03", mask: "sk-…Z3A4", key_suffix: "Z3A4", status: "disabled", created_at_ms: Date.parse("2026-10-20T09:00:00") },
];

/**
 * mock 模式日志行：结构镜像 components/logs/types.ts 的 LogRow（lib 不反向 import
 * components），供 /admin/logs 的排序/筛选/分页演示（W6 补桩）。
 */
export interface MockLogRow {
  event_id: string;
  correlation_key: string;
  started_at_ms: number;
  completed_at_ms: number;
  duration_ms: number;
  time_to_first_token_ms: number;
  http_status: number;
  public_model: string;
  requested_model: string;
  upstream_model: string;
  upstream_model_id: string;
  target_priority: number | null;
  provider: string;
  user_id: string;
  user_name: string;
  api_key_id: string;
  api_key_label: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cache_ratio: number | null;
  throughput_tps: number | null;
  attempts_count: number;
  has_attempts: boolean;
  last_failure_status: number | null;
  last_failure_error_type: string;
  last_failure_error_message: string;
  is_stream: boolean;
  has_error: boolean;
  has_payload: boolean;
  error: string;
  cost_micro: number | null;
  margin_micro: number | null;
  charge_micro: number | null;
  currency: string;
  estimate: boolean;
}

export const MOCK_LOG_START_MS = Date.parse("2026-11-03T08:00:00");
export const MOCK_LOG_MODELS = ["glm-5.3", "glm-4.6", "qwen-max"];
export const MOCK_LOG_PEOPLE = [
  { id: "eu_01", name: "内部平台" },
  { id: "eu_02", name: "数据分析组" },
  { id: "eu_03", name: "试用-临时" },
];
export const MOCK_LOG_KEYS = ["sk-…G7H8", "sk-…R5S6", "sk-…Z3A4"];
export const MOCK_LOG_UPSTREAMS = ["zai-01", "or-01", "host-01"];

export const mockLogs: MockLogRow[] = Array.from({ length: 36 }, (_, i) => {
  const person = MOCK_LOG_PEOPLE[i % 3]!;
  const model = MOCK_LOG_MODELS[i % 3]!;
  const started_at_ms = MOCK_LOG_START_MS + i * 7 * 3600_000 + (i % 5) * 600_000;
  const duration_ms = 320 + ((i * 977) % 4200);
  const is_stream = i % 2 === 0;
  const failed = i % 9 === 5;
  const input_tokens = 900 + ((i * 613) % 6000);
  const output_tokens = 120 + ((i * 271) % 900);
  const cache_read_tokens = i % 3 === 0 ? 400 + ((i * 331) % 1500) : 0;
  const cache_write_tokens = i % 4 === 0 ? 200 + ((i * 173) % 800) : 0;
  const cache_total = input_tokens + cache_read_tokens + cache_write_tokens;
  const cost_micro = failed ? null : 4200 + i * 913;
  const charge_micro = failed ? null : 5200 + i * 1177;
  // M5-b：成功行里挑一部分带关联键（两轮失败→成功 / 三轮），失败行与其余行留空，
  // 用来验证「无关联键不渲染路由链」分支。
  // ticket 04：i===5 是失败但带尝试链的行——行级错误摘要由最后一次失败尝试补齐；
  // 其余失败行没有 attempts，验证「无链路记录」降级。
  const correlation_key = failed
    ? i === 5
      ? "cor_m5b_failed"
      : ""
    : i % 4 === 0
      ? "cor_m5b_retry"
      : i % 7 === 0
        ? "cor_m5b_three"
        : "";
  const attempts_count =
    correlation_key === "cor_m5b_three" || correlation_key === "cor_m5b_failed"
      ? 3
      : correlation_key
        ? 2
        : 0;
  // ticket 04：带尝试链的失败行不再由 mock 拼 UI 摘要，只给 rowErrorText 所需的事实字段。
  const failedStatus = failed ? (i % 2 === 0 ? 500 : 502) : 200;
  const chainFailure = correlation_key === "cor_m5b_failed";
  return {
    event_id: "mev_" + String(1000 + i),
    correlation_key,
    attempts_count,
    has_attempts: correlation_key.length > 0,
    last_failure_status: chainFailure ? failedStatus : null,
    last_failure_error_type: chainFailure ? String(failedStatus) : "",
    last_failure_error_message: chainFailure ? (failedStatus === 502 ? "bad gateway" : "internal error") : "",
    started_at_ms,
    completed_at_ms: started_at_ms + duration_ms,
    duration_ms,
    time_to_first_token_ms: is_stream ? 220 + ((i * 149) % 700) : 0,
    http_status: failedStatus,
    public_model: model,
    // 历史行/缺失归一时没有请求模型；i%6===0 的行模拟旧行，展示「—」降级。
    requested_model: i % 6 === 0 ? "" : model,
    upstream_model: model,
    upstream_model_id: "um_0" + String((i % 3) + 1),
    target_priority: 1,
    provider: MOCK_LOG_UPSTREAMS[i % 3]!,
    user_id: person.id,
    user_name: person.name,
    api_key_id: "ak_0" + String((i % 3) + 1),
    api_key_label: MOCK_LOG_KEYS[i % 3]!,
    input_tokens,
    output_tokens,
    total_tokens: input_tokens + output_tokens,
    cache_read_tokens,
    cache_write_tokens,
    cache_ratio: cache_total > 0 ? Math.round((cache_read_tokens / cache_total) * 1000) / 10 : null,
    throughput_tps: output_tokens > 0 && duration_ms > 300 ? Math.round(output_tokens / ((duration_ms - 300) / 1000)) : null,
    is_stream,
    has_error: failed,
    has_payload: !failed && i % 5 === 0,
    // 带尝试链的失败行只保留原始日志文本（mock 无原文 → 空串），摘要由前端 rowErrorText 拼装。
    error: failed && !chainFailure ? (i % 2 === 0 ? "upstream 500: internal error" : "upstream 502: bad gateway") : "",
    cost_micro,
    margin_micro: cost_micro === null || charge_micro === null ? null : charge_micro - cost_micro,
    charge_micro,
    currency: "CNY",
    estimate: true,
  };
});

/** /admin/logs 的筛选（关键词 + model:/upstream:/user:/key:/status:/stream:/latency>/ttft>/cache>）、排序、分页，行为对齐 routers_ops.search_logs。 */
export function queryMockLogs(params: URLSearchParams): { total: number; items: MockLogRow[]; next_offset: number | null } {
  let rows = mockLogs.slice();
  const query = (params.get("query") ?? "").trim();
  if (query) {
    const tokens = query.split(/\s+/).filter(Boolean);
    rows = rows.filter((row) =>
      tokens.every((token) => {
        const m = /^(model|upstream|user|key|status|stream|latency|ttft|cache)([:><])(.+)$/i.exec(token);
        if (!m) {
          const kw = token.toLowerCase();
          return (
            row.public_model.toLowerCase().includes(kw) ||
            row.upstream_model.toLowerCase().includes(kw) ||
            row.user_name.toLowerCase().includes(kw) ||
            row.api_key_label.toLowerCase().includes(kw) ||
            row.event_id.toLowerCase().includes(kw)
          );
        }
        const field = m[1]!.toLowerCase();
        const op = m[2]!;
        const value = m[3]!.toLowerCase();
        if (field === "model") {
          return row.public_model.toLowerCase().includes(value) || row.upstream_model.toLowerCase().includes(value);
        }
        if (field === "upstream") {
          return row.provider.toLowerCase().includes(value) || row.upstream_model.toLowerCase().includes(value);
        }
        if (field === "user") {
          return row.user_id.toLowerCase().includes(value) || row.user_name.toLowerCase().includes(value);
        }
        if (field === "key") {
          return row.api_key_id.toLowerCase().includes(value) || row.api_key_label.toLowerCase().includes(value);
        }
        if (field === "status") {
          if (/^\dxx$/.test(value)) return String(row.http_status).startsWith(value[0]!);
          return row.http_status === Number(value);
        }
        if (field === "stream") return row.is_stream === (value === "true");
        const num = Number(m[3]);
        if (!Number.isFinite(num)) return true;
        if (field === "latency") return op === ">" ? row.duration_ms > num : row.duration_ms < num;
        if (field === "ttft") return row.time_to_first_token_ms > num;
        if (field === "cache") return (row.cache_ratio ?? 0) > num;
        return true;
      }),
    );
  }
  const hasError = params.get("has_error");
  if (hasError === "true") rows = rows.filter((r) => r.has_error);
  else if (hasError === "false") rows = rows.filter((r) => !r.has_error);
  const fromMs = Number(params.get("from_ms") ?? 0);
  const toMs = Number(params.get("to_ms") ?? 0);
  if (fromMs) rows = rows.filter((r) => r.started_at_ms >= fromMs);
  if (toMs) rows = rows.filter((r) => r.started_at_ms < toMs);
  const sort = params.get("sort") ?? "started_at";
  const dir = params.get("order") === "asc" ? 1 : -1;
  const keyOf = (r: MockLogRow): number =>
    sort === "duration_ms"
      ? r.duration_ms
      : sort === "total_tokens"
        ? r.total_tokens
        : sort === "cost_micro"
          ? (r.cost_micro ?? -1)
          : sort === "charge_micro"
            ? (r.charge_micro ?? -1)
            : r.started_at_ms;
  rows.sort((a, b) => (keyOf(a) - keyOf(b)) * dir);
  const total = rows.length;
  const pageSize = Math.min(200, Math.max(1, Number(params.get("page_size") ?? 50)));
  const offset = Math.max(0, Number(params.get("offset") ?? 0));
  return {
    total,
    items: rows.slice(offset, offset + pageSize),
    next_offset: offset + pageSize < total ? offset + pageSize : null,
  };
}

/**
/**
 * ADR-028：日志详情路由链的两条演示尝试链（按关联键索引，路由再补 event_id）。
 * cor_m5b_retry：第 1 轮 500 → 第 2 轮 200（跨 zai-01 → or-01）；
 * cor_m5b_three：第 1/2 轮 503/500 → 第 3 轮 200。
 */
export const MOCK_TRACE_BASE_MS = Date.parse("2026-11-17T01:04:59");
export const mockAttempts: Record<string, LogAttemptsOut> = {
  cor_m5b_retry: {
    event_id: "",
    correlation_key: "cor_m5b_retry",
    attempts: [
      {
        attempt: 1,
        upstream_id: "ups_zai",
        upstream_name: "zai-01",
        upstream_key_seq: 1,
        model: "glm-5.3",
        status_code: 500,
        error_type: "500",
        error_message: "upstream returned 500",
        duration_ms: 60,
        outcome: "error",
        started_at_ms: MOCK_TRACE_BASE_MS + 12,
      },
      {
        attempt: 2,
        upstream_id: "ups_or",
        upstream_name: "or-01",
        upstream_key_seq: 1,
        model: "glm-5.3",
        status_code: 200,
        error_type: "",
        error_message: "",
        duration_ms: 85,
        outcome: "ok",
        started_at_ms: MOCK_TRACE_BASE_MS + 85,
      },
    ],
  },
  cor_m5b_three: {
    event_id: "",
    correlation_key: "cor_m5b_three",
    attempts: [
      {
        attempt: 1,
        upstream_id: "ups_zai",
        upstream_name: "zai-01",
        upstream_key_seq: 1,
        model: "glm-flash",
        status_code: 503,
        error_type: "503",
        error_message: "upstream unavailable",
        duration_ms: 48,
        outcome: "error",
        started_at_ms: MOCK_TRACE_BASE_MS + 3_600_010,
      },
      {
        attempt: 2,
        upstream_id: "ups_zai",
        upstream_name: "zai-01",
        upstream_key_seq: 1,
        model: "glm-flash",
        status_code: 500,
        error_type: "500",
        error_message: "upstream returned 500",
        duration_ms: 52,
        outcome: "error",
        started_at_ms: MOCK_TRACE_BASE_MS + 3_600_070,
      },
      {
        attempt: 3,
        upstream_id: "ups_or",
        upstream_name: "or-01",
        upstream_key_seq: 1,
        model: "glm-flash",
        status_code: 200,
        error_type: "",
        error_message: "",
        duration_ms: 140,
        outcome: "ok",
        started_at_ms: MOCK_TRACE_BASE_MS + 3_600_135,
      },
    ],
  },
  // ticket 04：失败但带尝试链的行——最后一轮 502 是行级错误摘要的来源。
  cor_m5b_failed: {
    event_id: "",
    correlation_key: "cor_m5b_failed",
    attempts: [
      {
        attempt: 1,
        upstream_id: "ups_zai",
        upstream_name: "zai-01",
        upstream_key_seq: 1,
        model: "glm-5.3",
        status_code: 500,
        error_type: "500",
        error_message: "upstream returned 500",
        duration_ms: 55,
        outcome: "error",
        started_at_ms: MOCK_TRACE_BASE_MS + 7_200_005,
      },
      {
        attempt: 2,
        upstream_id: "ups_zai",
        upstream_name: "zai-01",
        upstream_key_seq: 1,
        model: "glm-5.3",
        status_code: 503,
        error_type: "503",
        error_message: "upstream unavailable",
        duration_ms: 60,
        outcome: "error",
        started_at_ms: MOCK_TRACE_BASE_MS + 7_200_070,
      },
      {
        attempt: 3,
        upstream_id: "ups_or",
        upstream_name: "or-01",
        upstream_key_seq: null,
        model: "glm-5.3",
        status_code: 502,
        error_type: "502",
        error_message: "bad gateway",
        duration_ms: 70,
        outcome: "error",
        started_at_ms: MOCK_TRACE_BASE_MS + 7_200_140,
      },
    ],
  },
};

export const availabilityRules: AvailabilityRule[] = [
  { id: "ar_01", kind: "ban", scope: "model_target", scope_id: "mt_01", recurrence: "once", expires_at_ms: null, schedule_json: null, note: "连续超时，人工关闭待查", created_at_ms: Date.parse("2026-11-17T08:00:00") },
  { id: "ar_02", kind: "cooldown", scope: "model_target", scope_id: "mt_02", recurrence: "once", expires_at_ms: Date.parse("2026-11-17T02:30:00"), schedule_json: null, note: "429 限流自动冷却", created_at_ms: Date.parse("2026-11-17T01:30:00") },
  { id: "ar_03", kind: "cooldown", scope: "upstream", scope_id: "up_02", recurrence: "daily", expires_at_ms: null, schedule_json: JSON.stringify({ windows: [{ start: "22:00", end: "06:00" }] }), note: "每日 22:00-06:00 例行维护", created_at_ms: Date.parse("2026-11-15T09:00:00") },
];

export const billingRequests: CostEntry[] = Array.from({ length: 12 }, (_, i) => {
  const modelIds = ["um_01", "um_02", "um_04"];
  const modelId = modelIds[i % 3]!;
  const unpriced = i === 3;
  const free = i === 7;
  return {
    id: "ce_" + String(5000 + i),
    gateway_event_id: "gev_" + String(9000 + i),
    upstream_model_id: modelId,
    input_tokens: 380 + i * 41,
    output_tokens: 74 + i * 13,
    amount_micro: unpriced ? 0 : 6200 + i * 1450,
    currency: "CNY",
    price_version_id: unpriced ? null : "pv_20261101",
    status: unpriced ? "unpriced" : free ? "free" : "ok",
  };
});

export const revenueRows: ChargeEntry[] = Array.from({ length: 14 }, (_, i) => {
  const users = ["eu_01", "eu_02", "eu_03"];
  const pms = ["pm_01", "pm_02", "pm_03"];
  const unpriced = i === 5;
  const free = i === 9;
  return {
    id: "ch_" + String(7000 + i),
    gateway_event_id: "gev_" + String(9000 + i),
    user_id: users[i % 3]!,
    public_model_id: pms[i % 3]!,
    input_tokens: 380 + i * 41,
    output_tokens: 74 + i * 13,
    amount_micro: unpriced ? 0 : free ? 0 : 7440 + i * 1740,
    currency: "CNY",
    price_version_id: unpriced ? null : "pv_20261101",
    status: unpriced ? "unpriced" : free ? "free" : "ok",
  };
});

export const upstreamPrices: UpstreamPrice[] = [
  { id: "upr_01", upstream_model_id: "um_01", item: "input", unit_price_micro: 2000000, currency: "CNY", effective_from_ms: Date.parse("2026-11-01T00:00:00"), version: 3 },
  { id: "upr_02", upstream_model_id: "um_01", item: "output", unit_price_micro: 8000000, currency: "CNY", effective_from_ms: Date.parse("2026-11-01T00:00:00"), version: 3 },
  { id: "upr_03", upstream_model_id: "um_02", item: "input", unit_price_micro: 300000, currency: "CNY", effective_from_ms: Date.parse("2026-11-01T00:00:00"), version: 1 },
  { id: "upr_04", upstream_model_id: "um_02", item: "output", unit_price_micro: 1200000, currency: "CNY", effective_from_ms: Date.parse("2026-11-01T00:00:00"), version: 1 },
  { id: "upr_05", upstream_model_id: "um_04", item: "input", unit_price_micro: 270000, currency: "USD", effective_from_ms: Date.parse("2026-10-15T00:00:00"), version: 2 },
  { id: "upr_06", upstream_model_id: "um_04", item: "output", unit_price_micro: 1090000, currency: "USD", effective_from_ms: Date.parse("2026-10-15T00:00:00"), version: 2 },
  { id: "upr_07", upstream_model_id: "um_03", item: "request", unit_price_micro: 1000, currency: "USD", effective_from_ms: Date.parse("2026-10-15T00:00:00"), version: 1 },
];

export const chargePrices: ChargePrice[] = [
  { id: "cp_01", public_model: "glm-5.3", item: "input", mode: "markup", value: 12000, currency: "CNY", effective_from: "2026-11-01T00:00:00", version: 2 },
  { id: "cp_02", public_model: "glm-5.3", item: "output", mode: "markup", value: 12000, currency: "CNY", effective_from: "2026-11-01T00:00:00", version: 2 },
  { id: "cp_03", public_model: "glm-flash", item: "input", mode: "markup", value: 15000, currency: "CNY", effective_from: "2026-11-01T00:00:00", version: 1 },
  { id: "cp_04", public_model: "embed-v4", item: "request", mode: "fixed", value: 500000, currency: "CNY", effective_from: "2026-11-05T00:00:00", version: 1 },
];

export const unpricedRows: UnpricedList = {
  cost: [
    { id: "ce_5020", gateway_event_id: "gev_9020", upstream_model_id: "um_90", input_tokens: 912, output_tokens: 233, amount_micro: 0, currency: "CNY", price_version_id: null, status: "unpriced" },
  ],
  charge: [
    { id: "ch_7015", gateway_event_id: "gev_9015", user_id: "eu_02", public_model_id: "pm_90", input_tokens: 22100, output_tokens: 1902, amount_micro: 0, currency: "CNY", price_version_id: null, status: "unpriced" },
  ],
};

export const configRevisions: ConfigRevision[] = [
  { id: "cr_03", artifact_hash: "h3f9a2c1e5", adapter_id: "openai-chat", operator: "admin", reason: "新增 embed-v4 目标", status: "active", previous_revision_id: "cr_02", created_at_ms: Date.parse("2026-11-17T01:05:12") },
  { id: "cr_02", artifact_hash: "h7b1e8d0f2", adapter_id: "openai-chat", operator: "admin", reason: "OpenRouter 密钥更换", status: "superseded", previous_revision_id: "cr_01", created_at_ms: Date.parse("2026-11-16T15:40:00") },
  { id: "cr_01", artifact_hash: "h5c0a9f2d8", adapter_id: "openai-chat", operator: "admin", reason: "校验失败", status: "failed", error_detail: "数据面校验失败：未知字段 model_aliases", previous_revision_id: null, created_at_ms: Date.parse("2026-11-16T15:12:44") },
];

export const auditLogs: AuditLog[] = [
  { id: "al_01", actor: "admin", action: "config.apply", target: "rev_20261117_03", created_at: "2026-11-17T01:05:12", detail: "下发成功，hash h3f9a2c1" },
  { id: "al_02", actor: "admin", action: "client_key.create", target: "ck_02", created_at: "2026-11-16T18:22:03", detail: "创建密钥 数据分析组" },
  { id: "al_03", actor: "admin", action: "config.rollback", target: "rev_20261116_01", created_at: "2026-11-16T15:12:44", detail: "热加载确认超时，自动回滚" },
];

// —— 网关策略三文档（ADR-023；契约 docs/api-contract.md §2.6，shape = lib/policies.ts 页面模型） ——
// 与后端一致：默认值镜像 l05_service/policy_store.py，存储文档可变，保存走 PUT、恢复默认走 DELETE。
export const POLICY_PROTECTED_HEADERS = [
  "api-key", "authorization", "content-length", "content-type", "cookie",
  "host", "set-cookie", "x-api-key", "x-request-id",
];

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  cors: {
    enabled: false,
    allow_origins: [],
    allow_credentials: false,
    expose_headers: ["x-request-id"],
    allow_methods: [],
    allow_headers: [],
    max_age: null,
  },
  api_key: { enabled: true, mode: "strict" },
  local_rate_limit: { requests_per_minute: null, tokens_per_minute: null },
  timeout: { request_timeout: "", backend_request_timeout: "", response_idle_timeout: "" },
  transformations: {
    default_response_header_deletes: ["server", "x-powered-by"],
    protected_request_headers: POLICY_PROTECTED_HEADERS,
  },
  retry: null,
  health: null,
};

/** 演示存储文档：与默认略有差异（CORS 开 + 超时已配），让只读视图与编辑草稿都有内容可改。 */
export let policyConfig: PolicyConfig = {
  ...structuredClone(DEFAULT_POLICY_CONFIG),
  cors: {
    enabled: true,
    allow_origins: ["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials: false,
    expose_headers: ["x-request-id"],
    allow_methods: [],
    allow_headers: [],
    max_age: null,
  },
  timeout: { request_timeout: "60s", backend_request_timeout: "55s", response_idle_timeout: "30s" },
};
export let policyUpdatedAt = Date.parse("2026-11-17T01:05:12");

/** 保存策略文档要写回 export let，统一经此函数。 */
export function setPolicyConfig(next: PolicyConfig): void {
  policyConfig = next;
  policyUpdatedAt = Date.now();
}

/**
 * mock 数据面能力声明（票05 能力词表中性键；W6 ticket 06 起不再复制具体适配器矩阵）。
 * 与真实前端同一条消费路径：能力与文案经 API 响应的 CapabilityInfo 出参到达页面，
 * mock 模式里 mock 扮演数据面，note 是 mock 自有的中性 copy（FakeAdapter 的 "fake: ..."
 * 惯例同理）；版本元数据用 mock 自己的版本，不借数据面版本号。
 */
export const MOCK_VERSION = "mock-1.0.0";

export const MOCK_POLICY_CAPABILITIES: PoliciesResponse["capabilities"] = {
  cors: { supported: true, verified: false, since_version: MOCK_VERSION, note: "mock 数据面 CORS（显式配置才渲染）" },
  api_key: { supported: true, verified: true, since_version: MOCK_VERSION, note: "mock：密钥哈希校验，mode: strict；enabled=false 时整段不渲染（匿名）" },
  local_rate_limit: { supported: true, verified: true, since_version: MOCK_VERSION, note: "mock：全局规则限流；无逐用户词元上限（E12）" },
  timeout: { supported: true, verified: false, since_version: MOCK_VERSION, note: "mock：请求/后端/响应空闲三段超时" },
  transformations: { supported: true, verified: true, since_version: MOCK_VERSION, note: "mock：条件改写仅全局配置支持" },
  retry: { supported: true, verified: true, since_version: MOCK_VERSION, note: "mock：请求内重试渲染为顶层策略；全局策略段拒绝 retry（E16/E17）" },
  health: { supported: true, verified: true, since_version: MOCK_VERSION, note: "mock：逐模型健康标记与驱逐；retry codes 含 4xx 时必须成对（E16/E17）" },
  request_attempts: { supported: true, verified: true, since_version: MOCK_VERSION, note: "mock：适配器内部采集每次上游尝试，归一化为 RequestAttempt；系统只存尝试事实（ADR-028）" },
  guardrails_regex: { supported: true, verified: true, since_version: MOCK_VERSION, note: "mock：regex mask/reject/audit + 内置敏感信息规则" },
  guardrails_webhook: { supported: true, verified: true, since_version: MOCK_VERSION, note: "webhook 护栏仅 reject/audit，target 只能 host（无路径），不支持 scope" },
};

/** 后端 NOTES（routers_policies.py）原文：页级各分区卡的 description。 */
export const POLICY_NOTES: Record<string, string> = {
  cors: "控制面 CORS 由 SLIPSTREAM_CORS_ORIGINS 决定；此处的 enabled 控制数据面 llm.policies.cors",
  api_key: "enabled=false 表示数据面匿名放行（不渲染 llm.policies.apiKey），密钥仍保留在台账",
  rate_limit: "请求级限流为全局规则；预付费余额由控制面账本执行，不渲染逐用户桶（E12）",
  timeout: "humantime 字符串（如 60s/500ms）；留空表示不渲染该字段",
  retry: "请求内重试渲染为顶层 policies[]（target route internal/llm:request），attempts 为首次之后的尝试次数（>=2 才能跨层 failover）；codes 含 4xx 时必须同时配置 health（unhealthy_expression + consecutive_failures）",
  health: "逐模型健康标记与驱逐（llm.models[].health）；表达式单独配置不会驱逐主层（E16/E17），必须带 consecutive_failures >= 1",
  transformations: "默认响应头删除按 ADR-010 追加在用户规则之后；保护头仅控制面记录",
  guardrails_webhook: "webhook 护栏仅 reject/audit，target 只能是 host（无路径），不支持 scope",
  mcp_http: "数据面拒收 http 变体；只支持 sse/stdio，http 会在保存时被 422 拒绝",
};

/** effective 是下发前的可读预览（l05_service/policy_store.py policy_effective 同构）。 */
export function policyEffective(config: PolicyConfig): PoliciesResponse["effective"] {
  return {
    cors: {
      enabled: config.cors.enabled,
      allow_origins: config.cors.enabled ? [...config.cors.allow_origins] : [],
      allow_credentials: config.cors.enabled && config.cors.allow_credentials,
    },
    key_auth: {
      enabled: config.api_key.enabled,
      mode: config.api_key.mode,
      scheme: "Authorization: Bearer sk-...",
      storage: "unsalted sha256(key) key_hash（E11）",
      failure: "认证失败返回纯文本 401 authentication failed（E4）",
    },
    local_rate_limit: {
      key: "apiKey.user_id",
      type: "tokens",
      requests_per_minute: config.local_rate_limit.requests_per_minute,
      tokens_per_minute: config.local_rate_limit.tokens_per_minute,
      semantics: "预付费：余额即初始词元桶，永不回填；网关重启桶清零，台账才是权威（E10/E12）",
    },
    transforms_defaults: {
      response_header_deletes: [...config.transformations.default_response_header_deletes],
      protected_request_headers: [...config.transformations.protected_request_headers].sort(),
      body_editable_paths: "any path, model/stream included (operator owns the risk)",
    },
    routing: {
      modes: ["failover", "weighted", "conditional"],
      note: "priority 数值小者优先；weighted 按权重比例；conditional 用 CEL 兜底",
    },
    timeout:
      config.timeout.request_timeout || config.timeout.backend_request_timeout || config.timeout.response_idle_timeout
        ? { ...config.timeout }
        : null,
    guardrails: {
      streaming: guardrailConfig.streaming,
      request: guardrailConfig.request.length,
      response: guardrailConfig.response.length,
    },
    retry: config.retry ? { attempts: config.retry.attempts, codes: [...config.retry.codes], backoff: config.retry.backoff } : null,
    health: config.health ? { ...config.health } : null,
  };
}

export function policyPayload(): PoliciesResponse {
  return {
    config: structuredClone(policyConfig),
    defaults: structuredClone(DEFAULT_POLICY_CONFIG),
    effective: policyEffective(policyConfig),
    counts: {
      upstreams: upstreams.length,
      public_models: publicModels.length,
      api_keys_active: clientKeys.filter((k) => k.status === "active").length,
      users: mockUsers.filter((u) => u.status !== "deleted").length,
    },
    capabilities: MOCK_POLICY_CAPABILITIES,
    notes: POLICY_NOTES,
    updated_at_ms: policyUpdatedAt,
  };
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = { streaming: "Disabled", request: [], response: [] };

export let guardrailConfig: GuardrailConfig = {
  streaming: "Disabled",
  request: [
    {
      kind: "regex",
      action: "mask",
      rules: [{ pattern: "", builtin: "ssn" }],
      scope: ["messages"],
      rejection_status: 0,
      rejection_body: "",
      webhook_target: "",
      failure_mode: "failClosed",
    },
  ],
  response: [],
};
export let guardrailUpdatedAt = Date.parse("2026-11-17T01:05:12");

/** 保存护栏文档要写回 export let，统一经此函数。 */
export function setGuardrailConfig(next: GuardrailConfig): void {
  guardrailConfig = next;
  guardrailUpdatedAt = Date.now();
}

/** 完整能力矩阵（护栏 Tab 的「能力矩阵」表格数据，沿用三期矩阵条目）。 */
export const GUARDRAIL_ITEMS = [
  { key: "routing.priority_failover", supported: true, since_version: "1.7.0", note: "分层故障转移", verified: false },
  { key: "routing.weighted", supported: true, since_version: "1.7.0", note: "加权路由 (ADR-014)", verified: false },
  { key: "routing.conditional", supported: true, since_version: "1.7.0", note: "条件路由 CEL (ADR-014)", verified: false },
  { key: "auth.api_key_static", supported: true, since_version: "1.7.0", note: "静态密钥表", verified: false },
  { key: "observe.request_log", supported: true, since_version: "1.7.0", note: "请求日志落自身 SQLite", verified: false },
  { key: "config.hot_reload", supported: true, since_version: "1.7.0", note: "热加载；在飞影响待 P0-R2", verified: false },
  { key: "usage.read_events", supported: true, since_version: "1.7.0", note: "SQLite 只读增量", verified: false },
  { key: "health.eviction_params", supported: false, since_version: "", note: "健康驱逐参数不可配（简化模式，仅默认行为说明）", verified: false },
  { key: "backends.session_affinity", supported: false, since_version: "", note: "会话亲和仅 backends 层级，简化模式不可配", verified: false },
  { key: "health.fine_policies", supported: false, since_version: "", note: "精细健康策略仅 backends 层级，简化模式不可配", verified: false },
];

export function guardrailPayload(): GuardrailsResponse {
  return {
    config: structuredClone(guardrailConfig),
    defaults: structuredClone(DEFAULT_GUARDRAIL_CONFIG),
    adapter: "agentgateway",
    items: GUARDRAIL_ITEMS,
    capabilities: {
      regex: MOCK_POLICY_CAPABILITIES.guardrails_regex,
      webhook: MOCK_POLICY_CAPABILITIES.guardrails_webhook,
    },
    note: "supported=False 为路线图说明而非今日可配置；verified=False 表示尚未经数据面实测",
    updated_at_ms: guardrailUpdatedAt,
  };
}

/** MCP 文档 {servers, port}；transports 是 mock 数据面自有的能力声明（同 policy 端口路径）。 */
export let mcpConfig: { servers: McpServerConfig[]; port: number | null } = {
  servers: [
    {
      name: "docs-sse",
      transport: "sse",
      host: "https://mcp.example",
      url: "",
      port: 443,
      path: "/sse",
      cmd: "",
      args: [],
      env: {},
    },
  ],
  port: null,
};
export let mcpUpdatedAt = Date.parse("2026-11-17T01:05:12");

/** 保存 MCP 文档要写回 export let，统一经此函数。 */
export function setMcpConfig(next: { servers: McpServerConfig[]; port: number | null }): void {
  mcpConfig = next;
  mcpUpdatedAt = Date.now();
}

export const MOCK_MCP_TRANSPORTS: McpServersResponse["transports"] = {
  sse: { supported: true, verified: true, since_version: MOCK_VERSION, note: "sse target 使用 host" },
  stdio: { supported: true, verified: true, since_version: MOCK_VERSION, note: "mock：stdio target 走 cmd/args/env/clear_env" },
  http: { supported: false, verified: true, since_version: "", note: "mock：http 传输未支持，保存时会被 422 拒绝" },
};

export function mcpPayload(): McpServersResponse {
  return {
    servers: structuredClone(mcpConfig.servers),
    port: mcpConfig.port,
    defaults: { servers: [], port: null },
    supported: true,
    transports: MOCK_MCP_TRANSPORTS,
    note: "mock：顶层 mcp 配置支持 sse/stdio（http 保存时会被 422 拒绝）；targets 由 MCP 配置生成",
    updated_at_ms: mcpUpdatedAt,
  };
}

export const settings: SettingItem[] = [
  { key: "base_currency", value: "CNY", label: "基准币", updated_at: "2026-11-15T09:00:00" },
  { key: "timezone", value: "Asia/Shanghai", label: "展示时区", updated_at: "2026-11-15T09:00:00" },
  { key: "log_retention_days", value: "30", label: "请求日志保留", updated_at: "2026-11-15T09:00:00" },
  { key: "audit_retention_days", value: "180", label: "审计日志保留", updated_at: "2026-11-15T09:00:00" },
  { key: "default_tokens_per_minute", value: "60000", label: "默认词元限速（每密钥）", updated_at: "2026-11-15T09:00:00" },
  { key: "default_concurrency", value: "8", label: "默认并发上限（每密钥）", updated_at: "2026-11-15T09:00:00" },
  { key: "gateway_base_url", value: "", label: "公网连接地址", updated_at: "2026-11-15T09:00:00" },
  { key: "gateway_artifact_path", value: "/etc/slipstream/ag.yaml", label: "下发配置落盘路径", updated_at: "2026-11-15T09:00:00" },
  { key: "usage_poll_interval_s", value: "30", label: "用量拉取周期（秒）", updated_at: "2026-11-15T09:00:00" },
  { key: "client_key_length", value: "64", label: "连接密钥长度档位", updated_at: "2026-11-16T10:00:00" },
  { key: "price_version", value: "pv_20261101", label: "当前计价快照", updated_at: "2026-11-01T00:00:00" },
];

/** 与 l05_service/settings_schema.py 同形；演示时由 mock 路由下发。 */
export const settingsSchema = {
  groups: [
    {
      key: "money",
      title: "计量与货币",
      description: "账本与用量一律按整数 micro 记账；本币种只影响报表与账单展示。",
      fields: [{
        key: "base_currency", label: "基准币",
        description: "报表与账单的展示币种。USD 仅用于展示，请求级强制仍按账本 micro 记账。",
        kind: "select", default: "CNY", unit: "", min: null, max: null,
        options: [{ value: "CNY", label: "CNY 人民币" }, { value: "USD", label: "USD 美元" }],
      }],
    },
    {
      key: "time",
      title: "时区与时间",
      description: "入库时间统一毫秒 epoch；这里只决定界面与报表的渲染时区。",
      fields: [{
        key: "timezone", label: "展示时区",
        description: "影响报表日期切分与时间展示，不改变入库时间戳。",
        kind: "select", default: "Asia/Shanghai", unit: "", min: null, max: null,
        options: [
          { value: "Asia/Shanghai", label: "Asia/Shanghai（UTC+8）" },
          { value: "Asia/Singapore", label: "Asia/Singapore（UTC+8）" },
          { value: "Asia/Tokyo", label: "Asia/Tokyo（UTC+9）" },
          { value: "UTC", label: "UTC" },
        ],
      }],
    },
    {
      key: "logs",
      title: "日志与留存",
      description: "请求日志、审计与账本的保留周期；超期数据按天滚动清理。",
      fields: [
        { key: "log_retention_days", label: "请求日志保留", description: "usage_events / 请求日志的保留天数。", kind: "number", default: "30", unit: "天", min: 1, max: 365, options: [] },
        { key: "audit_retention_days", label: "审计日志保留", description: "审计与账本属于合规数据，默认保留更久。", kind: "number", default: "180", unit: "天", min: 7, max: 3650, options: [] },
      ],
    },
    {
      key: "limits",
      title: "默认限流参数",
      description: "新建连接密钥 / 用户时的默认限流；单个密钥可在连接密钥页覆盖。",
      fields: [
        { key: "default_tokens_per_minute", label: "默认词元限速（每密钥）", description: "新建密钥默认的词元每分钟配额；0 表示不限制。", kind: "number", default: "60000", unit: "词元 / min", min: 0, max: 1000000, options: [] },
        { key: "default_concurrency", label: "默认并发上限（每密钥）", description: "新建密钥默认的并发请求上限；0 表示不限制。", kind: "number", default: "8", unit: "并发", min: 0, max: 1000, options: [] },
      ],
    },
    {
      key: "connection",
      title: "连接地址",
      description: "所有控制台用户共用的接入地址；留空跟随浏览器当前 host + 3600 端口。",
      fields: [{
        key: "gateway_base_url", label: "公网连接地址",
        description: "留空 = 自动取浏览器当前 host + 3600；必须 http(s) 且带主机名，不能含账号密码/查询参数/锚点。",
        kind: "text", default: "", unit: "", min: null, max: null, options: [],
      }],
    },
  ],
};

export const overview: OverviewStats = {
  requests: 12846,
  input_tokens: 18422300,
  output_tokens: 2415800,
  charge_micro: 51350800,
  cost_micro: 38501200,
  margin_micro: 12849600,
  currency: "CNY",
  latency_p50_ms: 842,
  latency_p95_ms: 3120,
  ttft_p50_ms: 391,
  estimate_note: "近似值：按价目快照折算",
};

export const sampleTransforms: UpstreamTransforms = {
  request_headers: [{ op: "update", name: "x-trace", value: "slipstream", conditions: [] }],
  request_body: [
    {
      op: "update", path: "temperature", value: "0.2",
      conditions: [{ field: "model", mode: "full", value: "glm-5.3" }],
    },
    // 体 copy 的 wire 字段是 source_path → target_path（path 不参与编译）。
    { op: "copy", source_path: "temperature", target_path: "top_p", conditions: [] },
  ],
  response_headers: [],
  response_body: [],
};

/** 旧 /admin/admins mock（ADR-019 后由统一用户表取代）：仅保留读取桩，角色键与 admin_roles 对齐。 */
export const adminAccounts: AdminAccount[] = [
  { id: "ad_01", username: "legacy-admin", role: "admin", enabled: true, created_at: "2026-10-01T08:00:00", last_login_at: "2026-11-17T02:00:00" },
  { id: "ad_02", username: "ops-admin", role: "admin", enabled: true, created_at: "2026-10-12T08:00:00", last_login_at: "2026-11-16T23:30:00" },
  { id: "ad_03", username: "audit-viewer", role: "customer", enabled: false, created_at: "2026-11-01T08:00:00", last_login_at: null },
];

/**
 * ADR-019 统一用户表（GET /admin/users 与 /admin/users/tree 同行形，见 UserTreeNode）。
 * 每个用户都是登录账号（W7）：username 非空即表示可登录，没有「无登录帐户」的行。
 */
export const mockUsers: UserTreeNode[] = [
  { id: "eu_01", name: "内部平台", username: "internal", balance_micro: 1148659200, role: "admin", parent_user_id: null, status: "active", depth: 0, direct_children: 3, subtree_size: 5, created_at_ms: Date.parse("2026-11-01T10:00:00"), updated_at_ms: Date.parse("2026-11-17T01:22:00") },
  { id: "eu_02", name: "数据分析组", username: "data-team", balance_micro: 480000000, role: "reseller", parent_user_id: "eu_01", status: "active", depth: 1, direct_children: 1, subtree_size: 2, created_at_ms: Date.parse("2026-11-10T14:30:00"), updated_at_ms: Date.parse("2026-11-12T09:00:00") },
  { id: "eu_03", name: "试用-临时", username: "trial", balance_micro: 0, role: "customer", parent_user_id: "eu_02", status: "disabled", depth: 2, direct_children: 0, subtree_size: 1, created_at_ms: Date.parse("2026-10-20T09:00:00"), updated_at_ms: Date.parse("2026-11-14T18:00:00") },
  { id: "eu_04", name: "分销代理", username: "agent", balance_micro: 230000000, role: "reseller", parent_user_id: "eu_01", status: "active", depth: 1, direct_children: 0, subtree_size: 1, created_at_ms: Date.parse("2026-11-05T11:00:00"), updated_at_ms: Date.parse("2026-11-05T11:00:00") },
  { id: "eu_05", name: "华东代理", username: "east-agent", balance_micro: 960000000, role: "customer", parent_user_id: "eu_01", status: "active", depth: 1, direct_children: 0, subtree_size: 1, created_at_ms: Date.parse("2026-11-15T08:20:00"), updated_at_ms: Date.parse("2026-11-15T08:20:00") },
];

/** mock 用户序号：创建新用户时递增（id eu_NN）。 */
export let mockUserSeq = mockUsers.length;

/** 创建用户时取下一个 id；写回序号只能经由 fixtures，导入方不可直接赋值。 */
export function nextMockUserId(): string {
  mockUserSeq += 1;
  return "eu_" + String(mockUserSeq).padStart(2, "0");
}

/** ADR-019：没填登录帐户时按用户名称派生，重名追加 -2 后缀（与后端 _resolve_username 同口径）。 */
export function deriveMockUsername(name: string): string {
  const base = (name.trim() || "user").slice(0, 120);
  let candidate = base;
  let suffix = 2;
  while (mockUsers.some((user) => user.username === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

// —— 角色管理（ADR-023 #4；契约 docs/api-contract.md：GET/POST/PATCH/DELETE /admin/roles） ——
// 内存 admin_roles：与 lib/roles.ts 的 RoleDefinition 模型同形；member_count 按 mockUsers 实时计算，
// 与后端 roles.member_count 同口径（删除有成员的角色会被拒）。
export const MOCK_RESELLER_PERMISSIONS = [...MOCK_CUSTOMER_PERMISSIONS, "users:create", "users:update", "billing:subtree"];
/** 后端保留键：内置角色（l05_service/rbac.py RESERVED_ROLE_KEYS）；旧名不再保留 alias。 */
export const RESERVED_ROLE_KEYS = new Set(["admin", "customer", "reseller"]);

export const adminRoles: RoleDefinition[] = [
  {
    id: "rol_admin",
    key: "admin",
    name: "管理用户",
    description: "拥有全部权限，可维护角色、管理用户与所有配置",
    builtin: true,
    all_permissions: true,
    permissions: [...MOCK_ALL_PERMISSIONS],
    member_count: 0,
  },
  {
    id: "rol_customer",
    key: "customer",
    name: "客户",
    description: "只读查看，可看自己的花费并试用模型",
    builtin: true,
    all_permissions: false,
    permissions: [...MOCK_CUSTOMER_PERMISSIONS],
    member_count: 0,
  },
  {
    id: "rol_reseller",
    key: "reseller",
    name: "分销商",
    description: "在客户基础上可创建下级并查看子树花费",
    builtin: true,
    all_permissions: false,
    permissions: MOCK_RESELLER_PERMISSIONS,
    member_count: 0,
  },
  // 自定义角色示例：角色管理页用它演示「编辑/删除」入口（内置角色只有只读的「查看权限」）
  {
    id: "rol_custom_viewer",
    key: "custom_viewer",
    name: "运营观察员",
    description: "示例自定义角色：只读权限子集，可编辑或删除",
    builtin: false,
    all_permissions: false,
    permissions: MOCK_CUSTOMER_PERMISSIONS.slice(0, 12),
    member_count: 0,
  },
];

/** 行内权限排序 + 成员数实时化（后端 role_payload 同构）。 */
export function rolePayload(row: RoleDefinition): RoleDefinition {
  return {
    ...row,
    permissions: [...row.permissions].sort(),
    member_count: mockUsers.filter((u) => u.status !== "deleted" && u.role === row.key).length,
  };
}

export function roleFromId(roleId: string): RoleDefinition {
  const row = adminRoles.find((r) => r.id === roleId);
  if (!row) throw new Error("角色不存在: " + roleId);
  return row;
}

export function ledgerFor(userId: string): LedgerEntry[] {
  const base = 1200000000;
  return [
    { id: userId + "-lg1", kind: "topup", delta_micro: 1000000000, balance_after_micro: base, currency: "CNY", ref_type: null, ref_id: null, note: "充值", created_by: "admin", created_at_ms: Date.parse("2026-11-15T09:00:00") },
    { id: userId + "-lg2", kind: "charge", delta_micro: -28650200, balance_after_micro: base - 28650200, currency: "CNY", ref_type: "usage", ref_id: "gev_9001", note: "调用计费", created_by: "system", created_at_ms: Date.parse("2026-11-16T10:12:00") },
    { id: userId + "-lg3", kind: "charge", delta_micro: -15650400, balance_after_micro: base - 44300600, currency: "CNY", ref_type: "usage", ref_id: "gev_9002", note: "调用计费", created_by: "system", created_at_ms: Date.parse("2026-11-16T20:40:00") },
    { id: userId + "-lg4", kind: "charge", delta_micro: -7040200, balance_after_micro: base - 51340800, currency: "CNY", ref_type: "usage", ref_id: "gev_9003", note: "调用计费", created_by: "system", created_at_ms: Date.parse("2026-11-17T01:22:00") },
  ];
}

/** 用户偏好（GET/PUT /admin/auth/preferences）：mock 会话内可变，演示顶栏/设置页主题服务端持久化。 */
export let mockPreferences: UserPreferences = {
  theme: "system",
  notify_email: true,
  notify_browser: false,
  notify_weekly: true,
  bio: "",
};

/** 偏好保存要写回 export let，统一经此函数。 */
export function setMockPreferences(next: UserPreferences): void {
  mockPreferences = next;
}

/** mock 一次性初始密码：随机生成，仅演示 ADR-019「仅显示一次」。 */
export function mockOneTimePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
  let out = "";
  for (let i = 0; i < 12; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** 公开模型列表视图：按契约默认内嵌 targets[]（服务端按 priority 升序）。 */
export function publicModelsView(): PublicModel[] {
  return publicModels.map((publicModel) => ({
    ...publicModel,
    target_count: modelTargets.filter((target) => target.public_model_id === publicModel.id).length,
    targets: modelTargets
      .filter((target) => target.public_model_id === publicModel.id)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
  }));
}

/** 公开模型价格 = 成员有效单价（成本 × 倍率）加权平均；与后端 pricing.public_model_price_rows 同口径。 */
export function derivePublicModelPrices(): PublicModelPrice[] {
  return publicModels.map((publicModel) => {
    const targets = modelTargets.filter(
      (target) => target.public_model_id === publicModel.id && target.enabled,
    );
    const basis: "weight" | "equal" =
      publicModel.routing_mode === "weighted" ? "weight" : "equal";
    let inputWeight = 0;
    let outputWeight = 0;
    let inputTotal = 0;
    let outputTotal = 0;
    let pricedMembers = 0;
    for (const target of targets) {
      const member = upstreamModels.find((model) => model.name === target.upstream_model_name);
      if (!member) continue;
      const weight = basis === "weight" ? Number(target.weight ?? 0) : 1;
      const markup = Number(member.markup ?? "1");
      if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(markup) || markup <= 0) {
        continue;
      }
      const input = member.cost_input_per_1m == null ? null : Number(member.cost_input_per_1m);
      const output = member.cost_output_per_1m == null ? null : Number(member.cost_output_per_1m);
      if (input === null && output === null) continue;
      pricedMembers += 1;
      if (input !== null && Number.isFinite(input)) {
        inputTotal += input * markup * weight;
        inputWeight += weight;
      }
      if (output !== null && Number.isFinite(output)) {
        outputTotal += output * markup * weight;
        outputWeight += weight;
      }
    }
    const available = pricedMembers > 0 && (inputWeight > 0 || outputWeight > 0);
    return {
      public_model_id: publicModel.id,
      name: publicModel.name,
      routing_mode: publicModel.routing_mode,
      currency: "CNY",
      price_input_per_1m: inputWeight > 0 ? (inputTotal / inputWeight).toFixed(6) : null,
      price_output_per_1m: outputWeight > 0 ? (outputTotal / outputWeight).toFixed(6) : null,
      priced_members: pricedMembers,
      total_members: targets.length,
      weight_basis: basis,
      available,
      reason: available ? "" : basis === "weight" ? "weights_zero" : "no_priced_members",
      read_only: true,
    };
  });
}

