/** 后端字段一律 snake_case，前端不做二次改名。 */

import type { RevisionStatus } from "@/lib/revision-status";

export type { RevisionStatus } from "@/lib/revision-status";

export interface OverviewStats {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  charge_micro: number;
  cost_micro: number;
  margin_micro: number;
  currency: string;
  latency_p50_ms: number;
  latency_p95_ms: number;
  ttft_p50_ms: number;
  estimate_note: string | null;
}

export interface Vendor {
  id: string;
  name: string;
  slug: string;
  note: string | null;
  upstream_seq: number;
  created_at_ms: number;
}

/** 实测 /admin/upstreams：名称形如 {vendor_slug}-NN；counts/last_probe 为 ticket 09 新增 */
export interface Upstream {
  id: string;
  name: string;
  vendor_id: string;
  base_url: string;
  api_style: string;
  transforms: string | null;
  max_buffer_bytes: number;
  enabled: boolean;
  created_at_ms: number;
  /** 服务端统计的密钥行数（含迁移前的内联密钥） */
  key_count?: number;
  /** 服务端统计的本上游模型数 */
  model_count?: number;
  /** 最近一次 test-connection / discover-models 的结果 */
  last_probe?: UpstreamProbe | null;
}

/** GET /admin/upstreams/{id}/keys 的一项；明文只在新增时提交，永不回读。
 *  ADR-026：密钥平权无主备，每把密钥在适配层展开为一个独立 AG 上游。 */
export interface UpstreamKey {
  id: string;
  label: string;
  /** 形如 …a1b2，仅尾 4 位 */
  masked: string;
  key_suffix: string;
  created_at_ms: number;
  /** 最近一次逐把测试（POST keys/test 落库）；null = 从未测试 */
  last_test: {
    key_id: string;
    ok: boolean;
    status_code: number;
    latency_ms: number;
    error: string;
  } | null;
  last_test_at_ms: number;
}

export interface UpstreamKeyList {
  items: UpstreamKey[];
  limit: number;
}

export type UpstreamProbeStatus = "ok" | "error" | "timeout";

export interface UpstreamProbe {
  id: string;
  kind: "test" | "discover";
  status: UpstreamProbeStatus;
  /** 0 表示没拿到 HTTP 响应（超时/连接失败） */
  http_status: number;
  latency_ms: number;
  message: string;
  model_count: number;
  /** 历史探测记录可能没有该字段（旧数据/旧版本写库），读取方必须兜底 */
  models?: string[];
  tested_at_ms: number;
}

export interface UpstreamProbeResult extends UpstreamProbe {
  upstream_id: string;
}

export interface UpstreamBatchResult {
  changed: string[];
  missing: string[];
  failed: { id: string; code: string; message: string }[];
  action: "enable" | "disable" | "delete";
}

export interface UpstreamImportResult {
  upstream_id: string;
  created: string[];
  skipped: string[];
  errors: { name: string; message: string }[];
}

/** 类型来源：旧系统 channel_models.model_type_source（default/upstream/manual）。 */
export type ModelTypeSource = "default" | "upstream" | "manual";

/** 行级可用性：关闭（人工长期）/ 冷却（到期自愈）/ 正常，没有排期语义。 */
export type ModelAvailabilityState = "normal" | "cooling" | "closed";

export interface ModelAvailability {
  state: ModelAvailabilityState;
  /** 冷却截止的 epoch 毫秒；state=cooling 时必然在将来 */
  cooldown_until_ms?: number;
}

/** 旧系统 channel_models.parameters：0 表示未声明，输入/输出类型各至少 1 个。 */
export interface ModelParameters {
  max_input_tokens: number;
  max_output_tokens: number;
  reasoning_level: string;
  input_types: string[];
  output_types: string[];
  tool_call: boolean;
  reasoning: boolean;
  attachment: boolean;
  structured_output: boolean;
}

/** PATCH /admin/{upstream,public}-models/batch：部分成功逐条报告。 */
export interface ModelBatchResult {
  action: string;
  changed: string[];
  missing: string[];
  failed: { id: string; code: string; message: string }[];
}

export interface UpstreamModel {
  id: string;
  upstream_id: string;
  /** 后端字段名即 name（旧前端叫 model_name） */
  name: string;
  model_type: string;
  enabled: boolean;
  created_at_ms: number;
  /** 实测 GET /admin/upstream-models 附带的服务端 join 字段（可缺省） */
  upstream_name?: string;
  vendor_name?: string;
  /** ticket 10：类型来源（旧系统 default/upstream/manual） */
  model_type_source?: ModelTypeSource;
  /** ticket 10：能力参数块（旧系统 scalar） */
  parameters?: ModelParameters;
  /** ticket 10：行级冷却截止；0 = 无冷却 */
  cooldown_until_ms?: number;
  availability?: ModelAvailability;
  /** 被公开模型成员引用的次数；> 0 时后端拒绝删除 */
  target_count?: number;
  /** ticket 05 成本账与倍率（旧接口未返回时缺省） */
  cost_input_per_1m?: string | null;
  cost_output_per_1m?: string | null;
  markup?: string;
  /** W4-H：参数块来源（manual=人工录入 / models.dev=最近一次兑入填过空键） */
  params_source?: ModelParamsSource;
}

/** W4-H：参数块来源徽章。 */
export type ModelParamsSource = "manual" | "models.dev";

/** W4-H：POST /admin/upstream-models/{id}/adopt-modelsdev 单条兑入结果（逐键状态）。 */
export interface AdoptModelsDevResult {
  id: string;
  name: string;
  matched: boolean;
  /** filled=已填空键 / nothing-to-fill=无空键可填 / no-match=未命中 models.dev */
  status: string;
  provider?: string;
  model?: string;
  /** 本次是否真的刷新了快照（false=拉取失败，降级用库内快照） */
  refreshed?: boolean;
  /** 逐键结果：键（parameters.xxx / cost_input_per_1m …）→ filled / skipped-manual / skipped-no-fx */
  results?: Record<string, string>;
  filled?: string[];
  params_source?: ModelParamsSource;
}

/** W4-H：GET /admin/upstream-models/modelsdev-status 已存快照摘要（上次同步时间）。 */
export interface ModelsDevSnapshotStatus {
  models: number;
  providers: number;
  /** 0 = 从未同步；否则为快照抓取时刻（毫秒时间戳） */
  fetched_at_ms: number;
}

/** W4-H：POST /admin/upstream-models/adopt-modelsdev 批量同步汇总。 */
export interface AdoptModelsDevBatchResult {
  refreshed: boolean;
  snapshot?: { providers?: number; models?: number; fetched_at_ms?: number };
  total: number;
  matched: number;
  filled_models: number;
  filled_keys: number;
  no_match: number;
  items: AdoptModelsDevResult[];
}

/** W4-H：GET /admin/my/models 行（登录用户可见的启用公开模型参数，无金额键）。 */
export interface MyModelOut {
  name: string;
  model_type: string;
  parameters: ModelParameters;
  sources: string[];
}

export interface ModelTarget {
  id: string;
  public_model_id: string;
  /** ticket 10：成员按上游模型 id 关联（旧前端按名称填报） */
  upstream_model_id?: string;
  upstream_model_name: string;
  upstream_name: string;
  /** failover 层级，数值小优先；weighted/conditional 下可空 */
  priority: number | null;
  /** weighted 模式的整数相对权重（1 与 3 = 1:3） */
  weight: number | null;
  /** conditional 模式的条件表达式，如 request.user_id == "u1" */
  when: string | null;
  enabled: boolean;
}

export type RoutingMode = "failover" | "weighted" | "conditional";

export interface PublicModel {
  id: string;
  name: string;
  routing_mode: RoutingMode;
  note: string | null;
  enabled: boolean;
  created_at_ms: number;
  /** ticket 10：行级可用性，与上游模型同一套语义 */
  cooldown_until_ms?: number;
  availability?: ModelAvailability;
  target_count?: number;
  /** GET /admin/public-models 直接内联成员列表（服务端已按 priority 升序） */
  targets?: ModelTarget[];
}

export interface TopupRecord {
  ts: string;
  amount_tokens: number;
  note: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  /** 掩码展示，如 sk-…G7H8 */
  mask: string;
  key_suffix: string;
  status: "active" | "disabled";
  created_at_ms: number;
  /** ADR-023：连接密钥名称（可改）；旧 mock 行没有该字段 */
  name?: string;
  /** 最近一次使用时间；缺省/null = 从未使用 */
  last_used_at_ms?: number | null;
}

export type CooldownRecurrence = "once" | "daily" | "weekly" | "monthly";

/** ADR-004 availability rule: rules table is the only authoritative measure. */
export interface AvailabilityRule {
  id: string;
  kind: "ban" | "cooldown";
  /** model_target | upstream | upstream_model | public_model */
  scope: string;
  scope_id: string;
  recurrence: CooldownRecurrence;
  /** 仅 recurrence=once 的冷却有具体截止；周期规则用 schedule_json 描述窗口 */
  expires_at_ms: number | null;
  schedule_json: string | null;
  note: string;
  created_at_ms: number;
}

export type PriceItem = "input" | "output" | "cache_read" | "cache_write" | "request";

/** 上游价目（成本账）：单价为每 1M tokens 的整数微单位，item=request 时按次 */
export interface UpstreamPrice {
  id: string;
  vendor_name: string;
  upstream_model: string;
  item: PriceItem;
  unit_price_micro: number;
  currency: string;
  effective_from: string;
  version: number;
}

/** 下游价目（营收账）：markup 用万分数避免浮点（12000 = 1.2 倍）；fixed 单价同上游单位 */
export interface ChargePrice {
  id: string;
  public_model: string;
  item: PriceItem;
  mode: "markup" | "fixed";
  value: number;
  currency: string;
  effective_from: string;
  version: number;
}

/** 请求明细：成本与花费两列并存，null = 待补价（未定价不写 0） */
/** 成本流水（运营侧）：/admin/cost/entries */
export interface CostEntry {
  id: string;
  gateway_event_id: string;
  vendor_id: string;
  upstream_model_id: string;
  input_tokens: number;
  output_tokens: number;
  amount_micro: number;
  currency: string;
  price_version_id: string | null;
  status: "ok" | "unpriced" | "free";
}

/** 花费流水（用户侧）：/admin/charge/entries */
export interface ChargeEntry {
  id: string;
  gateway_event_id: string;
  user_id: string;
  public_model_id: string;
  input_tokens: number;
  output_tokens: number;
  amount_micro: number;
  currency: string;
  price_version_id: string | null;
  status: "ok" | "unpriced" | "free";
  /** ticket 17：同一事件的成本，用于「花费 + 成本」合并列；无 billing:cost 时后端不返回该键 */
  cost_micro?: number | null;
}

/** 待补价：/admin/unpriced → {cost, charge} */
export interface UnpricedList {
  cost: CostEntry[];
  charge: ChargeEntry[];
}

export interface ConfigRevision {
  id: string;
  artifact_hash: string;
  adapter_id: string;
  operator: string;
  reason: string;
  /** 唯一词表见 lib/revision-status.ts，与后端 RevisionStatus 枚举同源。 */
  status: RevisionStatus;
  error_detail?: string | null;
  validation_note?: string | null;
  previous_revision_id: string | null;
  created_at_ms: number;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  target: string;
  created_at: string;
  detail: string;
}

export interface AuditLogList {
  items: AuditLog[];
  total: number;
}

/** 策略快照（只读）：GET /admin/policies 返回单对象 */
export interface PolicySnapshot {
  cors: {
    allow_origins: string[];
    allow_credentials: boolean;
    env_override: string;
    note: string;
  };
  key_auth: { scheme: string; storage: string; reveal: string; failure: string };
  local_rate_limit: { key: string; type: string; tokensPerFill: number; semantics: string };
  transforms_defaults: {
    response_header_deletes: string[];
    response_body_guard: string;
    protected_request_headers: string[];
    forbidden_body_paths: string[];
    mount: string;
  };
  routing: { modes: RoutingMode[]; failover: string; weighted: string; conditional: string };
  counts: Record<string, number>;
}

/** 能力矩阵：supported=false 为路线图说明而非今日可配置；verified=false 表示尚未经数据面实测 */
export interface GuardrailCapability {
  key: string;
  supported: boolean;
  since_version: string;
  note: string;
  verified: boolean;
}

export interface GuardrailMatrix {
  adapter: string;
  items: GuardrailCapability[];
  note: string;
}

/** MCP servers：数据面 v1 暂不支持，字段为前端预留 */
export interface McpServerRow {
  name: string;
  url?: string;
  tool_count?: number;
  enabled?: boolean;
}

export interface McpServersInfo {
  supported: boolean;
  note: string;
  servers: McpServerRow[];
}

/** ── 改写规则（A 模式，契约 docs/contracts/transforms-compiler.md）── */

export type TransformSection = "request_headers" | "request_body" | "response_headers" | "response_body";
/** 契约 v2：头与体共用同一套动作词表 */
export type TransformOp = "create" | "update" | "delete" | "copy" | "prepend" | "append" | "regex_replace" | "to_upper" | "to_lower";
export type ConditionMode = "full" | "regex" | "gt" | "gte" | "lt" | "lte";

export interface RewriteCondition {
  field: string;
  mode: ConditionMode;
  value: string;
}

export interface TransformRule {
  op: TransformOp;
  /** 高级逃生舱：直接写 CEL；仍存为规则行，预览与审计口径一致 */
  mode?: "custom_cel";
  /** 头：名称（大小写不敏感）；体：目标路径 a.b.0.c */
  name?: string;
  /** 体动作的目标路径 */
  path?: string;
  /** 目标值 / custom_cel 表达式（regex_replace 不使用该字段） */
  value?: string;
  /** regex_replace 的正则源串（编译为 CEL regexReplaceAll(ref, regex, replacement)） */
  regex?: string;
  /** regex_replace 的替换文本；空串表示删除匹配 */
  replacement?: string;
  /** copy 的源（头的源头名 / 体的源路径） */
  source_path?: string;
  conditions: RewriteCondition[];
}

export interface UpstreamTransforms {
  request_headers: TransformRule[];
  request_body: TransformRule[];
  response_headers: TransformRule[];
  response_body: TransformRule[];
}

/** GET /admin/upstreams/{id}/transforms 的响应：未配置时 transforms=null */
export interface UpstreamTransformsResponse {
  upstream_id: string;
  transforms: UpstreamTransforms | null;
}

/** POST .../transforms/preview：body 是 4 段完整规则，返回编译后的 transformations 与提示 */
export interface TransformPreviewResult {
  upstream_id: string;
  before: unknown;
  after: unknown;
  skipped: string[];
  notes: string[];
}

export interface SettingItem {
  key: string;
  value: string;
  label: string;
  updated_at: string;
}

export interface SettingsList {
  items: SettingItem[];
}

export interface SettingsPutResult {
  values: Record<string, string>;
}

export interface AdminAccount {
  id: string;
  username: string;
  role: "admin" | "agent" | "user";
  enabled: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface EndUser {
  id: string;
  name: string;
  key_masked: string;
  balance_micro: number;
  consumed_micro: number;
  enabled: boolean;
  created_at: string;
}

/** 运营设置·统一连接地址（ticket 16）：空 base_url = 跟随浏览器当前 host + default_port。 */
export interface ConnectionInfo {
  base_url: string;
  configured: boolean;
  default_port: number;
  updated_at: string;
  editable: boolean;
}

/** 用户设置·主题与通知偏好（GET/PUT /admin/auth/preferences）。 */
export interface UserPreferences {
  theme: "light" | "dark" | "system";
  notify_email: boolean;
  notify_browser: boolean;
  notify_weekly: boolean;
  bio: string;
}

/** GET /admin/users 与 /admin/users/tree 的行（ADR-019 统一用户表：与后端 snake_case 一致）。 */
export interface UserTreeNode {
  id: string;
  name: string;
  /** 登录名：唯一且不可修改（ADR-019），PATCH 传 username 会被后端 422 拒绝 */
  username: string;
  balance_micro: number;
  role: string;
  parent_user_id: string | null;
  status: string;
  depth: number;
  direct_children: number;
  subtree_size: number;
  created_at_ms: number;
  updated_at_ms: number;
}

/** GET /admin/users/tree：按作用域过滤后的扁平树 + 可见森林根。 */
export interface UserTreeResponse {
  root_id: string | null;
  root_ids: string[];
  total: number;
  nodes: UserTreeNode[];
}

export interface LedgerRow {
  id: string;
  ts: string;
  kind: "topup" | "charge";
  delta_micro: number;
  balance_after_micro: number;
  note: string;
}

/** 上游模型成本账（ticket 05）：CNY/1M 词元，字符串避免浮点；null = 尚未配置单价 */
export interface UpstreamModelPricing {
  cost_input_per_1m: string | null;
  cost_output_per_1m: string | null;
  /** 倍率，花费 = 成本 × 倍率；默认 1.0000 */
  markup: string;
}

/** 公开模型价格是派生值：成员有效单价（成本 × 倍率）的加权平均，只读不落库 */
export interface PublicModelPrice {
  public_model_id: string;
  name: string;
  routing_mode: RoutingMode;
  currency: string;
  price_input_per_1m: string | null;
  price_output_per_1m: string | null;
  priced_members: number;
  total_members: number;
  /** weighted 用成员权重，failover/conditional 等权 */
  weight_basis: "weight" | "equal";
  available: boolean;
  /** weights_zero | no_priced_members | 空字符串 */
  reason: string;
  read_only: boolean;
}

/** 请求级金额账本：成本/花费/毛利；无 billing:cost 时后端直接不返回 cost/margin 键 */
/** ── 用户层级账单（ticket 17）：GET /admin/bills/my-spend ── */

/** 金额四件套；无 billing:cost 时 cost/margin 键在后端就被裁掉（不是 null）。 */
export interface BillMoney {
  currency: string;
  charge_micro: number | null;
  cost_micro?: number | null;
  margin_micro?: number | null;
  by_currency: Record<string, { charge_micro: number; cost_micro?: number }>;
  fx_missing: string[];
}

export interface SpendCounters {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  unpriced: number;
}

export interface SpendSummary extends SpendCounters, BillMoney {}

/** 时间序列桶：bucket=hour|day；label 由后端按账本时区生成。 */
export interface SpendPoint extends SpendSummary {
  start_ms: number;
  label: string;
}

/** by_user / by_model 的一行；name 已由后端 join，查不到时回落到 id。 */
export interface SpendDimension extends SpendSummary {
  id: string;
  name: string;
}

export interface MySpendResponse {
  range: string;
  bucket: "hour" | "day";
  timezone: string;
  from_ms: number;
  to_ms: number;
  scope: "self" | "subtree";
  /** scope=subtree 且调用者不受层级限制时为 true，此时 user=null */
  all_users: boolean;
  user: { id: string; name: string; role: string } | null;
  summary: SpendSummary;
  series: SpendPoint[];
  by_user: SpendDimension[];
  by_model: SpendDimension[];
}

export interface BillingLedgerEntry {
  id: string;
  gateway_event_id: string;
  cost_micro?: number | null;
  spend_micro?: number | null;
  margin_micro?: number | null;
  /** 实际倍率 = 花费 / 成本，成本为 0 或缺失时为 null */
  markup: string | null;
  currency: string;
  cost_status: string;
  spend_status: string;
  created_at_ms: number;
}

