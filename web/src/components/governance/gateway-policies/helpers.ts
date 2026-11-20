import { ApiError } from "@/lib/api";
import type { GuardrailConfig, McpServerConfig, PolicyConfig } from "@/lib/policies";

/** 网关策略三 Tab 的共用纯函数：错误描述与草稿脏计数（无 JSX，供页级动作条与各 Tab 共用）。 */

/** 请求内重试与健康驱逐（ADR-024）：UI 与页级保存门禁共用的纯函数。 */
export const RETRY_CODE_PRESETS = [400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504] as const;
export const BACKOFF_OPTIONS = ["50ms", "100ms", "200ms", "500ms", "1s", "2s"] as const;
export const HEALTH_EXPRESSION_PRESETS = ["response.code >= 500", "response.code >= 400"] as const;

const DURATION_RE = /^[1-9][0-9]*(ms|s|m|h)$/;

export function isFourXxCode(code: number): boolean {
  return code >= 400 && code <= 499;
}

/** 把「400, 401 429」这类输入解析成去重数字；非法项返回 null。 */
export function parseRetryCodes(text: string): number[] | null {
  const parts = text
    .split(/[\s,，;；]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const codes: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]+$/.test(part)) return null;
    const code = Number(part);
    if (code < 400 || code > 599) return null;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

/**
 * 前端成对校验（ADR-024）：返回第一条阻断说明，null = 可以保存。
 * 后端仍是权威（422 details.errors），这里只拦明显违规以免多跑一次往返。
 */
export function policyDraftProblem(config: PolicyConfig | null): string | null {
  if (config === null) return null;
  const retry = config.retry;
  if (retry !== null) {
    if (!Number.isInteger(retry.attempts) || retry.attempts < 1 || retry.attempts > 10) {
      return "请求内重试：attempts 必须是 1-10 的整数。";
    }
    if (retry.codes.length === 0) return "请求内重试：codes 至少勾选一个 400-599 状态码。";
    if (retry.codes.some((code) => !Number.isInteger(code) || code < 400 || code > 599)) {
      return "请求内重试：codes 只能包含 400-599 的状态码。";
    }
    if (retry.backoff.trim() !== "" && !DURATION_RE.test(retry.backoff.trim())) {
      return "请求内重试：backoff 必须是 50ms/1s/1m 这类时长。";
    }
  }
  const health = config.health;
  const fourXx = retry === null ? [] : retry.codes.filter(isFourXxCode);
  if (fourXx.length > 0 && health === null) {
    return (
      "retry.codes 含 4xx（" +
      fourXx.join("、") +
      "）时必须配置健康驱逐：E16/E17 证实仅靠 codes 不会换组。请打开健康组并填写表达式与连续失败次数。"
    );
  }
  if (health !== null) {
    if (health.unhealthy_expression.trim() === "") return "健康驱逐：unhealthy_expression 不能为空。";
    if (!Number.isInteger(health.consecutive_failures) || health.consecutive_failures < 1) {
      return "健康驱逐：consecutive_failures 必须是 >= 1 的整数（表达式单独配置不会驱逐主层）。";
    }
    if (health.duration.trim() !== "" && !DURATION_RE.test(health.duration.trim())) {
      return "健康驱逐：duration 必须是 60s/5m 这类时长。";
    }
    if (!Number.isInteger(health.restore_health) || health.restore_health < 0) {
      return "健康驱逐：restore_health 必须是 >= 0 的整数。";
    }
  }
  // M5-a：只在启用时校验接收地址，关闭时后端整段不渲染。
  const tracing = config.tracing;
  if (tracing && tracing.enabled) {
    if (typeof tracing.host !== "string" || tracing.host.trim() === "") {
      return "链路追踪：OTLP 接收地址 host 不能为空。";
    }
    if (!Number.isInteger(tracing.port) || tracing.port < 1 || tracing.port > 65535) {
      return "链路追踪：OTLP 接收端口必须是 1-65535 的整数。";
    }
    if (tracing.protocol !== "http") return "链路追踪：AG 1.7 只支持 OTLP/HTTP 协议。";
  }
  return null;
}


export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const lines = error.errorLines();
    return lines.length > 0 ? error.message + "：" + lines.join("；") : error.message;
  }
  return (error as Error).message;
}

/** 草稿脏判定：结构化克隆保持键序，直接比 JSON 串即可。 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 流量策略的「修改 N 处」：按顶层配置组计数（cors/鉴权/限流/超时/改写/重试/健康/链路追踪）。 */
const POLICY_GROUP_KEYS = ["cors", "api_key", "local_rate_limit", "timeout", "transformations", "retry", "health", "tracing"] as const;

export function countDirtyPolicies(base: PolicyConfig, draft: PolicyConfig | null): number {
  if (draft === null) return 0;
  return POLICY_GROUP_KEYS.filter((key) => !jsonEqual(base[key], draft[key])).length;
}

/** 护栏的「修改 N 处」：streaming 开关 + request/response 两个护栏列表。 */
const GUARDRAIL_PART_KEYS = ["streaming", "request", "response"] as const;

export function countDirtyGuardrails(base: GuardrailConfig, draft: GuardrailConfig | null): number {
  if (draft === null) return 0;
  return GUARDRAIL_PART_KEYS.filter((key) => !jsonEqual(base[key], draft[key])).length;
}

/** MCP 的「修改 N 处」：port + 每个新增/删除/变更的 server 行。 */
export interface McpDraftDocument {
  servers: McpServerConfig[];
  port: number | null;
}

export function countDirtyMcp(base: McpDraftDocument, draft: McpDraftDocument | null): number {
  if (draft === null) return 0;
  let count = base.port !== draft.port ? 1 : 0;
  const baseByName = new Map(base.servers.map((server) => [server.name, server]));
  const draftNames = new Set<string>();
  for (const server of draft.servers) {
    draftNames.add(server.name);
    const origin = baseByName.get(server.name);
    if (origin === undefined || !jsonEqual(origin, server)) count += 1;
  }
  for (const name of baseByName.keys()) {
    if (!draftNames.has(name)) count += 1;
  }
  return count;
}
