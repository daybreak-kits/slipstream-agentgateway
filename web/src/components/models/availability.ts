import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";

import { ApiError, api, ENDPOINTS } from "@/lib/api";
import type { TableRowTone } from "@/lib/table-columns";
import { formatDateTime, useTimezone, type TimezoneMode } from "@/lib/time";
import type {
  AvailabilityRule, CooldownRecurrence, ModelAvailability, ModelBatchResult, ModelStatusKind,
} from "@/types";

/** 冷却对话框的默认值：1 小时（预设首位）；到期后读取即自愈。 */
export const DEFAULT_COOLDOWN_HOURS = 1;

/** 一次性冷却时长快捷档（小时，GLOSSARY §3 定案 1/3/6/12/24/72）；「自定义」走 datetime-local。 */
export const COOLDOWN_PRESETS: Array<{ hours: number | null; label: string }> = [
  { hours: 1, label: "1 小时" },
  { hours: 3, label: "3 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 12, label: "12 小时" },
  { hours: 24, label: "24 小时" },
  { hours: 72, label: "72 小时" },
  { hours: null, label: "自定义截止" },
];

export const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "周一" }, { value: 2, label: "周二" }, { value: 3, label: "周三" },
  { value: 4, label: "周四" }, { value: 5, label: "周五" }, { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

export const RECURRENCE_LABELS: Record<CooldownRecurrence, string> = {
  once: "单次", daily: "每天", weekly: "每周", monthly: "每月",
};

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
    + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

export function fmtDeadline(ms: number): string {
  const d = new Date(ms);
  return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

export interface ScheduleWindow {
  start?: string;
  end?: string;
  days?: number[];
  days_of_month?: number[];
}

/** Parse the ADR-004 schedule_json; unknown shapes degrade to an empty window list. */
export function parseSchedule(scheduleJson: string | null): ScheduleWindow[] {
  if (!scheduleJson) return [];
  try {
    const parsed = JSON.parse(scheduleJson) as { windows?: unknown };
    return Array.isArray(parsed.windows) ? (parsed.windows as ScheduleWindow[]) : [];
  } catch {
    return [];
  }
}

/** Human summary of a rule: once shows its deadline, periodic shows recurrence + window. */
export function ruleSummary(rule: AvailabilityRule): string {
  if (rule.kind === "ban") return "关闭（人工）";
  if (rule.recurrence === "once") {
    return rule.expires_at_ms ? "单次至 " + fmtDeadline(rule.expires_at_ms) : "单次";
  }
  const window = parseSchedule(rule.schedule_json)[0];
  const span = window ? (window.start ?? "00:00") + " 至 " + (window.end ?? "23:59") : "";
  let scopeText = RECURRENCE_LABELS[rule.recurrence];
  if (rule.recurrence === "weekly" && window?.days?.length) {
    scopeText += " " + window.days.map((d) => WEEKDAY_OPTIONS.find((o) => o.value === d)?.label ?? "?").join("/");
  }
  if (rule.recurrence === "monthly" && window?.days_of_month?.length) {
    scopeText += " " + window.days_of_month.join("/") + " 日";
  }
  return scopeText + (span ? " " + span : "");
}

export function buildScheduleJson(
  recurrence: Exclude<CooldownRecurrence, "once">,
  start: string,
  end: string,
  days: number[],
  dayOfMonth: number,
): string {
  const window: ScheduleWindow = { start, end };
  if (recurrence === "weekly") window.days = days;
  if (recurrence === "monthly") window.days_of_month = [dayOfMonth];
  return JSON.stringify({ windows: [window] });
}

const RULE_PAGE_SIZE = 200;

export function scopeOf(kind: "upstream" | "public"): string {
  return kind === "upstream" ? "upstream_model" : "public_model";
}

async function fetchAvailabilityRules(): Promise<AvailabilityRule[]> {
  return api.get<AvailabilityRule[]>(ENDPOINTS.availabilityRules + "?page_size=" + RULE_PAGE_SIZE);
}

/**
 * 把「冷却原因」补写进行级冷却对应的托管规则（后端为 rule_row_* 前缀的确定性 id）。
 * 行接口本身没有 note 字段；写失败不影响已生效的冷却，只提示。
 */
async function writeCooldownNote(scope: string, scopeId: string, note: string): Promise<void> {
  if (note.trim() === "") return;
  try {
    const rules = await fetchAvailabilityRules();
    const managed = rules.find(
      (rule) => rule.scope === scope && rule.scope_id === scopeId && rule.recurrence === "once" && rule.id.startsWith("rule_row_"),
    );
    if (!managed) {
      toast.warning("冷却原因未能写入规则表", { description: "未找到该行对应的冷却规则；冷却本身已生效" });
      return;
    }
    await api.patch(ENDPOINTS.availabilityRule(managed.id), { note: note.trim() });
  } catch {
    toast.warning("冷却原因未能写入规则表", { description: "冷却本身已生效；可稍后在规则列表补充原因" });
  }
}

export function useAvailabilityRulesQuery(enabled = true) {
  return useQuery({
    queryKey: ["availability-rules"],
    queryFn: fetchAvailabilityRules,
    staleTime: 30_000,
    enabled,
  });
}

export function periodicByRow(rules: AvailabilityRule[] | undefined, scope: string): Map<string, AvailabilityRule> {
  const map = new Map<string, AvailabilityRule>();
  for (const rule of rules ?? []) {
    if (rule.scope === scope && rule.kind === "cooldown" && rule.recurrence !== "once") {
      map.set(rule.scope_id, rule);
    }
  }
  return map;
}

export function coolingUntil(row: { cooldown_until_ms?: number; availability?: ModelAvailability }): number {
  const fromRow = row.cooldown_until_ms ?? 0;
  const fromState = row.availability?.cooldown_until_ms ?? 0;
  return Math.max(fromRow, fromState);
}

export function isCooling(row: { enabled: boolean; cooldown_until_ms?: number; availability?: ModelAvailability }): boolean {
  if (row.availability?.state === "cooling") return true;
  return coolingUntil(row) > Date.now();
}

export function availabilityText(row: { enabled: boolean; cooldown_until_ms?: number; availability?: ModelAvailability }): string {
  const state = row.availability?.state;
  if (state === "cooling" || (state !== "closed" && isCooling(row))) {
    const until = coolingUntil(row);
    return until > Date.now() ? "冷却至 " + fmtDeadline(until) : "冷却中";
  }
  if (state === "closed" || !row.enabled) return "已关闭";
  return "正常";
}

export function availabilityTone(row: { enabled: boolean; cooldown_until_ms?: number; availability?: ModelAvailability }): "success" | "warning" {
  if (row.availability?.state === "cooling" || (row.availability?.state !== "closed" && isCooling(row))) return "warning";
  // 「已关闭」用 warning 语义色（DESIGN-AUDIT 四期 §16 / W4-A1）：中性灰不表达「被人为关闭」的警示。
  if (row.availability?.state === "closed" || !row.enabled) return "warning";
  return "success";
}

/**
 * 行状态 → 状态图标（W7 ticket 10 · spec User Story 34/35）：
 * 模型状态由既有可用性投影（normal/cooling/closed）给出，前端只按状态渲染图标与详情，
 * 不新增后端字段（spec「API 与契约-状态相关」）。
 *
 * 控制台不认识的状态（后端新增了第四种）判为 unknown——不装作正常，明说未知。
 * 完全没有投影时才按行自身的启停与冷却截止兜底。
 */
export function modelStatusKind(row: {
  enabled?: boolean;
  cooldown_until_ms?: number;
  availability?: ModelAvailability;
}): ModelStatusKind {
  const state = row.availability?.state;
  if (state === "normal") return "normal";
  if (state === "cooling") return "cooling";
  if (state === "closed") return "closed";
  if (state !== undefined) return "unknown";
  if (row.enabled === undefined) return "unknown";
  if (!row.enabled) return "closed";
  return coolingUntil(row) > Date.now() ? "cooling" : "normal";
}

/**
 * 表格行底色（W6 ticket 10 / user story 41/43）：关闭行微灰、冷却行微黄；
 * 关闭优先于冷却（closed 行即使残留冷却截止时间也是灰）。正常行无底色。
 * 上游与公开模型共用：公开模型没有冷却（ADR-025），实际只会命中 neutral。
 */
export function modelRowTone(row: { enabled: boolean; cooldown_until_ms?: number; availability?: ModelAvailability }): TableRowTone | undefined {
  if (row.availability?.state === "closed" || !row.enabled) return "neutral";
  if (row.availability?.state === "cooling" || isCooling(row)) return "warning";
  return undefined;
}

/** 关闭行默认置尾的分区谓词（lib/table-order）：只认「关闭」，冷却不参与置尾。 */
export function modelRowRank(row: { enabled: boolean; availability?: ModelAvailability }): boolean {
  return row.availability?.state === "closed" || !row.enabled;
}

/** 批量部分成功（后端逐条回报 changed/missing/failed）的统一 toast。 */
export function reportBatchResult(title: string, result: ModelBatchResult): void {
  const notes: string[] = [];
  if (result.missing.length > 0) notes.push(result.missing.length + " 个已不存在");
  if (result.failed.length > 0) notes.push(result.failed.length + " 个失败：" + result.failed.map((item) => item.message).join("；"));
  const description = "成功 " + result.changed.length + " 个" + (notes.length > 0 ? "；" + notes.join("；") : "");
  if (result.failed.length > 0 || result.missing.length > 0) toast.warning(title + "部分完成", { description });
  else toast.success(title + "完成", { description });
}

type AvailabilityAction = "enable" | "disable" | "cooldown" | "release";

const AVAIL_LABEL: Record<AvailabilityAction, string> = {
  enable: "已启用",
  disable: "已关闭",
  cooldown: "已设置冷却",
  release: "已解除",
};

/**
 * 409 冷却互斥（ticket 02）：后端消息已说明原因与处理方式，这里补上阻塞时间，
 * 让操作者知道等多久（周期窗口结束）或何时可设周期规则（单次截止）。
 */
export function conflictDescription(error: Error, timezone: TimezoneMode): string {
  if (!(error instanceof ApiError) || error.code !== "CONFLICT") return error.message;
  const windowEnd = Number(error.details.window_end_ms ?? 0);
  const singleUntil = Number(error.details.cooldown_until_ms ?? 0);
  if (windowEnd > 0) {
    return error.message + "（当前周期窗口至 " + formatDateTime(windowEnd, timezone) + "）";
  }
  if (singleUntil > 0) {
    return error.message + "（单次冷却至 " + formatDateTime(singleUntil, timezone) + "）";
  }
  return error.message;
}

export function useAvailabilityMutation(kind: "upstream" | "public") {
  const qc = useQueryClient();
  const { mode: timezone } = useTimezone();
  const listKey = kind === "upstream" ? "upstream-models" : "public-models";
  return useMutation({
    mutationFn: async (vars: { id: string; action: AvailabilityAction; cooldown_until_ms?: number; note?: string }) => {
      const path = kind === "upstream" ? ENDPOINTS.upstreamModelUpdate(vars.id) : ENDPOINTS.publicModelUpdate(vars.id);
      const body: Record<string, unknown> = {};
      if (vars.action === "enable") body.enabled = true;
      else if (vars.action === "disable") body.enabled = false;
      else if (vars.action === "cooldown") body.cooldown_until_ms = vars.cooldown_until_ms ?? 0;
      else body.cooldown_until_ms = 0;
      // 启用响应带 window_skip（工单 G）：窗口期内启用=仅跳过当前窗口，提示语由后端给出。
      const result = await api.patch<{ window_skip?: { message: string } | null }>(path, body);
      // 原因补写进规则表；失败只提示，不影响冷却本身。
      if (vars.action === "cooldown" && vars.note && vars.note.trim() !== "") {
        await writeCooldownNote(scopeOf(kind), vars.id, vars.note);
      }
      return result;
    },
    onSuccess: (result, vars) => {
      const skipMessage = result?.window_skip?.message;
      if (skipMessage) toast.success(AVAIL_LABEL[vars.action], { description: skipMessage });
      else toast.success(AVAIL_LABEL[vars.action]);
      void qc.invalidateQueries({ queryKey: [listKey] });
      if (vars.action === "enable" || vars.action === "release") {
        void qc.invalidateQueries({ queryKey: ["availability-rules"] });
      }
    },
    onError: (e: Error) => toast.error("操作失败", { description: conflictDescription(e, timezone) }),
  });
}

export function useBatchMutation(kind: "upstream" | "public") {
  const qc = useQueryClient();
  const listKey = kind === "upstream" ? "upstream-models" : "public-models";
  const path = kind === "upstream" ? ENDPOINTS.upstreamModelBatch : ENDPOINTS.publicModelBatch;
  const title = kind === "upstream" ? "批量操作上游模型" : "批量操作公开模型";
  return useMutation({
    mutationFn: async (vars: { ids: string[]; action: "enable" | "disable" | "delete" }) => {
      return api.patch<ModelBatchResult>(path, { ids: vars.ids, action: vars.action });
    },
    onSuccess: (result, vars) => {
      reportBatchResult(title, result);
      void qc.invalidateQueries({ queryKey: [listKey] });
      if (kind === "upstream") {
        // 删除/引用计数变化会影响公开模型成员与被引用数
        void qc.invalidateQueries({ queryKey: ["public-models"] });
      }
      if (vars.action === "enable") {
        void qc.invalidateQueries({ queryKey: ["availability-rules"] });
      }
    },
    onError: (e: Error) => toast.error("批量操作失败", { description: e.message }),
  });
}
