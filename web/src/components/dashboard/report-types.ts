import type { ComponentType } from "react";

import type { TimeWindowRange } from "@/components/time-range-picker";

/** 后端字段一律 snake_case（docs/PLAN.md §3：控制面 3700，数据面 3600）。 */

/**
 * 看板时间窗（F1 定案）：预设区间走后端 range 枚举（桶边界按报表时区切，前端不自算毫秒）；
 * 本周/本月/自定义落成显式 from_ms/to_ms（成对传才生效，payload range 回显 "custom"）。
 * 状态形状归 TimeRangePicker（components/time-range-picker）所有，这里再导出。
 */
export type { TimeWindow } from "@/components/time-range-picker";
export type ReportRange = TimeWindowRange;

/** 三种图型（旧系统同一卡片内切换，?tab= 写 URL，默认柱形）。 */
export type ChartView = "bar" | "area" | "flow";

export const CHART_VIEWS: Array<{ value: ChartView; label: string }> = [
  { value: "bar", label: "柱形图" },
  { value: "area", label: "面积图" },
  { value: "flow", label: "分流图" },
];

export function parseChartView(raw: string | null): ChartView {
  return raw === "area" || raw === "flow" ? raw : "bar";
}

/** 维度单选：公开模型 / 上游模型 / 上游渠道（旧系统叫「视角」，combo=公开模型）。 */
export type TrendDimension = "combo" | "upstream" | "channel";

export const TREND_DIMENSIONS: Array<{ value: TrendDimension; label: string }> = [
  { value: "combo", label: "公开模型" },
  { value: "upstream", label: "上游模型" },
  { value: "channel", label: "上游渠道" },
];

/**
 * 趋势指标：请求 / 词元 / 费用。
 * 费用 = 成本 + 花费双系列（请求带 metrics=cost_micro,charge_micro，一次取回两条序列）。
 */
export type TrendMetric = "requests" | "tokens" | "money";

export interface TrendMetricOption {
  value: TrendMetric;
  label: string;
  hint: string;
  /** 有该权限才展示这个指标（无权限时后端不返回对应金额字段）。 */
  permission?: "billing:spend";
}

export const TREND_METRICS: TrendMetricOption[] = [
  { value: "requests", label: "请求", hint: "按条数统计的请求量" },
  { value: "tokens", label: "词元", hint: "输入 + 输出词元（输入为折算口径）" },
  { value: "money", label: "费用", hint: "成本与花费双系列对比", permission: "billing:spend" },
];

export function trendMetricLabel(metric: TrendMetric): string {
  return TREND_METRICS.find((item) => item.value === metric)?.label ?? metric;
}

/** 热力图独立于页面区间（7D 星期×小时；30D/365D 日期×小时）。 */
export type HeatmapRange = "7d" | "30d" | "365d";

export const HEATMAP_RANGES: Array<{ value: HeatmapRange; label: string }> = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "365d", label: "365D" },
];

export type HeatmapMetric = "tokens" | "cost" | "spend";

export const HEATMAP_METRICS: Array<{
  value: HeatmapMetric;
  label: string;
  permission?: "billing:cost" | "billing:spend";
}> = [
  { value: "tokens", label: "词元" },
  { value: "cost", label: "成本", permission: "billing:cost" },
  { value: "spend", label: "花费", permission: "billing:spend" },
];

export function heatmapMetricLabel(metric: HeatmapMetric): string {
  return HEATMAP_METRICS.find((item) => item.value === metric)?.label ?? metric;
}

/**
 * 报表 wire 形状由后端 response_model 唯一生成（ops/contract/gen_ts.py →
 * @/generated/contract）。这里不再手写 wire 类型，只保留图表用的派生形与归一化。
 * 金额字段按权限「键不存在」，所以生成类型里全部可选。
 */
import type { TimeseriesMemberOut, TimeseriesReportOut } from "@/generated/contract";

/** 成员合计：wire 是通用 Record，图表只认 cost/charge 两列。 */
export type TimeseriesMember = Omit<TimeseriesMemberOut, "totals"> & {
  totals?: { cost_micro?: number; charge_micro?: number };
};

/** 归一化后的桶：单指标 values 平面；费用双系列把桶合计落到 cost/charge 列。 */
export interface TimeseriesPoint {
  bucket_start_ms: number;
  label: string;
  total: number;
  /** 单指标：memberId -> 该桶数值；缺键等价 0。费用双系列时改读 cost/charge 聚合列。 */
  values: Record<string, number>;
  /** 费用双系列：本桶跨成员合计（成本/花费）。 */
  cost_micro?: number;
  charge_micro?: number;
}

/** 前端规范形：range 是页面区间，metric 是前端口径（requests/tokens/money）。 */
export type TimeseriesReport = Omit<
  TimeseriesReportOut,
  "range" | "metric" | "points" | "members"
> & {
  /** 自定义区间生效时后端回显 "custom"。 */
  range: ReportRange | "custom";
  /** 前端口径的指标（requests/tokens/money），后端 echo 是 cost_micro 等字段名。 */
  metric: TrendMetric;
  points: TimeseriesPoint[];
  members: TimeseriesMember[];
};

/**
 * 归一化：把后端「单指标平面 / 双指标嵌套」两种 values 形状拉平成前端规范形。
 * 费用（money）模式下按桶跨成员求和出 cost/charge 两列，成员列改读 member.totals。
 */
export function normalizeTimeseries(
  raw: TimeseriesReportOut,
  requested: TrendMetric,
): TimeseriesReport {
  const dual = requested === "money";
  const points: TimeseriesPoint[] = raw.points.map((point) => {
    if (!dual) {
      return {
        bucket_start_ms: point.bucket_start_ms,
        label: point.label,
        total: point.total,
        values: point.values as Record<string, number>,
      };
    }
    const nested = point.values as Record<string, Record<string, number>>;
    let cost = 0;
    let charge = 0;
    for (const entry of Object.values(nested)) {
      cost += entry?.cost_micro ?? 0;
      charge += entry?.charge_micro ?? 0;
    }
    return {
      bucket_start_ms: point.bucket_start_ms,
      label: point.label,
      total: point.total,
      values: {},
      cost_micro: cost,
      charge_micro: charge,
    };
  });
  const members: TimeseriesMember[] = raw.members.map((member) => {
    const { totals, ...rest } = member;
    return {
      ...rest,
      totals: totals
        ? { cost_micro: totals.cost_micro, charge_micro: totals.charge_micro }
        : undefined,
    };
  });
  return {
    ...raw,
    range: raw.range as TimeseriesReport["range"],
    metric: requested,
    points,
    members,
  };
}

/** 五段固定轴：后端 collapse 后只返回可见段，前端仍用完整表渲染轴名与恢复入口。 */
export const FLOW_STAGES = [
  { id: "user", label: "用户" },
  { id: "key", label: "连接密钥" },
  { id: "model", label: "公开模型" },
  { id: "upstream", label: "上游模型" },
  { id: "channel", label: "上游" },
] as const;

/**
 * report 端点路径。lib/api.ts 的 ENDPOINTS 是唯一来源（ticket 07 约定），
 * 这里只做看板范围的再导出，避免页面里散落字符串。
 */
import { ENDPOINTS } from "@/lib/api";

export const REPORT_PATHS = {
  overview: ENDPOINTS.overview,
  trend: ENDPOINTS.reportsTrend,
  timeseries: ENDPOINTS.reportsTimeseries,
  latency: ENDPOINTS.reportsLatency,
  heatmap: ENDPOINTS.reportsHeatmap,
  flow: ENDPOINTS.reportsFlow,
  /** 控制面健康（routers_health.py），用于总览的连接与健康卡 */
  health: ENDPOINTS.health,
} as const;

/** 配置版本行：mock 与真实后端的字段名不同，用宽松类型在渲染层归一（见 normalizeRevision）。 */
export interface RevisionLike {
  id?: string;
  revision?: string;
  artifact_hash?: string;
  adapter_id?: string;
  operator?: string;
  reason?: string;
  note?: string;
  status?: string;
  created_at_ms?: number;
  created_at?: string;
  previous_revision_id?: string | null;
}

export interface HealthReport {
  status: string;
  ir_version: string;
  adapter: string;
  data_plane_port: number;
  now_ms: number;
}

/** 后端 estimate_note 目前是英文常量，界面统一翻成中文；未知文案原样透传。 */
const ESTIMATE_NOTE_ZH: Record<string, string> = {
  "token amounts fold cache into input (stage B pending)":
    "缓存命中词元暂并入输入口径（阶段 B 处理）",
};

export function estimateNoteText(note: string): string {
  return ESTIMATE_NOTE_ZH[note] ?? note;
}

/** 图标映射的宽松类型：图表页只借用 Icon 组件类型，避免循环依赖 metric-icons。 */
export type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;
