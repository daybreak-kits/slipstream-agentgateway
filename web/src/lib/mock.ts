import type {
  AdminAccount, ApiKey, AuditLog, AvailabilityRule, ChargePrice, ChargeEntry, ConfigRevision,
  CostEntry, ModelTarget, MyModelOut, OverviewStats,
  PublicModel, PublicModelPrice, SettingItem, TransformPreviewResult, UnpricedList, Upstream,
  UpstreamModel, UpstreamPrice, UpstreamTransforms, UserPreferences, UserTreeNode, Vendor,
} from "../types";
// 页面契约类型（gateway-policies 三 Tab / 角色管理）：只做类型引用不产生运行时依赖
import type {
  GuardrailConfig, GuardrailsResponse, McpServerConfig, McpServersResponse,
  PoliciesResponse, PolicyConfig,
} from "./policies";
import type { RoleDefinition } from "./roles";
import type { LogAttemptsOut } from "@/generated/contract";

/**
 * Mock 数据开关：只有显式设置 VITE_MOCK=1 才启用（默认关闭，全部走真实 /admin 接口）。
 * 离线开发 / 演示：`VITE_MOCK=1 npm run dev`；生产构建不设置即真实数据。
 */
export const useMock: boolean = ["1", "true"].includes(String(import.meta.env.VITE_MOCK ?? ""));

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** mock 会话：登录成功置 true，退出置 false；刷新页面即回到未登录（演示足够）。 */
let mockLoggedIn = false;
/** 与后端管理用户角色一致：mock 会话默认拥有全部权限，前端只做显隐不做安全边界。 */
const MOCK_ALL_PERMISSIONS = [
  "vendors:read", "vendors:write", "upstreams:read", "upstreams:write",
  "upstream_models:read", "upstream_models:write", "public_models:read", "public_models:write",
  "model_targets:read", "model_targets:write", "availability:read", "availability:write",
  "transforms:read", "transforms:write", "config:read", "config:write", "settings:read",
  "settings:write", "audits:read", "policies:read", "policies:write", "prices:read", "prices:write",
  "billing:cost", "billing:spend", "billing:subtree", "ledger:read", "logs:read",
  "logs:pull", "reports:read", "users:read", "users:create", "users:update", "users:delete",
  "apikeys:read", "apikeys:write", "admins:read", "admins:write", "roles:read", "roles:write",
  "playground:use",
];
const MOCK_ADMIN = {
  id: "adm_mock",
  username: "admin",
  name: "张三",
  role: "admin",
  status: "active",
  permissions: MOCK_ALL_PERMISSIONS,
  expires_at: "2026-11-18T00:00:00",
};
/** 普通用户镜像（l05_service/rbac.py _USER_PERMISSIONS）：只读 + 己方花费 + 模型试验。 */
const MOCK_USER_PERMISSIONS = [
  "vendors:read", "upstreams:read", "upstream_models:read", "public_models:read",
  "model_targets:read", "availability:read", "transforms:read", "config:read",
  "settings:read", "audits:read", "policies:read", "prices:read",
  "billing:spend", "reports:read", "users:read", "apikeys:read", "admins:read",
  "roles:read", "playground:use",
];
/** 受限演示账号（W4-E 验收：无 users:update/users:delete/ledger:read/roles:write 的显隐对照）。 */
const MOCK_USER = {
  id: "adm_mock_user",
  username: "user01",
  name: "李四",
  role: "user",
  status: "active",
  permissions: MOCK_USER_PERMISSIONS,
  expires_at: "2026-11-18T00:00:00",
};
/** 当前 mock 会话身份：登录时按账号切换。 */
let mockSession: typeof MOCK_ADMIN | typeof MOCK_USER = MOCK_ADMIN;

const vendors: Vendor[] = [
  { id: "vd_zai", name: "智谱 AI", slug: "zai", note: "智谱开放平台，旗舰 GLM 系列", upstream_seq: 3, created_at_ms: Date.parse("2026-11-01T09:00:00") },
  { id: "vd_or", name: "OpenRouter", slug: "or", note: "海外聚合路由", upstream_seq: 2, created_at_ms: Date.parse("2026-11-01T09:00:00") },
  { id: "vd_nebula", name: "青岚云", slug: "nebula", note: "云厂商大模型服务，合规通道", upstream_seq: 1, created_at_ms: Date.parse("2026-11-01T09:00:00") },
  { id: "vd_doubao", name: "字节火山方舟", slug: "doubao", note: "豆包系列，待补上游价目", upstream_seq: 0, created_at_ms: Date.parse("2026-11-01T09:00:00") },
];
let vendorSeq = 3;

/** 实测 /admin/upstreams 形状：名称形如 {vendor_slug}-NN，无 vendor_name/has_api_key/model_count */
const upstreams: Upstream[] = [
  { id: "up_01", name: "zai-01", vendor_id: "vd_zai", base_url: "https://open.bigmodel.cn/api/paas/v4", api_style: "openai_chat", transforms: null, max_buffer_bytes: 2097152, enabled: true, created_at_ms: Date.parse("2026-11-01T09:00:00") },
  { id: "up_02", name: "or-01", vendor_id: "vd_or", base_url: "https://openrouter.ai/api/v1", api_style: "openai_chat", transforms: null, max_buffer_bytes: 2097152, enabled: true, created_at_ms: Date.parse("2026-11-01T09:01:00") },
  { id: "up_03", name: "nebula-01", vendor_id: "vd_nebula", base_url: "https://api.nebula.example/v1", api_style: "anthropic_messages", transforms: null, max_buffer_bytes: 2097152, enabled: false, created_at_ms: Date.parse("2026-11-01T09:02:00") },
];

const upstreamModels: UpstreamModel[] = [
  { id: "um_01", upstream_id: "up_01", name: "glm-5.3", model_type: "chat", enabled: true, created_at_ms: Date.parse("2026-11-01T09:00:00"), upstream_name: "zai-01", vendor_name: "智谱 AI", cost_input_per_1m: "2.500000", cost_output_per_1m: "10.000000", markup: "1.2000" },
  { id: "um_02", upstream_id: "up_01", name: "glm-5.3-flash", model_type: "chat", enabled: true, created_at_ms: Date.parse("2026-11-01T09:00:00"), upstream_name: "zai-01", vendor_name: "智谱 AI", cost_input_per_1m: "0.300000", cost_output_per_1m: "1.200000", markup: "1.5000" },
  { id: "um_03", upstream_id: "up_01", name: "embedding-4", model_type: "embedding", enabled: true, created_at_ms: Date.parse("2026-11-01T09:00:00"), upstream_name: "zai-01", vendor_name: "智谱 AI", cost_input_per_1m: "0.050000", cost_output_per_1m: "0.000000", markup: "1.0000" },
  { id: "um_04", upstream_id: "up_02", name: "deepseek/v5-chat", model_type: "chat", enabled: true, created_at_ms: Date.parse("2026-11-02T09:00:00"), upstream_name: "or-01", vendor_name: "OpenRouter", cost_input_per_1m: null, cost_output_per_1m: null, markup: "1.0000" },
  { id: "um_05", upstream_id: "up_02", name: "qwen/max-next", model_type: "chat", enabled: false, created_at_ms: Date.parse("2026-11-02T09:00:00"), upstream_name: "or-01", vendor_name: "OpenRouter", cost_input_per_1m: "1.200000", cost_output_per_1m: "4.800000", markup: "1.1000" },
];

const publicModels: PublicModel[] = [
  { id: "pm_01", name: "glm-5.3", routing_mode: "failover", note: "主力对话", enabled: true, created_at_ms: Date.parse("2026-11-05T10:00:00") },
  { id: "pm_02", name: "glm-flash", routing_mode: "weighted", note: "轻量对话", enabled: true, created_at_ms: Date.parse("2026-11-06T10:00:00") },
  { id: "pm_03", name: "embed-v4", routing_mode: "conditional", note: null, enabled: false, created_at_ms: Date.parse("2026-11-07T10:00:00") },
];

/** W4-H：GET /admin/my/models 的演示数据（启用公开模型 → 成员参数合集，无金额键）。 */
const myModels: MyModelOut[] = [
  {
    name: "glm-5.3",
    model_type: "chat",
    sources: ["glm-5.3", "deepseek/v5-chat"],
    parameters: {
      max_input_tokens: 200_000,
      max_output_tokens: 128_000,
      reasoning_level: "high",
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
      input_types: ["text"],
      output_types: ["text"],
      tool_call: true,
      reasoning: false,
      attachment: false,
      structured_output: false,
    },
  },
];

const modelTargets: ModelTarget[] = [
  { id: "mt_01", public_model_id: "pm_01", upstream_model_id: "um_01", upstream_model_name: "glm-5.3", upstream_name: "智谱直连", priority: 1, weight: null, when: null, enabled: true },
  { id: "mt_02", public_model_id: "pm_01", upstream_model_id: "um_04", upstream_model_name: "deepseek/v5-chat", upstream_name: "OpenRouter 聚合", priority: 2, weight: null, when: null, enabled: true },
  { id: "mt_03", public_model_id: "pm_02", upstream_model_id: "um_02", upstream_model_name: "glm-5.3-flash", upstream_name: "智谱直连", priority: null, weight: 12000, when: null, enabled: true },
  { id: "mt_04", public_model_id: "pm_03", upstream_model_id: "um_03", upstream_model_name: "embedding-4", upstream_name: "智谱直连", priority: null, weight: null, when: 'request.user_tier == "trial"', enabled: true },
];
let mtSeq = 4;

const clientKeys: ApiKey[] = [
  { id: "ak_01", user_id: "eu_01", mask: "sk-…G7H8", key_suffix: "G7H8", status: "active", created_at_ms: Date.parse("2026-11-01T10:00:00") },
  { id: "ak_02", user_id: "eu_02", mask: "sk-…R5S6", key_suffix: "R5S6", status: "active", created_at_ms: Date.parse("2026-11-10T14:30:00") },
  { id: "ak_03", user_id: "eu_03", mask: "sk-…Z3A4", key_suffix: "Z3A4", status: "disabled", created_at_ms: Date.parse("2026-10-20T09:00:00") },
];

/**
 * mock 模式日志行：结构镜像 components/logs/types.ts 的 LogRow（lib 不反向 import
 * components），供 /admin/logs 的排序/筛选/分页演示（W6 补桩）。
 */
interface MockLogRow {
  event_id: string;
  trace_id: string;
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

const MOCK_LOG_START_MS = Date.parse("2026-11-03T08:00:00");
const MOCK_LOG_MODELS = ["glm-5.3", "glm-4.6", "qwen-max"];
const MOCK_LOG_PEOPLE = [
  { id: "eu_01", name: "内部平台" },
  { id: "eu_02", name: "数据分析组" },
  { id: "eu_03", name: "试用-临时" },
];
const MOCK_LOG_KEYS = ["sk-…G7H8", "sk-…R5S6", "sk-…Z3A4"];
const MOCK_LOG_UPSTREAMS = ["zai-01", "or-01", "host-01"];

const mockLogs: MockLogRow[] = Array.from({ length: 36 }, (_, i) => {
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
  // M5-b：成功行里挑一部分带 trace_id（两轮失败→成功 / 三轮），失败行与其余行留空，
  // 用来验证「无 trace 不渲染路由链」分支。
  // ticket 04：i===5 是失败但带尝试链的行——行级错误摘要由最后一次失败尝试补齐；
  // 其余失败行没有 attempts，验证「无链路记录」降级。
  const trace_id = failed
    ? i === 5
      ? "tr_m5b_failed"
      : ""
    : i % 4 === 0
      ? "tr_m5b_retry"
      : i % 7 === 0
        ? "tr_m5b_three"
        : "";
  const attempts_count =
    trace_id === "tr_m5b_three" || trace_id === "tr_m5b_failed" ? 3 : trace_id ? 2 : 0;
  // ticket 04：带尝试链的失败行不再由 mock 拼 UI 摘要，只给 rowErrorText 所需的事实字段。
  const failedStatus = failed ? (i % 2 === 0 ? 500 : 502) : 200;
  const chainFailure = trace_id === "tr_m5b_failed";
  return {
    event_id: "mev_" + String(1000 + i),
    trace_id,
    attempts_count,
    has_attempts: trace_id.length > 0,
    last_failure_status: chainFailure ? failedStatus : null,
    last_failure_error_type: chainFailure ? String(failedStatus) : "",
    last_failure_error_message: chainFailure ? (failedStatus === 502 ? "bad gateway" : "internal error") : "",
    started_at_ms,
    completed_at_ms: started_at_ms + duration_ms,
    duration_ms,
    time_to_first_token_ms: is_stream ? 220 + ((i * 149) % 700) : 0,
    http_status: failedStatus,
    public_model: model,
    // 混合形态 AG 日志才有请求模型；i%6===0 的行模拟历史/直连行，展示「—」降级。
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
function queryMockLogs(params: URLSearchParams): { total: number; items: MockLogRow[]; next_offset: number | null } {
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
 * ADR-028：日志详情路由链的两条演示尝试链（按 trace_id 索引，路由再补 event_id）。
 * tr_m5b_retry：第 1 轮 500 → 第 2 轮 200（跨 zai-01 → or-01）；
 * tr_m5b_three：第 1/2 轮 503/500 → 第 3 轮 200。
 */
const MOCK_TRACE_BASE_MS = Date.parse("2026-11-17T01:04:59");
const mockAttempts: Record<string, LogAttemptsOut> = {
  tr_m5b_retry: {
    event_id: "",
    trace_id: "tr_m5b_retry",
    attempts: [
      {
        attempt: 1,
        upstream_ref: "ups_zai",
        upstream_name: "zai-01",
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
        upstream_ref: "ups_or",
        upstream_name: "or-01",
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
  tr_m5b_three: {
    event_id: "",
    trace_id: "tr_m5b_three",
    attempts: [
      {
        attempt: 1,
        upstream_ref: "ups_zai",
        upstream_name: "zai-01",
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
        upstream_ref: "ups_zai",
        upstream_name: "zai-01",
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
        upstream_ref: "ups_or",
        upstream_name: "or-01",
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
  tr_m5b_failed: {
    event_id: "",
    trace_id: "tr_m5b_failed",
    attempts: [
      {
        attempt: 1,
        upstream_ref: "ups_zai",
        upstream_name: "zai-01",
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
        upstream_ref: "ups_zai",
        upstream_name: "zai-01",
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
        upstream_ref: "ups_or",
        upstream_name: "or-01",
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

const availabilityRules: AvailabilityRule[] = [
  { id: "ar_01", kind: "ban", scope: "model_target", scope_id: "mt_01", recurrence: "once", expires_at_ms: null, schedule_json: null, note: "连续超时，人工关闭待查", created_at_ms: Date.parse("2026-11-17T08:00:00") },
  { id: "ar_02", kind: "cooldown", scope: "model_target", scope_id: "mt_02", recurrence: "once", expires_at_ms: Date.parse("2026-11-17T02:30:00"), schedule_json: null, note: "429 限流自动冷却", created_at_ms: Date.parse("2026-11-17T01:30:00") },
  { id: "ar_03", kind: "cooldown", scope: "upstream", scope_id: "up_02", recurrence: "daily", expires_at_ms: null, schedule_json: JSON.stringify({ windows: [{ start: "22:00", end: "06:00" }] }), note: "每日 22:00-06:00 例行维护", created_at_ms: Date.parse("2026-11-15T09:00:00") },
];

const billingRequests: CostEntry[] = Array.from({ length: 12 }, (_, i) => {
  const vendors = [["vd_zai", "um_01"], ["vd_zai", "um_02"], ["vd_or", "um_04"]];
  const v = vendors[i % 3]!;
  const unpriced = i === 3;
  const free = i === 7;
  return {
    id: "ce_" + String(5000 + i),
    gateway_event_id: "gev_" + String(9000 + i),
    vendor_id: v[0]!,
    upstream_model_id: v[1]!,
    input_tokens: 380 + i * 41,
    output_tokens: 74 + i * 13,
    amount_micro: unpriced ? 0 : 6200 + i * 1450,
    currency: "CNY",
    price_version_id: unpriced ? null : "pv_20261101",
    status: unpriced ? "unpriced" : free ? "free" : "ok",
  };
});

const revenueRows: ChargeEntry[] = Array.from({ length: 14 }, (_, i) => {
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

const upstreamPrices: UpstreamPrice[] = [
  { id: "up_01", vendor_name: "智谱直连", upstream_model: "glm-5.3", item: "input", unit_price_micro: 2000000, currency: "CNY", effective_from: "2026-11-01T00:00:00", version: 3 },
  { id: "up_02", vendor_name: "智谱直连", upstream_model: "glm-5.3", item: "output", unit_price_micro: 8000000, currency: "CNY", effective_from: "2026-11-01T00:00:00", version: 3 },
  { id: "up_03", vendor_name: "智谱直连", upstream_model: "glm-flash", item: "input", unit_price_micro: 300000, currency: "CNY", effective_from: "2026-11-01T00:00:00", version: 1 },
  { id: "up_04", vendor_name: "智谱直连", upstream_model: "glm-flash", item: "output", unit_price_micro: 1200000, currency: "CNY", effective_from: "2026-11-01T00:00:00", version: 1 },
  { id: "up_05", vendor_name: "OpenRouter 聚合", upstream_model: "deepseek/v5-chat", item: "input", unit_price_micro: 270000, currency: "USD", effective_from: "2026-10-15T00:00:00", version: 2 },
  { id: "up_06", vendor_name: "OpenRouter 聚合", upstream_model: "deepseek/v5-chat", item: "output", unit_price_micro: 1090000, currency: "USD", effective_from: "2026-10-15T00:00:00", version: 2 },
  { id: "up_07", vendor_name: "OpenRouter 聚合", upstream_model: "embedding-4", item: "request", unit_price_micro: 1000, currency: "USD", effective_from: "2026-10-15T00:00:00", version: 1 },
];

const chargePrices: ChargePrice[] = [
  { id: "cp_01", public_model: "glm-5.3", item: "input", mode: "markup", value: 12000, currency: "CNY", effective_from: "2026-11-01T00:00:00", version: 2 },
  { id: "cp_02", public_model: "glm-5.3", item: "output", mode: "markup", value: 12000, currency: "CNY", effective_from: "2026-11-01T00:00:00", version: 2 },
  { id: "cp_03", public_model: "glm-flash", item: "input", mode: "markup", value: 15000, currency: "CNY", effective_from: "2026-11-01T00:00:00", version: 1 },
  { id: "cp_04", public_model: "embed-v4", item: "request", mode: "fixed", value: 500000, currency: "CNY", effective_from: "2026-11-05T00:00:00", version: 1 },
];

const unpricedRows: UnpricedList = {
  cost: [
    { id: "ce_5020", gateway_event_id: "gev_9020", vendor_id: "vd_doubao", upstream_model_id: "um_90", input_tokens: 912, output_tokens: 233, amount_micro: 0, currency: "CNY", price_version_id: null, status: "unpriced" },
  ],
  charge: [
    { id: "ch_7015", gateway_event_id: "gev_9015", user_id: "eu_02", public_model_id: "pm_90", input_tokens: 22100, output_tokens: 1902, amount_micro: 0, currency: "CNY", price_version_id: null, status: "unpriced" },
  ],
};

const configRevisions: ConfigRevision[] = [
  { id: "cr_03", artifact_hash: "h3f9a2c1e5", adapter_id: "openai-chat", operator: "admin", reason: "新增 embed-v4 目标", status: "active", previous_revision_id: "cr_02", created_at_ms: Date.parse("2026-11-17T01:05:12") },
  { id: "cr_02", artifact_hash: "h7b1e8d0f2", adapter_id: "openai-chat", operator: "admin", reason: "OpenRouter 密钥更换", status: "superseded", previous_revision_id: "cr_01", created_at_ms: Date.parse("2026-11-16T15:40:00") },
  { id: "cr_01", artifact_hash: "h5c0a9f2d8", adapter_id: "openai-chat", operator: "admin", reason: "校验失败", status: "failed", error_detail: "数据面校验失败：未知字段 model_aliases", previous_revision_id: null, created_at_ms: Date.parse("2026-11-16T15:12:44") },
];

const auditLogs: AuditLog[] = [
  { id: "al_01", actor: "admin", action: "config.apply", target: "rev_20261117_03", created_at: "2026-11-17T01:05:12", detail: "下发成功，hash h3f9a2c1" },
  { id: "al_02", actor: "admin", action: "client_key.create", target: "ck_02", created_at: "2026-11-16T18:22:03", detail: "创建密钥 数据分析组" },
  { id: "al_03", actor: "admin", action: "config.rollback", target: "rev_20261116_01", created_at: "2026-11-16T15:12:44", detail: "热加载确认超时，自动回滚" },
];

// —— 网关策略三文档（ADR-023；契约 docs/api-contract.md §2.6，shape = lib/policies.ts 页面模型） ——
// 与后端一致：默认值镜像 l05_service/policy_store.py，存储文档可变，保存走 PUT、恢复默认走 DELETE。
const POLICY_PROTECTED_HEADERS = [
  "api-key", "authorization", "content-length", "content-type", "cookie",
  "host", "set-cookie", "x-api-key", "x-request-id",
];

const DEFAULT_POLICY_CONFIG: PolicyConfig = {
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
let policyConfig: PolicyConfig = {
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
let policyUpdatedAt = Date.parse("2026-11-17T01:05:12");

/** AG 1.7 适配器能力矩阵（l03_adapters/agentgateway/adapter.py describe() 同值）。 */
const AG_POLICY_CAPABILITIES: PoliciesResponse["capabilities"] = {
  cors: { supported: true, verified: false, since_version: "1.7.0", note: "数据面 CORS（显式配置才渲染）" },
  api_key: { supported: true, verified: true, since_version: "1.7.0", note: "keyHash + metadata，mode: strict；enabled=false 时整段不渲染（匿名）" },
  local_rate_limit: { supported: true, verified: true, since_version: "1.7.0", note: "localRateLimit 是数组；只有全局规则，无逐用户 maxTokens（E12）" },
  timeout: { supported: true, verified: false, since_version: "1.7.0", note: "request/backend/responseIdle 时长" },
  transformations: { supported: true, verified: true, since_version: "1.7.0", note: "仅全局 llm.policies.transformations 支持 conditional" },
  retry: { supported: true, verified: true, since_version: "1.7.0", note: "渲染为顶层 policies[]（target route internal/llm:request）；llm.policies 仍拒绝 retry（E16/E17）" },
  health: { supported: true, verified: true, since_version: "1.7.0", note: "逐模型 llm.models[].health（unhealthyExpression + eviction）；retry codes 含 4xx 时必须成对（E16/E17）" },
  request_attempts: { supported: true, verified: true, since_version: "1.7.0", note: "AG 适配器内部 OTLP 采集每次上游尝试，归一化为 RequestAttempt；系统只存尝试事实，不接触 OTLP（ADR-028）" },
  guardrails_regex: { supported: true, verified: true, since_version: "1.7.0", note: "llm.policies.guardrails（regex mask/reject/audit + 内置敏感信息规则）" },
  guardrails_webhook: { supported: true, verified: true, since_version: "1.7.0", note: "webhook 护栏仅 reject/audit，target 只能 host（无路径），不支持 scope" },
};

/** 后端 NOTES（routers_policies.py）原文：页级各分区卡的 description。 */
const POLICY_NOTES: Record<string, string> = {
  cors: "控制面 CORS 由 SLIPSTREAM_CORS_ORIGINS 决定；此处的 enabled 控制数据面 llm.policies.cors",
  api_key: "enabled=false 表示数据面匿名放行（不渲染 llm.policies.apiKey），密钥仍保留在台账",
  rate_limit: "请求级限流为全局规则；预付费余额由控制面账本执行，不渲染逐用户桶（E12）",
  timeout: "humantime 字符串（如 60s/500ms）；留空表示不渲染该字段",
  retry: "请求内重试渲染为顶层 policies[]（target route internal/llm:request），attempts 为首次之后的尝试次数（>=2 才能跨层 failover）；codes 含 4xx 时必须同时配置 health（unhealthy_expression + consecutive_failures）",
  health: "逐模型健康标记与驱逐（llm.models[].health）；表达式单独配置不会驱逐主层（E16/E17），必须带 consecutive_failures >= 1",
  transformations: "默认响应头删除按 ADR-010 追加在用户规则之后；保护头仅控制面记录",
  guardrails_webhook: "webhook 护栏仅 reject/audit，target 只能是 host（无路径），不支持 scope",
  mcp_http: "pinned AG 1.7 拒绝 http 变体；只支持 sse/stdio，http 会在保存时被 422 拒绝",
};

/** effective 是下发前的可读预览（l05_service/policy_store.py policy_effective 同构）。 */
function policyEffective(config: PolicyConfig): PoliciesResponse["effective"] {
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

function policyPayload(): PoliciesResponse {
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
    capabilities: AG_POLICY_CAPABILITIES,
    notes: POLICY_NOTES,
    updated_at_ms: policyUpdatedAt,
  };
}

const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = { streaming: "Disabled", request: [], response: [] };

let guardrailConfig: GuardrailConfig = {
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
let guardrailUpdatedAt = Date.parse("2026-11-17T01:05:12");

/** 完整能力矩阵（护栏 Tab 的「能力矩阵」表格数据，沿用三期矩阵条目）。 */
const GUARDRAIL_ITEMS = [
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

function guardrailPayload(): GuardrailsResponse {
  return {
    config: structuredClone(guardrailConfig),
    defaults: structuredClone(DEFAULT_GUARDRAIL_CONFIG),
    adapter: "agentgateway",
    items: GUARDRAIL_ITEMS,
    capabilities: {
      regex: AG_POLICY_CAPABILITIES.guardrails_regex,
      webhook: AG_POLICY_CAPABILITIES.guardrails_webhook,
    },
    note: "supported=False 为路线图说明而非今日可配置；verified=False 表示尚未经数据面实测",
    updated_at_ms: guardrailUpdatedAt,
  };
}

/** MCP 文档 {servers, port}；transports 能力按 AG 1.7 实测（sse/stdio 可用，http 拒收）。 */
let mcpConfig: { servers: McpServerConfig[]; port: number | null } = {
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
let mcpUpdatedAt = Date.parse("2026-11-17T01:05:12");

const MCP_TRANSPORT_CAPABILITIES: McpServersResponse["transports"] = {
  sse: { supported: true, verified: true, since_version: "1.7.0", note: "sse target 使用 host" },
  stdio: { supported: true, verified: true, since_version: "1.7.0", note: "stdio target: cmd/args/env/clear_env，已 --validate-only 验证" },
  http: { supported: false, verified: true, since_version: "", note: "pinned 1.7 拒绝 http 变体（no variant of enum LocalMcpTargetSpec）" },
};

function mcpPayload(): McpServersResponse {
  return {
    servers: structuredClone(mcpConfig.servers),
    port: mcpConfig.port,
    defaults: { servers: [], port: null },
    supported: true,
    transports: MCP_TRANSPORT_CAPABILITIES,
    note: "AG 1.7 支持顶层 mcp.targets[] + mcp.policies（sse/stdio；http 被 pinned 1.7 拒绝）；该形态已用 --validate-only 验证，targets 由 MCP 配置生成",
    updated_at_ms: mcpUpdatedAt,
  };
}

const settings: SettingItem[] = [
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
const settingsSchema = {
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

const overview: OverviewStats = {
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

const sampleTransforms: UpstreamTransforms = {
  request_headers: [
    { op: "update", name: "x-trace", value: "slipstream", conditions: [] },
    {
      op: "update", path: "temperature", value: "0.2",
      conditions: [{ field: "model", mode: "full", value: "glm-5.3" }],
    },
  ],
  request_body: [
    { op: "copy", path: "top_p", source_path: "temperature", conditions: [] },
  ],
  response_headers: [],
  response_body: [],
};

/** 旧 /admin/admins mock（ADR-019 后由统一用户表取代）：仅保留读取桩，角色键与 admin_roles 对齐。 */
const adminAccounts: AdminAccount[] = [
  { id: "ad_01", username: "owner", role: "admin", enabled: true, created_at: "2026-10-01T08:00:00", last_login_at: "2026-11-17T02:00:00" },
  { id: "ad_02", username: "ops-admin", role: "admin", enabled: true, created_at: "2026-10-12T08:00:00", last_login_at: "2026-11-16T23:30:00" },
  { id: "ad_03", username: "audit-viewer", role: "user", enabled: false, created_at: "2026-11-01T08:00:00", last_login_at: null },
];

/**
 * ADR-019 统一用户表（GET /admin/users 与 /admin/users/tree 同行形，见 UserTreeNode）。
 * username 非空 = 可登录控制台（前端「控制台」徽章仅标识，操作显隐一律查权限键）；
 * eu_04 故意不带 username，用来演示纯 API 用户行。
 */
const mockUsers: UserTreeNode[] = [
  { id: "eu_01", name: "内部平台", username: "internal", balance_micro: 1148659200, role: "admin", parent_user_id: null, status: "active", depth: 0, direct_children: 3, subtree_size: 5, created_at_ms: Date.parse("2026-11-01T10:00:00"), updated_at_ms: Date.parse("2026-11-17T01:22:00") },
  { id: "eu_02", name: "数据分析组", username: "data-team", balance_micro: 480000000, role: "agent", parent_user_id: "eu_01", status: "active", depth: 1, direct_children: 1, subtree_size: 2, created_at_ms: Date.parse("2026-11-10T14:30:00"), updated_at_ms: Date.parse("2026-11-12T09:00:00") },
  { id: "eu_03", name: "试用-临时", username: "trial", balance_micro: 0, role: "user", parent_user_id: "eu_02", status: "disabled", depth: 2, direct_children: 0, subtree_size: 1, created_at_ms: Date.parse("2026-10-20T09:00:00"), updated_at_ms: Date.parse("2026-11-14T18:00:00") },
  { id: "eu_04", name: "分销代理", username: "", balance_micro: 230000000, role: "agent", parent_user_id: "eu_01", status: "active", depth: 1, direct_children: 0, subtree_size: 1, created_at_ms: Date.parse("2026-11-05T11:00:00"), updated_at_ms: Date.parse("2026-11-05T11:00:00") },
  { id: "eu_05", name: "华东代理", username: "east-agent", balance_micro: 960000000, role: "user", parent_user_id: "eu_01", status: "active", depth: 1, direct_children: 0, subtree_size: 1, created_at_ms: Date.parse("2026-11-15T08:20:00"), updated_at_ms: Date.parse("2026-11-15T08:20:00") },
];

/** mock 用户序号：创建新用户时递增（id eu_NN）。 */
let mockUserSeq = mockUsers.length;

// —— 角色管理（ADR-023 #4；契约 docs/api-contract.md：GET/POST/PATCH/DELETE /admin/roles） ——
// 内存 admin_roles：与 lib/roles.ts 的 RoleDefinition 模型同形；member_count 按 mockUsers 实时计算，
// 与后端 roles.member_count 同口径（删除有成员的角色会被拒）。
const MOCK_AGENT_PERMISSIONS = [...MOCK_USER_PERMISSIONS, "users:create", "users:update", "billing:subtree"];
/** 后端保留键：内置角色 + 历史别名（l05_service/rbac.py RESERVED_ROLE_KEYS）。 */
const RESERVED_ROLE_KEYS = new Set(["admin", "user", "agent", "owner", "operator", "viewer"]);

const adminRoles: RoleDefinition[] = [
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
    id: "rol_user",
    key: "user",
    name: "普通用户",
    description: "只读查看，可看自己的花费并试用模型",
    builtin: true,
    all_permissions: false,
    permissions: [...MOCK_USER_PERMISSIONS],
    member_count: 0,
  },
  {
    id: "rol_agent",
    key: "agent",
    name: "代理用户",
    description: "在普通用户基础上可创建下级并查看子树花费",
    builtin: true,
    all_permissions: false,
    permissions: MOCK_AGENT_PERMISSIONS,
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
    permissions: MOCK_USER_PERMISSIONS.slice(0, 12),
    member_count: 0,
  },
];

/** 行内权限排序 + 成员数实时化（后端 role_payload 同构）。 */
function rolePayload(row: RoleDefinition): RoleDefinition {
  return {
    ...row,
    permissions: [...row.permissions].sort(),
    member_count: mockUsers.filter((u) => u.status !== "deleted" && u.role === row.key).length,
  };
}

function roleFromId(roleId: string): RoleDefinition {
  const row = adminRoles.find((r) => r.id === roleId);
  if (!row) throw new Error("角色不存在: " + roleId);
  return row;
}

function ledgerFor(userId: string) {
  const base = 1200000000;
  return [
    { id: userId + "-lg1", kind: "topup", delta_micro: 1000000000, balance_after_micro: base, currency: "CNY", ref_type: null, ref_id: null, note: "充值", created_by: "admin", created_at_ms: Date.parse("2026-11-15T09:00:00") },
    { id: userId + "-lg2", kind: "charge", delta_micro: -28650200, balance_after_micro: base - 28650200, currency: "CNY", ref_type: "usage", ref_id: "gev_9001", note: "调用计费", created_by: "system", created_at_ms: Date.parse("2026-11-16T10:12:00") },
    { id: userId + "-lg3", kind: "charge", delta_micro: -15650400, balance_after_micro: base - 44300600, currency: "CNY", ref_type: "usage", ref_id: "gev_9002", note: "调用计费", created_by: "system", created_at_ms: Date.parse("2026-11-16T20:40:00") },
    { id: userId + "-lg4", kind: "charge", delta_micro: -7040200, balance_after_micro: base - 51340800, currency: "CNY", ref_type: "usage", ref_id: "gev_9003", note: "调用计费", created_by: "system", created_at_ms: Date.parse("2026-11-17T01:22:00") },
  ];
}

/** 用户偏好（GET/PUT /admin/auth/preferences）：mock 会话内可变，演示顶栏/设置页主题服务端持久化。 */
let mockPreferences: UserPreferences = {
  theme: "system",
  notify_email: true,
  notify_browser: false,
  notify_weekly: true,
  bio: "",
};

/** mock 一次性初始密码：随机生成，仅演示 ADR-019「仅显示一次」。 */
function mockOneTimePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
  let out = "";
  for (let i = 0; i < 12; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** 公开模型列表视图：按契约默认内嵌 targets[]（服务端按 priority 升序）。 */
function publicModelsView(): PublicModel[] {
  return publicModels.map((publicModel) => ({
    ...publicModel,
    target_count: modelTargets.filter((target) => target.public_model_id === publicModel.id).length,
    targets: modelTargets
      .filter((target) => target.public_model_id === publicModel.id)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
  }));
}

/** 公开模型价格 = 成员有效单价（成本 × 倍率）加权平均；与后端 pricing.public_model_price_rows 同口径。 */
function derivePublicModelPrices(): PublicModelPrice[] {
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

const routes: Array<[RegExp, unknown]> = [
  [/^\/admin\/upstreams\/[^/]+\/transforms$/, { upstream_id: "up_01", transforms: sampleTransforms }],
  [/^\/admin\/reports\/overview/, overview],
  [/^\/admin\/reports\/trend/, { metric: "requests", range: "today", points: [], estimate_note: "近似值：按价目快照折算" }],
  [/^\/admin\/reports\/flow/, { nodes: [], links: [], estimate_note: "近似值：按价目快照折算" }],
  [/^\/admin\/health/, { status: "ok", ir_version: "ir-7", adapter: "openai-chat", now_ms: Date.now(), data_plane_port: 3600 }],
  [/^\/admin\/vendors$/, vendors],
  [/^\/admin\/upstreams$/, upstreams],
  [/^\/admin\/upstream-models$/, upstreamModels],
  [/^\/admin\/public-models$/, publicModels],
  [/^\/admin\/api-keys$/, clientKeys],
  [/^\/admin\/availability-rules$/, availabilityRules],
  [/^\/admin\/cost\/entries$/, billingRequests],
  [/^\/admin\/charge\/entries$/, revenueRows],
  [/^\/admin\/prices\/upstream$/, upstreamPrices],
  [/^\/admin\/prices\/charge$/, chargePrices],
  [/^\/admin\/unpriced$/, unpricedRows],
  [/^\/admin\/config\/revisions/, configRevisions],
  [/^\/admin\/audit-logs$/, { items: auditLogs, total: auditLogs.length }],
  [/^\/admin\/admins$/, adminAccounts],
  [/^\/admin\/users$/, mockUsers],
  [/^\/admin\/settings\/schema$/, settingsSchema],
  [/^\/admin\/settings$/, { items: settings }],
  [/^\/admin\/my\/models$/, myModels],
];

const PREVIEW_BODY = JSON.stringify({
  model: "glm-5.3",
  temperature: 0.9,
  messages: [{ role: "user", content: "hi" }],
});

/** mock 模式：按路径返回内置数据，模拟网络延迟，保证后端未就绪也能演示。 */
export async function mockRequest<T>(path: string, init?: RequestInit): Promise<T> {
  await delay(220);
  const routePath = path.split("?")[0] ?? "";
  // 登录（演示）：admin/user01 均为 admin12345（兼容旧 owner/admin123）签发 mock 会话
  if (init?.method === "POST" && path === "/admin/auth/login") {
    const body = JSON.parse(String(init.body ?? "{}")) as { username?: string; password?: string };
    const knownPassword = body.password === "admin12345" || body.password === "admin123";
    const knownUser =
      (body.username === "admin" || body.username === "owner") ||
      body.username === "user01";
    if (knownUser && knownPassword) {
      mockSession = body.username === "user01" ? MOCK_USER : MOCK_ADMIN;
      mockLoggedIn = true;
      return { user: mockSession } as T;
    }
    throw new Error("用户名或密码错误（mock 演示账号：admin / user01，密码 admin12345）");
  }
  if (init?.method === "GET" && path === "/admin/auth/me") {
    if (!mockLoggedIn) throw new Error("未登录或会话已失效");
    return mockSession as T;
  }
  if (init?.method === "POST" && path === "/admin/auth/logout") {
    mockLoggedIn = false;
    return { ok: true } as T;
  }
  if (init?.method === "POST" && /\/transforms\/preview$/.test(path)) {
    const result: TransformPreviewResult = {
      upstream_id: "up_01",
      before: JSON.parse(PREVIEW_BODY) as unknown,
      after: {
        request: { set: { "x-trace": '"slipstream"' } },
        conditional: [{ predicate: "json(request.body).model == 'glm-5.3'", set: {} }],
      },
      skipped: [],
      notes: [],
    };
    return result as T;
  }
  if (init?.method === "PUT" && /\/transforms$/.test(path)) {
    return { saved: true } as T;
  }
  // 明文只在点击复制时经 reveal 取一次，mock 返回固定明文，前端不落状态
  if (init?.method === "POST" && /\/api-keys\/[^/]+\/reveal$/.test(path)) {
    return { key: "sk-A1B2C3D4E5F6G7H8" } as T;
  }
  // 待补价：补价并重算只写 cost/charge，不重复写 usage event（billing.md §7）
  if (init?.method === "POST" && /\/unpriced\/[^/]+\/reprice$/.test(path)) {
    const id = (path.split("?")[0] ?? "").split("/")[3] ?? "";
    let removed = 0;
    for (let i = unpricedRows.cost.length - 1; i >= 0; i--) {
      const r = unpricedRows.cost[i];
      if (r && r.id === id) { unpricedRows.cost.splice(i, 1); removed += 1; }
    }
    for (let i = unpricedRows.charge.length - 1; i >= 0; i--) {
      const r = unpricedRows.charge[i];
      if (r && r.id === id) { unpricedRows.charge.splice(i, 1); removed += 1; }
    }
    return { resolved: removed, remaining: unpricedRows.cost.length + unpricedRows.charge.length } as T;
  }
  // —— W4-E：ADR-019 统一用户表 CRUD（require 键对齐 routers_apikeys.py） ——
  if (init?.method === "GET" && routePath === "/admin/users/tree") {
    const visible = new Set(mockUsers.filter((u) => u.status !== "deleted").map((u) => u.id));
    const rootIds = mockUsers
      .filter((u) => u.status !== "deleted" && (u.parent_user_id === null || !visible.has(u.parent_user_id)))
      .map((u) => u.id);
    return {
      root_id: rootIds[0] ?? null,
      root_ids: rootIds,
      total: visible.size,
      nodes: structuredClone(mockUsers),
    } as T;
  }
  if (init?.method === "POST" && path === "/admin/users") {
    const body = JSON.parse(String(init.body ?? "{}")) as {
      name?: string; username?: string; role?: string; parent_user_id?: string | null; status?: string;
    };
    const parent = body.parent_user_id ? mockUsers.find((u) => u.id === body.parent_user_id) : undefined;
    const now = Date.now();
    const created: UserTreeNode = {
      id: "eu_" + String(++mockUserSeq).padStart(2, "0"),
      name: body.name ?? "未命名用户",
      username: body.username ?? "",
      balance_micro: 0,
      role: body.role ?? "user",
      parent_user_id: parent?.id ?? null,
      status: body.status ?? "active",
      depth: (parent?.depth ?? -1) + 1,
      direct_children: 0,
      subtree_size: 1,
      created_at_ms: now,
      updated_at_ms: now,
    };
    mockUsers.push(created);
    if (parent) {
      parent.direct_children += 1;
      parent.subtree_size += 1;
    }
    // initial_password 只在创建响应里出现一次（ADR-019），不留在列表数据里
    return { ...structuredClone(created), initial_password: mockOneTimePassword() } as T;
  }
  if (init?.method === "PATCH" && /^\/admin\/users\/[^/?]+$/.test(routePath)) {
    const id = routePath.split("/")[3] ?? "";
    const row = mockUsers.find((u) => u.id === id);
    if (!row) return { error: "not_found" } as T;
    const body = JSON.parse(String(init.body ?? "{}")) as {
      name?: string; role?: string; parent_user_id?: string | null; status?: string;
    };
    if (body.name !== undefined) row.name = body.name;
    if (body.role !== undefined) row.role = body.role;
    if (body.parent_user_id !== undefined) row.parent_user_id = body.parent_user_id;
    if (body.status !== undefined) row.status = body.status;
    row.updated_at_ms = Date.now();
    return structuredClone(row) as T;
  }
  if (init?.method === "DELETE" && /^\/admin\/users\/[^/?]+$/.test(routePath)) {
    const id = routePath.split("/")[3] ?? "";
    const row = mockUsers.find((u) => u.id === id);
    if (!row) return { error: "not_found" } as T;
    row.status = "deleted";
    row.updated_at_ms = Date.now();
    return { id: row.id, status: row.status } as T;
  }
  if (init?.method === "PUT" && /^\/admin\/users\/[^/]+\/password$/.test(routePath)) {
    const id = routePath.split("/")[3] ?? "";
    const row = mockUsers.find((u) => u.id === id);
    if (!row) return { error: "not_found" } as T;
    return { id: row.id, username: row.username } as T;
  }
  if (init?.method === "POST" && /\/admin\/users\/[^/]+\/balance\/adjust$/.test(routePath)) {
    const body = JSON.parse(String(init.body ?? "{}")) as { delta_micro?: number };
    const delta = Number(body.delta_micro ?? 0);
    const uid = routePath.split("/")[3] ?? "";
    const u = mockUsers.find((x) => x.id === uid);
    if (u) u.balance_micro += delta;
    return { balance_after_micro: u ? u.balance_micro : 0 } as T;
  }
  if (init?.method === "POST" && /\/admin\/users\/[^/]+\/balance$/.test(routePath)) {
    const body = JSON.parse(String(init.body ?? "{}")) as { amount_micro?: number };
    const amount = Number(body.amount_micro ?? 0);
    const uid = routePath.split("/")[3] ?? "";
    const u = mockUsers.find((x) => x.id === uid);
    if (u) u.balance_micro += amount;
    return { balance_after_micro: u ? u.balance_micro : 0 } as T;
  }
  // —— 用户偏好（顶栏/用户设置主题同源写服务端） ——
  if (init?.method === "GET" && routePath === "/admin/auth/preferences") {
    return structuredClone(mockPreferences) as T;
  }
  if (init?.method === "PUT" && routePath === "/admin/auth/preferences") {
    const body = JSON.parse(String(init.body ?? "{}")) as UserPreferences;
    mockPreferences = { ...mockPreferences, ...body };
    return structuredClone(mockPreferences) as T;
  }
  if (init?.method === "PUT" && path === "/admin/settings") {
    const body = JSON.parse(String(init.body ?? "{}")) as { values?: Record<string, string> };
    for (const [k, v] of Object.entries(body.values ?? {})) {
      const row = settings.find((x) => x.key === k);
      if (row) row.value = v;
    }
    return { values: body.values ?? {} } as T;
  }
  // —— GET /admin/connection（契约 §2.7）：统一连接地址，读 settings 里的 gateway_base_url ——
  // 空串 = 未配置（前端回退浏览器 host + 3600）；editable 随 mock 会话权限走（真实后端同语义）。
  if (init?.method === "GET" && routePath === "/admin/connection") {
    const row = settings.find((item) => item.key === "gateway_base_url");
    const base = row?.value ?? "";
    return {
      base_url: base,
      configured: base.trim().length > 0,
      default_port: 3600,
      endpoints: ["/v1/chat/completions", "/v1/models", "/v1/embeddings"],
      updated_at: base.trim().length > 0 ? row?.updated_at ?? "" : "",
      editable: mockSession.permissions.includes("settings:write"),
    } as T;
  }
  // —— 网关策略三文档（契约 §2.6）：GET/PUT/DELETE + validate；保存后由 POST /admin/config/apply 下发 ——
  if (init?.method === "POST" && (routePath === "/admin/policies/validate" || routePath === "/admin/guardrails/validate" || routePath === "/admin/mcp-servers/validate")) {
    // mock 演示：文档级 AG 校验始终通过（页面级成对校验已在前端拦截）
    return { ok: true, errors: [], warnings: [] } as T;
  }
  if (init?.method === "GET" && routePath === "/admin/policies") {
    return policyPayload() as T;
  }
  if (init?.method === "PUT" && routePath === "/admin/policies") {
    const body = JSON.parse(String(init.body ?? "{}")) as { config?: PolicyConfig };
    if (!body.config) throw new Error("body 必须是 {config}");
    policyConfig = structuredClone(body.config);
    policyUpdatedAt = Date.now();
    return policyPayload() as T;
  }
  if (init?.method === "DELETE" && routePath === "/admin/policies") {
    policyConfig = structuredClone(DEFAULT_POLICY_CONFIG);
    policyUpdatedAt = 0;
    return policyPayload() as T;
  }
  if (init?.method === "GET" && routePath === "/admin/guardrails") {
    return guardrailPayload() as T;
  }
  if (init?.method === "PUT" && routePath === "/admin/guardrails") {
    const body = JSON.parse(String(init.body ?? "{}")) as { config?: GuardrailConfig };
    if (!body.config) throw new Error("body 必须是 {config}");
    guardrailConfig = structuredClone(body.config);
    guardrailUpdatedAt = Date.now();
    return guardrailPayload() as T;
  }
  if (init?.method === "DELETE" && routePath === "/admin/guardrails") {
    guardrailConfig = structuredClone(DEFAULT_GUARDRAIL_CONFIG);
    guardrailUpdatedAt = 0;
    return guardrailPayload() as T;
  }
  if (init?.method === "GET" && routePath === "/admin/mcp-servers") {
    return mcpPayload() as T;
  }
  if (init?.method === "PUT" && routePath === "/admin/mcp-servers") {
    const body = JSON.parse(String(init.body ?? "{}")) as { servers?: McpServerConfig[]; port?: number | null };
    const servers = body.servers ?? [];
    const names = servers.map((server) => server.name);
    if (new Set(names).size !== names.length) throw new Error("MCP 服务器名称重复");
    mcpConfig = { servers: structuredClone(servers), port: body.port ?? null };
    mcpUpdatedAt = Date.now();
    return mcpPayload() as T;
  }
  // 保存链终点：渲染/校验/下发 → 配置修订留档（config_revisions 列表同步可见）
  if (init?.method === "POST" && routePath === "/admin/config/apply") {
    const body = JSON.parse(String(init.body ?? "{}")) as { reason?: string };
    const revision: ConfigRevision = {
      id: "cr_" + String(configRevisions.length + 1).padStart(2, "0"),
      artifact_hash: "h" + Math.random().toString(16).slice(2, 11),
      adapter_id: "openai-chat",
      operator: mockSession.username,
      reason: body.reason ?? "网关策略下发",
      status: "active",
      previous_revision_id: configRevisions.find((r) => r.status === "active")?.id ?? null,
      created_at_ms: Date.now(),
    };
    for (const row of configRevisions) {
      if (row.status === "active") row.status = "superseded";
    }
    configRevisions.unshift(revision);
    return { id: revision.id, status: revision.status, artifact_hash: revision.artifact_hash } as T;
  }
  // —— 角色 CRUD（契约：内置角色权限不可改、内置/有成员角色不可删，错误信息与后端同文） ——
  if (init?.method === "GET" && routePath === "/admin/roles") {
    return { items: adminRoles.map(rolePayload), total: adminRoles.length } as T;
  }
  if (init?.method === "POST" && routePath === "/admin/roles") {
    const body = JSON.parse(String(init.body ?? "{}")) as {
      name?: string; description?: string; permissions?: string[]; key?: string;
    };
    const name = (body.name ?? "").trim();
    if (name.length === 0) throw new Error("角色名称不能为空");
    if (name.length > 64) throw new Error("角色名称过长");
    if (adminRoles.some((r) => r.name === name)) throw new Error("角色名称已存在: " + name);
    let key = (body.key ?? "").trim();
    if (key.length > 0) {
      if (!/^[a-z][a-z0-9_]{2,31}$/.test(key)) {
        throw new Error("角色标识须为 3-32 位小写字母/数字/下划线且以字母开头");
      }
      if (RESERVED_ROLE_KEYS.has(key) || adminRoles.some((r) => r.key === key)) {
        throw new Error("角色标识已保留或存在: " + key);
      }
    } else {
      key = "custom_" + Math.random().toString(16).slice(2, 10);
    }
    const created: RoleDefinition = {
      id: "rol_" + Math.random().toString(16).slice(2, 10),
      key,
      name,
      description: (body.description ?? "").trim().slice(0, 255),
      builtin: false,
      all_permissions: false,
      permissions: [...new Set(body.permissions ?? [])],
      member_count: 0,
    };
    adminRoles.push(created);
    return rolePayload(created) as T;
  }
  if (init?.method === "PATCH" && /^\/admin\/roles\/[^/?]+$/.test(routePath)) {
    const row = roleFromId(routePath.split("/")[3] ?? "");
    const body = JSON.parse(String(init.body ?? "{}")) as {
      name?: string; description?: string; permissions?: string[];
    };
    if (body.permissions !== undefined && row.builtin) throw new Error("内置角色的权限不可修改（" + row.key + "）");
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (name.length === 0) throw new Error("角色名称不能为空");
      if (adminRoles.some((r) => r.id !== row.id && r.name === name)) throw new Error("角色名称已存在: " + name);
      row.name = name;
    }
    if (body.description !== undefined) row.description = body.description.trim().slice(0, 255);
    if (body.permissions !== undefined) row.permissions = [...new Set(body.permissions)];
    return rolePayload(row) as T;
  }
  if (init?.method === "DELETE" && /^\/admin\/roles\/[^/?]+$/.test(routePath)) {
    const row = roleFromId(routePath.split("/")[3] ?? "");
    if (row.builtin) throw new Error("内置角色不可删除");
    const used = rolePayload(row).member_count;
    if (used > 0) throw new Error("仍有 " + used + " 个用户使用该角色，无法删除");
    adminRoles.splice(adminRoles.indexOf(row), 1);
    return { deleted: true } as T;
  }
  if (init?.method === "GET" && /\/admin\/users\/[^/]+\/ledger$/.test(routePath)) {
    const uid = routePath.split("/")[3] ?? "";
    return ledgerFor(uid) as T;
  }
  // —— B2 CRUD：上游 ——
  // 上游详情 GET：详情页整页编辑器依赖（mock 早前只有列表）
  if (init?.method === "GET" && /^\/admin\/upstreams\/[^/?]+$/.test(path.split("?")[0] ?? "")) {
    const id = (path.split("?")[0] ?? "").split("/")[3] ?? "";
    const row = upstreams.find((u) => u.id === id);
    if (!row) return { error: "not_found" } as T;
    return {
      ...structuredClone(row),
      model_count: upstreamModels.filter((m) => m.upstream_id === id).length,
    } as T;
  }
  // 密钥组列表（演示空表；真实形状见 UpstreamKeyList，UI 归 D 波）
  if (init?.method === "GET" && /^\/admin\/upstreams\/[^/?]+\/keys$/.test(path.split("?")[0] ?? "")) {
    return { items: [], limit: 100 } as T;
  }
  // 契约 3.2：POST body {vendor_id, base_url, api_style, api_key}；name 由 {vendor_slug}-NN 自动生成
  if (init?.method === "POST" && (path.split("?")[0] ?? "") === "/admin/upstreams") {
    const body = JSON.parse(String(init.body ?? "{}")) as { vendor_id?: string; base_url?: string; api_style?: string; api_key?: string };
    const vendor = vendors.find((x) => x.id === (body.vendor_id ?? ""));
    vendorSeq += 1;
    const created: Upstream = {
      id: "up_" + String(upstreams.length + 1).padStart(2, "0"),
      name: (vendor ? vendor.slug : "new") + "-" + String(vendorSeq).padStart(2, "0"),
      vendor_id: body.vendor_id ?? "",
      base_url: body.base_url ?? "",
      api_style: body.api_style ?? "openai_chat",
      transforms: null,
      max_buffer_bytes: 2097152,
      enabled: true,
      created_at_ms: Date.now(),
    };
    upstreams.push(created);
    return created as T;
  }
  // 契约 3.2 PATCH：可改 base_url/api_style/enabled；DELETE 契约未定义，mock 保留容错
  if ((init?.method === "PATCH" || init?.method === "PUT" || init?.method === "DELETE") && /^\/admin\/upstreams\/[^/?]+$/.test(path.split("?")[0] ?? "")) {
    const id = (path.split("?")[0] ?? "").split("/")[3] ?? "";
    const idx = upstreams.findIndex((u) => u.id === id);
    if (idx < 0) return { error: "not_found" } as T;
    if (init.method === "DELETE") {
      upstreams.splice(idx, 1);
      return { deleted: true } as T;
    }
    const body = JSON.parse(String(init.body ?? "{}")) as { base_url?: string; api_style?: string; enabled?: boolean };
    const row = upstreams[idx];
    if (row) {
      if (body.base_url !== undefined) row.base_url = body.base_url;
      if (body.api_style !== undefined) row.api_style = body.api_style;
      if (body.enabled !== undefined) row.enabled = body.enabled;
    }
    return row as T;
  }
  // —— B2 CRUD：上游模型 ——
  if (init?.method === "POST" && (path.split("?")[0] ?? "") === "/admin/upstream-models") {
    const body = JSON.parse(String(init.body ?? "{}")) as { upstream_id?: string; name?: string; model_type?: string; enabled?: boolean };
    const created: UpstreamModel = {
      id: "um_" + String(upstreamModels.length + 1).padStart(2, "0"),
      upstream_id: body.upstream_id ?? "",
      name: body.name ?? "未命名模型",
      model_type: body.model_type ?? "chat",
      enabled: body.enabled ?? true,
      created_at_ms: Date.now(),
    };
    upstreamModels.push(created);
    return created as T;
  }
  // 上游模型 PATCH：成本/倍率（价目管理，显式 null 清空）+ 编辑字段与启停/冷却（省略字段保持不动）
  if (init?.method === "PATCH" && /^\/admin\/upstream-models\/(?!batch$)[^/?]+$/.test(path.split("?")[0] ?? "")) {
    const id = (path.split("?")[0] ?? "").split("/")[3] ?? "";
    const row = upstreamModels.find((x) => x.id === id);
    if (!row) return { error: "not_found" } as T;
    const body = JSON.parse(String(init.body ?? "{}")) as Partial<UpstreamModel>;
    if (body.cost_input_per_1m !== undefined) row.cost_input_per_1m = body.cost_input_per_1m;
    if (body.cost_output_per_1m !== undefined) row.cost_output_per_1m = body.cost_output_per_1m;
    if (body.markup !== undefined) row.markup = body.markup;
    if (body.name !== undefined) row.name = body.name;
    if (body.model_type !== undefined) row.model_type = body.model_type;
    if (body.model_type_source !== undefined) row.model_type_source = body.model_type_source;
    if (body.parameters !== undefined) row.parameters = body.parameters;
    if (body.enabled !== undefined) row.enabled = body.enabled;
    if (body.enabled === true) row.cooldown_until_ms = 0; // 启用同时清掉冷却（GLOSSARY §3）
    if (body.cooldown_until_ms !== undefined) row.cooldown_until_ms = body.cooldown_until_ms;
    return row as T;
  }
  if (init?.method === "PUT" && /^\/admin\/upstream-models\/[^/?]+$/.test(path.split("?")[0] ?? "")) {
    const id = (path.split("?")[0] ?? "").split("/")[3] ?? "";
    const row = upstreamModels.find((x) => x.id === id);
    if (!row) return { error: "not_found" } as T;
    const body = JSON.parse(String(init.body ?? "{}")) as Partial<UpstreamModel>;
    if (body.name !== undefined) row.name = body.name;
    if (body.model_type !== undefined) row.model_type = body.model_type;
    if (body.enabled !== undefined) row.enabled = body.enabled;
    return row as T;
  }
  // 模型探测（W5 ticket 07）：不落库；mock 逐模型给出成功/失败示例，便于演示会话内结果。
  if (init?.method === "POST" && /^\/admin\/upstreams\/[^/?]+\/models\/probe$/.test(path.split("?")[0] ?? "")) {
    const body = JSON.parse(String(init.body ?? "{}")) as { model_ids?: string[]; model_id?: string; key_id?: string };
    const ids = body.model_ids ?? (body.model_id ? [body.model_id] : []);
    const items = ids
      .map((modelId) => upstreamModels.find((m) => m.id === modelId))
      .filter((m): m is UpstreamModel => Boolean(m))
      .map((m, index) => {
        const failed = m.model_type === "embedding" || index % 3 === 2;
        return {
          model_id: m.id,
          model: m.name,
          ok: !failed,
          status: failed ? 400 : 200,
          latency_ms: failed ? 240 : 320 + index * 15,
          error_type: failed ? "http" : "",
          message: failed ? "上游返回 HTTP 400：model not supported" : "",
        };
      });
    return { upstream_id: (path.split("?")[0] ?? "").split("/")[3] ?? "", key_id: body.key_id ?? "", items } as T;
  }
  // —— B2 CRUD：对外模型 ——
  // GET 实时组装（契约默认内嵌 targets[]），不能用路由表的模块级快照
  if (init?.method === "GET" && (path.split("?")[0] ?? "") === "/admin/public-models") {
    return publicModelsView() as T;
  }
  if (init?.method === "POST" && (path.split("?")[0] ?? "") === "/admin/public-models") {
    const body = JSON.parse(String(init.body ?? "{}")) as {
      name?: string; routing_mode?: string; note?: string | null; enabled?: boolean;
      targets?: Array<{ upstream_model_id?: string; priority?: number | null; weight?: number | null; when?: string | null }>;
    };
    const created: PublicModel = {
      id: "pm_" + String(publicModels.length + 1).padStart(2, "0"),
      name: body.name ?? "未命名公开模型",
      routing_mode: (body.routing_mode ?? "failover") as PublicModel["routing_mode"],
      note: body.note ?? null,
      enabled: body.enabled ?? true,
      created_at_ms: Date.now(),
    };
    publicModels.push(created);
    for (const t of body.targets ?? []) {
      const member = upstreamModels.find((m) => m.id === t.upstream_model_id);
      mtSeq += 1;
      modelTargets.push({
        id: "mt_" + String(mtSeq).padStart(2, "0"),
        public_model_id: created.id,
        upstream_model_id: t.upstream_model_id ?? "",
        upstream_model_name: member?.name ?? "",
        upstream_name: member?.upstream_name ?? "",
        priority: t.priority ?? null,
        weight: t.weight ?? null,
        when: t.when ?? null,
        enabled: true,
      });
    }
    return created as T;
  }
  // 编辑公开模型：基本字段 + 可选 targets 整批替换（ticket 12 单 PATCH；旧 PUT .../targets 已删除）
  if (init?.method === "PATCH" && /^\/admin\/public-models\/(?!batch$)[^/?]+$/.test(path.split("?")[0] ?? "")) {
    const id = (path.split("?")[0] ?? "").split("/")[3] ?? "";
    const row = publicModels.find((p) => p.id === id);
    if (!row) return { error: "not_found" } as T;
    const body = JSON.parse(String(init.body ?? "{}")) as Partial<PublicModel> & {
      targets?: Array<{ upstream_model_id?: string; priority?: number | null; weight?: number | null; when?: string | null }>;
    };
    if (body.name !== undefined) row.name = body.name;
    if (body.routing_mode !== undefined) row.routing_mode = body.routing_mode;
    if (body.note !== undefined) row.note = body.note;
    if (body.enabled !== undefined) row.enabled = body.enabled;
    if (body.enabled === true) row.cooldown_until_ms = 0; // 启用同时清掉冷却（GLOSSARY §3）
    if (body.cooldown_until_ms !== undefined) row.cooldown_until_ms = body.cooldown_until_ms;
    if (body.targets !== undefined) {
      // 与真实后端一致：成员清空非法，且整批替换是这一张 PATCH 的一部分。
      if (body.targets.length === 0) return { error: "at_least_one_member" } as T;
      for (let i = modelTargets.length - 1; i >= 0; i--) {
        const mt = modelTargets[i];
        if (mt && mt.public_model_id === id) modelTargets.splice(i, 1);
      }
      for (const t of body.targets) {
        const member = upstreamModels.find((m) => m.id === t.upstream_model_id);
        mtSeq += 1;
        modelTargets.push({
          id: "mt_" + String(mtSeq).padStart(2, "0"),
          public_model_id: id,
          upstream_model_id: t.upstream_model_id ?? "",
          upstream_model_name: member?.name ?? "",
          upstream_name: member?.upstream_name ?? "",
          priority: t.priority ?? null,
          weight: t.weight ?? null,
          when: t.when ?? null,
          enabled: true,
        });
      }
    }
    return row as T;
  }
  if (init?.method === "DELETE" && /^\/admin\/public-models\/[^/?]+$/.test(path.split("?")[0] ?? "")) {
    const id = (path.split("?")[0] ?? "").split("/")[3] ?? "";
    const idx = publicModels.findIndex((p) => p.id === id);
    if (idx < 0) return { error: "not_found" } as T;
    publicModels.splice(idx, 1);
    for (let i = modelTargets.length - 1; i >= 0; i--) {
      const mt = modelTargets[i];
      if (mt && mt.public_model_id === id) modelTargets.splice(i, 1);
    }
    return { deleted: true } as T;
  }
  // —— 目标绑定：GET 按 public_model_id 过滤；PUT 整批替换 ——
  if (init?.method === "GET" && (path.split("?")[0] ?? "") === "/admin/model-targets") {
    const pmid = new URLSearchParams(path.split("?")[1] ?? "").get("public_model_id") ?? "";
    return modelTargets.filter((mt) => mt.public_model_id === pmid) as T;
  }
  if (init?.method === "PUT" && (path.split("?")[0] ?? "") === "/admin/model-targets") {
    const body = JSON.parse(String(init.body ?? "{}")) as { public_model_id?: string; targets?: Array<{ upstream_model_name?: string; upstream_name?: string; priority?: number | null; weight?: number | null; when?: string | null; enabled?: boolean }> };
    const pmid = body.public_model_id ?? "";
    for (let i = modelTargets.length - 1; i >= 0; i--) {
      const mt = modelTargets[i];
      if (mt && mt.public_model_id === pmid) modelTargets.splice(i, 1);
    }
    for (const t of body.targets ?? []) {
      mtSeq += 1;
      modelTargets.push({
        id: "mt_" + String(mtSeq).padStart(2, "0"),
        public_model_id: pmid,
        upstream_model_name: t.upstream_model_name ?? "",
        upstream_name: t.upstream_name ?? "",
        priority: t.priority ?? null,
        weight: t.weight ?? null,
        when: t.when ?? null,
        enabled: t.enabled ?? true,
      });
    }
    return { saved: modelTargets.filter((mt) => mt.public_model_id === pmid).length } as T;
  }

  if (init?.method === "GET" && (path.split("?")[0] ?? "") === "/admin/prices/public-models") {
    return derivePublicModelPrices() as T;
  }

  // —— ADR-004 规则表：周期冷却由模型页创建/删除 ——
  if (init?.method === "POST" && routePath === "/admin/availability-rules") {
    const body = JSON.parse(String(init.body ?? "{}")) as Partial<AvailabilityRule>;
    const created: AvailabilityRule = {
      id: "ar_" + String(availabilityRules.length + 1).padStart(2, "0"),
      kind: (body.kind ?? "cooldown") as AvailabilityRule["kind"],
      scope: body.scope ?? "upstream_model",
      scope_id: body.scope_id ?? "",
      recurrence: (body.recurrence ?? "once") as AvailabilityRule["recurrence"],
      expires_at_ms: body.expires_at_ms ?? null,
      schedule_json: body.schedule_json ?? null,
      note: body.note ?? "",
      created_at_ms: Date.now(),
    };
    availabilityRules.push(created);
    return created as T;
  }
  if ((init?.method === "PATCH" || init?.method === "DELETE") && /^\/admin\/availability-rules\/[^/?]+$/.test(routePath)) {
    const id = routePath.split("/")[3] ?? "";
    const idx = availabilityRules.findIndex((rule) => rule.id === id);
    if (idx < 0) return { error: "not_found" } as T;
    if (init.method === "DELETE") {
      availabilityRules.splice(idx, 1);
      return { deleted: true } as T;
    }
    const body = JSON.parse(String(init.body ?? "{}")) as Partial<AvailabilityRule>;
    const row = availabilityRules[idx];
    if (row) Object.assign(row, body);
    return row as T;
  }

  if (init?.method === "GET" && routePath === "/admin/audit-logs") {
    const params = new URLSearchParams(path.split("?")[1] ?? "");
    const limit = Number(params.get("limit") ?? auditLogs.length);
    const offset = Number(params.get("offset") ?? 0);
    return { items: auditLogs.slice(offset, offset + limit), total: auditLogs.length } as T;
  }

  // —— 使用日志：筛选/排序/分页（W6 补桩，对齐 routers_ops.search_logs） ——
  if (init?.method === "GET" && routePath === "/admin/logs") {
    return queryMockLogs(new URLSearchParams(path.split("?")[1] ?? "")) as T;
  }
  // —— ADR-028：日志详情 + 路由链（GET /admin/logs/{id} 与 /admin/logs/{id}/attempts） ——
  if (init?.method === "GET" && /^\/admin\/logs\/[^/]+$/.test(routePath)) {
    const eventId = routePath.split("/")[3] ?? "";
    const row = mockLogs.find((item) => item.event_id === eventId);
    if (!row) throw new Error("日志不存在：" + eventId);
    const includePayload = new URLSearchParams(path.split("?")[1] ?? "").get("include_payload") === "true";
    if (!includePayload) return structuredClone(row) as T;
    const raw: Record<string, unknown> = {
      gen_ai_operation_name: "chat",
      gen_ai_request_model: row.upstream_model,
      gen_ai_response_model: row.public_model,
      agentgateway_user: row.user_name,
      has_payload: row.has_payload,
    };
    if (row.trace_id) {
      raw.trace_id = row.trace_id;
      raw.span_id = row.trace_id === "tr_m5b_three" ? "sp_root_three" : "sp_root_retry";
    }
    return { ...structuredClone(row), raw_json: JSON.stringify(raw) } as T;
  }
  if (init?.method === "GET" && /^\/admin\/logs\/[^/]+\/attempts$/.test(routePath)) {
    const eventId = decodeURIComponent(routePath.split("/")[3] ?? "");
    const row = mockLogs.find((item) => item.event_id === eventId);
    if (!row) throw new Error("日志不存在：" + eventId);
    const detail = mockAttempts[row.trace_id];
    if (!detail) return { event_id: eventId, trace_id: "", attempts: [] } as T;
    return { ...structuredClone(detail), event_id: eventId } as T;
  }

  // —— 批量操作：上游/公开模型 enable/disable/delete（契约 3.3） ——
  if (init?.method === "PATCH" && /^\/admin\/(upstream-models|public-models)\/batch$/.test(routePath)) {
    const body = JSON.parse(String(init.body ?? "{}")) as { ids?: string[]; action?: string };
    const isPublic = routePath.startsWith("/admin/public-models");
    const list = isPublic ? publicModels : upstreamModels;
    const changed: string[] = [];
    const missing: string[] = [];
    const failed: Array<{ id: string; code: string; message: string }> = [];
    for (const id of body.ids ?? []) {
      const idx = list.findIndex((row) => row.id === id);
      if (idx < 0) {
        missing.push(id);
        continue;
      }
      if (body.action === "delete") {
        list.splice(idx, 1);
        if (isPublic) {
          for (let i = modelTargets.length - 1; i >= 0; i--) {
            if (modelTargets[i]?.public_model_id === id) modelTargets.splice(i, 1);
          }
        }
      } else {
        list[idx]!.enabled = body.action !== "disable";
      }
      changed.push(id);
    }
    return { action: body.action ?? "", changed, missing, failed } as T;
  }

  // 契约 3.4：DELETE /admin/api-keys/{key_id} 直接删除（ADR-023）
  if (init?.method === "DELETE" && /^\/admin\/api-keys\/[^/?]+$/.test(routePath)) {
    const id = routePath.split("/")[3] ?? "";
    const idx = clientKeys.findIndex((k) => k.id === id);
    if (idx < 0) return { error: "not_found" } as T;
    clientKeys.splice(idx, 1);
    return { deleted: true } as T;
  }

  // —— ADR-020 价目导出/导入（W6 补桩） ——
  if (init?.method === "GET" && routePath === "/admin/prices/export") {
    return {
      schema_version: 1,
      exported_at_ms: Date.now(),
      meta: { cache_prices: "out-of-scope-v1" },
      upstream_models: upstreamModels.map((m) => ({
        id: m.id,
        name: m.name,
        model_type: m.model_type,
        cost_input_per_1m: m.cost_input_per_1m ?? null,
        cost_output_per_1m: m.cost_output_per_1m ?? null,
        markup: m.markup ?? null,
      })),
    } as T;
  }
  if (init?.method === "POST" && routePath === "/admin/prices/import") {
    const body = JSON.parse(String(init.body ?? "{}")) as {
      upstream_models?: Array<{
        id?: string | null;
        name?: string | null;
        cost_input_per_1m?: string | null;
        cost_output_per_1m?: string | null;
        markup?: string | null;
      }>;
    };
    let changed = 0;
    let skipped = 0;
    for (const item of body.upstream_models ?? []) {
      const row = upstreamModels.find((m) => (item.id ? m.id === item.id : m.name === item.name));
      if (!row) continue; // mock 演示：未知行静默跳过（真实后端整批 422）
      const patch: Partial<UpstreamModel> = {};
      if (item.cost_input_per_1m !== undefined && item.cost_input_per_1m !== null) patch.cost_input_per_1m = item.cost_input_per_1m;
      if (item.cost_output_per_1m !== undefined && item.cost_output_per_1m !== null) patch.cost_output_per_1m = item.cost_output_per_1m;
      if (item.markup !== undefined && item.markup !== null) patch.markup = item.markup;
      if (Object.keys(patch).length === 0) {
        skipped += 1;
        continue;
      }
      Object.assign(row, patch);
      changed += 1;
    }
    return { changed, missing: [], skipped } as T;
  }

  const hit = routes.find(([re]) => re.test(routePath));
  if (!hit) throw new Error("mock 未覆盖该路径：" + path);
  return structuredClone(hit[1]) as T;
}
