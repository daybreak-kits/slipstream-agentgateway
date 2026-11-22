import type { McpConfig } from "@/generated/contract";

import type { OperationOptions } from "../types";

/** 网关策略/护栏/MCP 三文档的响应形状（ticket 11 编辑链）。 */

export interface CapabilityInfo {
  supported: boolean;
  verified: boolean;
  since_version: string;
  note: string;
}

export interface CorsConfig {
  enabled: boolean;
  allow_origins: string[];
  allow_credentials: boolean;
  expose_headers: string[];
  allow_methods: string[];
  allow_headers: string[];
  max_age: number | null;
}

export interface PolicyConfig {
  cors: CorsConfig;
  api_key: { enabled: boolean; mode: "strict" };
  local_rate_limit: {
    requests_per_minute: number | null;
    tokens_per_minute: number | null;
  };
  timeout: {
    request_timeout: string;
    backend_request_timeout: string;
    response_idle_timeout: string;
  };
  transformations: {
    default_response_header_deletes: string[];
    protected_request_headers: string[];
  };
  retry: {
    attempts: number;
    backoff: string;
    codes: number[];
    precondition: string;
    condition: string;
  } | null;
  health: HealthConfig | null;
}

/** ADR-024 per-model health marks + eviction (llm.models[].health). */
export interface HealthConfig {
  unhealthy_expression: string;
  consecutive_failures: number;
  duration: string;
  restore_health: number;
}

export interface PolicyCounts {
  upstreams: number;
  public_models: number;
  api_keys_active: number;
  users: number;
}

export interface PoliciesResponse {
  config: PolicyConfig;
  defaults: PolicyConfig;
  effective: {
    cors: { enabled: boolean; allow_origins: string[]; allow_credentials: boolean };
    key_auth: { enabled: boolean; mode: string; scheme: string; storage: string; failure: string };
    local_rate_limit: {
      key: string;
      type: string;
      requests_per_minute: number | null;
      tokens_per_minute: number | null;
      semantics: string;
    };
    transforms_defaults: {
      response_header_deletes: string[];
      protected_request_headers: string[];
      body_editable_paths: string;
    };
    routing: { modes: string[]; note: string };
    timeout: {
      request_timeout: string;
      backend_request_timeout: string;
      response_idle_timeout: string;
    } | null;
    guardrails: { streaming: string; request: number; response: number };
    retry: {
      attempts: number;
      codes: number[];
      backoff: string;
    } | null;
    health: {
      unhealthy_expression: string;
      consecutive_failures: number;
      duration: string;
      restore_health: number;
    } | null;
  };
  counts: PolicyCounts;
  capabilities: Record<
    "cors" | "api_key" | "local_rate_limit" | "timeout" | "transformations" | "retry" | "health" | "request_attempts" | "guardrails_regex" | "guardrails_webhook",
    CapabilityInfo
  >;
  notes: Record<string, string>;
  updated_at_ms: number;
}

export interface RegexRuleConfig {
  pattern: string;
  builtin: string;
}

export interface GuardConfig {
  kind: "regex" | "webhook";
  action: string;
  rules: RegexRuleConfig[];
  scope: string[];
  rejection_status: number;
  rejection_body: string;
  webhook_target: string;
  failure_mode: "failClosed" | "failOpen";
}

export interface GuardrailConfig {
  streaming: "Disabled" | "Enabled";
  request: GuardConfig[];
  response: GuardConfig[];
}

export interface GuardrailMatrixItem {
  key: string;
  supported: boolean;
  since_version: string;
  note: string;
  verified: boolean;
}

export interface GuardrailsResponse {
  config: GuardrailConfig;
  defaults: GuardrailConfig;
  adapter: string;
  items: GuardrailMatrixItem[];
  capabilities: { regex: CapabilityInfo; webhook: CapabilityInfo };
  note: string;
  updated_at_ms: number;
}

export interface McpServerConfig {
  name: string;
  transport: "sse" | "stdio" | "http";
  host: string;
  url: string;
  port: number | null;
  path: string;
  cmd: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpServersResponse {
  servers: McpServerConfig[];
  port: number | null;
  defaults: { servers: McpServerConfig[]; port: number | null };
  supported: boolean;
  transports: Record<"sse" | "stdio" | "http", CapabilityInfo>;
  note: string;
  updated_at_ms: number;
}

/** 试运行校验结果：ok=false 时 errors 逐条展示。 */
export interface ValidateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 网关策略三文档操作（ADR-023 第 3 条）：读文档、保存文档、恢复默认、数据面试运行校验。
 * apply/配置版本留档归 config 域（保存链终点另有 POST /admin/config/apply）。
 */
export interface GovernanceOperations {
  policies(options?: OperationOptions): Promise<PoliciesResponse>;
  savePolicies(config: PolicyConfig): Promise<PoliciesResponse>;
  resetPolicies(): Promise<PoliciesResponse>;
  guardrails(options?: OperationOptions): Promise<GuardrailsResponse>;
  saveGuardrails(config: GuardrailConfig): Promise<GuardrailsResponse>;
  resetGuardrails(): Promise<GuardrailsResponse>;
  mcpServers(options?: OperationOptions): Promise<McpServersResponse>;
  saveMcpServers(config: McpConfig): Promise<McpServersResponse>;
  validatePolicies(config: PolicyConfig): Promise<ValidateResult>;
  validateGuardrails(config: GuardrailConfig): Promise<ValidateResult>;
  validateMcp(config: McpConfig): Promise<ValidateResult>;
}
