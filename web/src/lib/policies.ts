import { controlPlane } from "./control-plane";

/**
 * 网关策略三文档的页面级门面：类型与读写归 control-plane 的 governance 域（W4 票04），
 * 这里保留既有导出名，另提供 JSON/行列表编辑原语与「保存并下发」组合动作。
 */
export type {
  CapabilityInfo,
  CorsConfig,
  GuardConfig,
  GuardrailConfig,
  GuardrailMatrixItem,
  GuardrailsResponse,
  HealthConfig,
  McpServerConfig,
  McpServersResponse,
  PoliciesResponse,
  PolicyConfig,
  PolicyCounts,
  RegexRuleConfig,
} from "./control-plane/operations/governance";
export type { ApplyRevision } from "./control-plane/operations/config";

/** Parse the advanced JSON editor text; throws a human-readable error on failure. */
export function parseJsonDocument<T>(text: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("JSON 语法错误：" + (error as Error).message);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("JSON 顶层必须是对象");
  }
  return parsed as T;
}

export function linesToList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function listToLines(items: string[]): string {
  return items.join("\n");
}

export function numberOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) throw new Error("请输入数字：" + trimmed);
  return value;
}

/** Save the document, then run the normal render/validate/apply rollout. */
export async function saveAndApply(save: () => Promise<unknown>, reason: string): Promise<string> {
  await save();
  const revision = await controlPlane.config.apply(reason);
  return revision.id;
}
