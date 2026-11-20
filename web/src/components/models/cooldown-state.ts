import { fmtDeadline, ruleSummary } from "@/components/models/availability";
import type { AvailabilityRule, ModelAvailability } from "@/types";

/** 抽屉「状态与冷却」区所需的最小行形状（UpstreamModel 可直接传入）。 */
export interface CooldownRowLike {
  enabled: boolean;
  cooldown_until_ms?: number;
  availability?: ModelAvailability;
}

export interface CooldownModeState {
  /** 当前是否处于冷却中（单次截止或周期窗口，含已关闭行上的未来截止）。 */
  cooling: boolean;
  /** 当前生效冷却的截止时间（epoch ms；0 = 不在冷却）。 */
  coolingUntilMs: number;
  /** 正在生效的单次冷却规则（无则 null）。 */
  singleActiveRule: AvailabilityRule | null;
  /** 正在生效的周期窗口规则（无则 null；规则不可读时也为 null）。 */
  periodicActiveRule: AvailabilityRule | null;
  /** 单次冷却模式是否被禁用（周期窗口生效期间）。 */
  blockedSingle: boolean;
  /** 周期冷却模式是否被禁用（单次冷却生效期间）。 */
  blockedPeriodic: boolean;
  /** 单次模式禁用说明（含阻塞规则与窗口结束时间）；可用时为空串。 */
  singleBlockReason: string;
  /** 周期模式禁用说明（含单次截止时间）；可用时为空串。 */
  periodicBlockReason: string;
  /** 是否展示解除入口（冷却中）。 */
  releaseVisible: boolean;
}

export interface CooldownModeInput {
  row: CooldownRowLike;
  /** 该行可读的规则全集；null/undefined = 缺 availability:read（按未知处理，不禁用模式）。 */
  rules: AvailabilityRule[] | null | undefined;
  scope: string;
  scopeId: string;
  nowMs: number;
  /** 截止时间格式化（默认 lib 的 fmtDeadline；抽屉传 useTimezone 的 formatDateTime）。 */
  formatDeadline?: (ms: number) => string;
}

/** 一条规则是否属于当前行。 */
function ruleOfRow(rule: AvailabilityRule, scope: string, scopeId: string): boolean {
  return rule.kind === "cooldown" && rule.scope === scope && rule.scope_id === scopeId;
}

/**
 * 冷却双模式的互斥视图（ADR-027 / ticket 02 的前端投影）：
 * - 单次冷却生效期间禁用「周期冷却」模式（后端 409 的 proactive 提示）；
 * - 周期窗口生效期间禁用「单次冷却」模式；
 * - 规则不可读（缺 availability:read）时不猜，交给后端 409 兜底；
 * - 当前是否「单次」还是「周期」在冷却：规则里有生效中的 once 规则 → 单次，否则行在冷却就视为周期窗口。
 * 提示文案取自后端互斥消息与规则摘要，含截止/窗口结束时间，便于运营者知道等多久。
 */
export function cooldownModeState(input: CooldownModeInput): CooldownModeState {
  const fmt = input.formatDeadline ?? fmtDeadline;
  const row = input.row;
  const rules = Array.isArray(input.rules) ? input.rules.filter((rule) => ruleOfRow(rule, input.scope, input.scopeId)) : null;
  const singleActiveRule = rules
    ? (rules
        .filter((rule) => rule.recurrence === "once" && Number(rule.expires_at_ms ?? 0) > input.nowMs)
        .sort((a, b) => Number(b.expires_at_ms ?? 0) - Number(a.expires_at_ms ?? 0))[0] ?? null)
    : null;
  const rowDeadline = Math.max(
    Number(row.availability?.cooldown_until_ms ?? 0),
    Number(row.cooldown_until_ms ?? 0),
  );
  const singleDeadline = Number(singleActiveRule?.expires_at_ms ?? 0);
  const coolingUntilMs = Math.max(rowDeadline, singleDeadline);
  const cooling = coolingUntilMs > input.nowMs;
  // 行在冷却但没有生效中的单次规则 → 只能是周期窗口（行投影就是规则投影，不会凭空冷却）。
  const periodicActiveRule = rules && cooling && singleActiveRule === null
    ? (rules
        .filter((rule) => rule.recurrence !== "once")
        .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null)
    : null;
  const blockedSingle = periodicActiveRule !== null;
  const blockedPeriodic = singleActiveRule !== null;
  return {
    cooling,
    coolingUntilMs,
    singleActiveRule,
    periodicActiveRule,
    blockedSingle,
    blockedPeriodic,
    singleBlockReason: periodicActiveRule
      ? "周期冷却窗口生效期间不能设置单次冷却；阻塞规则：" + ruleSummary(periodicActiveRule)
        + "；窗口至 " + fmt(coolingUntilMs) + "，可先解除跳过本窗口"
      : "",
    periodicBlockReason: singleActiveRule
      ? "单次冷却生效期间不能创建或改期周期冷却；当前单次冷却至 " + fmt(coolingUntilMs) + "，请先解除单次冷却"
      : "",
    releaseVisible: cooling,
  };
}
