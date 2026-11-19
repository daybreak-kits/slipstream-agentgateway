import { ApiError } from "@/lib/api";
import type { GuardrailConfig, McpServerConfig, PolicyConfig } from "@/lib/policies";

/** 网关策略三 Tab 的共用纯函数：错误描述与草稿脏计数（无 JSX，供页级动作条与各 Tab 共用）。 */

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

/** 流量策略的「修改 N 处」：按顶层配置组计数（cors/鉴权/限流/超时/改写/重试）。 */
const POLICY_GROUP_KEYS = ["cors", "api_key", "local_rate_limit", "timeout", "transformations", "retry"] as const;

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
