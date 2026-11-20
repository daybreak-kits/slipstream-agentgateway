/**
 * 耗时语义色（DESIGN-AUDIT §11 分位锚定 + §5 语义色条 pattern）。
 *
 * 口径随窗口动态：p50/p95 来自 /admin/reports/latency 的 all 块（窗口内全部
 * 事件、不过滤 ttft>0 配对，W4-F），随日志页时间窗刷新——这里不锁死任何绝对
 * 毫秒阈值。三档语义色：≤P50 绿（快）、P50–P95 黄（中，P75 是黄区锚点但不
 * 引入第四色）、>P95 红（慢）；P75 只落在黄区内部，判定只需要 p50/p95 两个锚。
 *
 * 值缺失 / 0（非流式无首字、失败请求无耗时）/ 分位 null（窗口样本不足 5 条）
 * 一律回中性灰，不参与快慢评价。
 */

export type LatencyTone = "success" | "warning" | "danger" | "neutral";

/** 按当前窗口的分位锚定单个耗时值的语义色。 */
export function latencyTone(
  valueMs: number | null | undefined,
  p50: number | null | undefined,
  p95: number | null | undefined,
): LatencyTone {
  if (
    valueMs === null ||
    valueMs === undefined ||
    !Number.isFinite(valueMs) ||
    valueMs <= 0 ||
    p50 === null ||
    p50 === undefined ||
    !Number.isFinite(p50) ||
    p95 === null ||
    p95 === undefined ||
    !Number.isFinite(p95)
  ) {
    return "neutral";
  }
  if (valueMs <= p50) return "success";
  if (valueMs <= p95) return "warning";
  return "danger";
}

/** 语义色 → 竖色条底色（3px 圆角条；中性灰用 --color-faint，不抢三色语义）。 */
export const LATENCY_TONE_BAR_CLASS: Record<LatencyTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-faint",
};

/** 语义色 → 数值文字色（首字 / 耗时两行，数字本身也要能读出快慢）。 */
export const LATENCY_TONE_TEXT_CLASS: Record<LatencyTone, string> = {
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-danger-text",
  neutral: "text-faint",
};
