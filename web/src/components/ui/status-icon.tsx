import { Ban, CircleHelp, Snowflake, type LucideIcon } from "lucide-react";

import { HoverInfo } from "@/components/ui/hover-info";
import { toneText, type SemanticTone } from "@/lib/semantic-tone";
import { formatDateTime, useTimezone, type TimezoneMode } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ModelStatusKind } from "@/types";

/**
 * 行状态图标（W7 ticket 10 · D8 · spec User Story 34/35）。
 *
 * 有启用/关闭/冷却行操作的表格不再保留独立状态列（与操作列的启停按钮重复），
 * 状态改由「行底色 + 操作文案 + 状态图标」三处表达。图标只出现在模型名称旁，
 * 且只在非正常状态出现：正常模型不增加视觉噪音（US 34）。
 *
 *   - closed  已关闭，人工启用后恢复
 *   - cooling 冷却中，yyyy-mm-dd hh:mm:ss 后解除
 *   - unknown 状态未知（控制台不认识的状态，不装作正常）
 *
 * 悬浮详情走统一 HoverInfo 原语：鼠标 hover、键盘 Tab 聚焦、触屏轻点三路都能读，
 * 浮层 portal 到页面顶层，不被表格裁切。normal 状态直接返回 null——连占位都不留。
 */

/** 行状态：normal 不出图标，其余三态各有图标与悬浮详情。 */
export type StatusKind = ModelStatusKind;

/** 非 normal 的三种状态（本原语实际渲染的三态）。 */
type StatusIconKind = Exclude<StatusKind, "normal">;

const STATUS_ICONS: Record<StatusIconKind, LucideIcon> = {
  closed: Ban,
  cooling: Snowflake,
  unknown: CircleHelp,
};

/**
 * 语义色：关闭=警示琥珀（与既有「已关闭」徽标同色，DESIGN-AUDIT 四期 §16）、
 * 冷却=信息蓝（临时态，与「已关闭」区分）、未知=中性灰（不制造警报）。
 */
const STATUS_TONES: Record<StatusIconKind, SemanticTone> = {
  closed: "warning",
  cooling: "info",
  unknown: "neutral",
};

export interface StatusIconProps {
  /** 行状态；normal 不渲染任何东西。 */
  kind: StatusKind;
  /** 冷却解除时间（epoch 毫秒）；kind=cooling 时写进详情文案。 */
  cooldownUntilMs?: number;
  /** 附加说明（如周期规则摘要），接在状态文案之后。 */
  extra?: string;
  /** 触发元素附加类名。 */
  className?: string;
}

/**
 * 悬浮详情文案（单一事实源）：页面、门禁与验收都读这一份。
 * 冷却时间格式固定 yyyy-mm-dd hh:mm:ss（US 35），随数据刷新。
 */
export function statusDetailText(
  kind: StatusKind,
  cooldownUntilMs?: number,
  timezone: TimezoneMode = "local",
): string {
  if (kind === "closed") return "已关闭，人工启用后恢复";
  if (kind === "unknown") return "状态未知";
  if (kind === "normal") return "";
  if (!cooldownUntilMs) return "冷却中";
  return "冷却中，" + formatDateTime(cooldownUntilMs, timezone) + " 后解除";
}

export function StatusIcon({ kind, cooldownUntilMs, extra, className }: StatusIconProps) {
  const { mode: timezone } = useTimezone();
  // normal 不出图标：正常模型不增加视觉噪音，也不留空占位（US 34）。
  if (kind === "normal") return null;
  const detail = statusDetailText(kind, cooldownUntilMs, timezone);
  const Icon = STATUS_ICONS[kind];
  return (
    <HoverInfo side="top" align="start" label={detail} content={extra ? detail + "；" + extra : detail}>
      <span
        data-status-icon={kind}
        className={cn("inline-flex items-center", toneText(STATUS_TONES[kind]), className)}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </HoverInfo>
  );
}
