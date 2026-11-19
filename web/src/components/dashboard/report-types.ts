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

/** 金额字段按权限「键不存在」，所以全部可选；margin 在缺汇率时可能是 null。 */
export interface ReportsOverview {
  requests: number;
  /** 失败请求（http_status != 200，billing.md §6）。 */
  error_count: number;
  /** 区间内出现过事件的去重分钟数（含失败请求，报表时区墙钟）。 */
  active_minutes: number;
  input_tokens: number;
  output_tokens: number;
  /** 缓存词元（后端 H 契约已钉死：顶层整数；未合入时为 undefined，前端按 0 降级）。 */
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  charge_micro?: number;
  cost_micro?: number;
  margin_micro?: number | null;
  currency: string;
  fx_missing?: string[];
  money_scope?: "converted" | "report_currency_only";
  latency_p50_ms: number;
  latency_p95_ms: number;
  ttft_p50_ms: number;
  latency?: {
    paired_samples: number;
    min_samples: number;
    ttft: LatencyBlock;
    total: LatencyBlock;
  };
  estimate_note: string;
}

/** 金额字段按权限「键不存在」，缓存词元与分钟峰值待后端合入前为 undefined——全部可选。 */
export interface ReportTotals {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
  error_count?: number;
  active_minutes?: number;
  /** 窗口内单分钟峰值（GLOSSARY §5 「最高峰」）：最忙一分钟的请求数 / 词元数；缺位降级「—」。 */
  peak_rpm?: number;
  peak_tpm?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_micro?: number;
  charge_micro?: number;
}

export interface TimeseriesMember extends ReportTotals {
  id: string;
  label: string;
  total: number;
  /** 占比 0..1；双指标时由首序列（cost_micro）驱动，空窗口为 0 而不是 NaN。 */
  share: number;
  /** 双指标回显：该成员各指标合计。 */
  totals?: { cost_micro?: number; charge_micro?: number };
}

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

export interface TimeseriesReport {
  /** 自定义区间生效时后端回显 "custom"。 */
  range: ReportRange | "custom";
  bucket: "hour" | "day";
  dimension: TrendDimension;
  /** 前端口径的指标（requests/tokens/money），后端 echo 是 cost_micro 等字段名。 */
  metric: TrendMetric;
  from_ms: number;
  to_ms: number;
  timezone: string;
  currency: string;
  points: TimeseriesPoint[];
  members: TimeseriesMember[];
  totals: ReportTotals;
  metric_total: number;
  folded_members: number;
  fx_missing: string[];
  estimate_note: string;
}

/** 后端原始回包：单指标 values 为平面 {memberId:value}，双指标为 {memberId:{cost_micro,charge_micro}}。 */
export interface RawTimeseriesReport {
  range: string;
  bucket: "hour" | "day";
  dimension: TrendDimension;
  metric?: string;
  metrics?: string[];
  from_ms: number;
  to_ms: number;
  timezone: string;
  currency: string;
  points: Array<{
    bucket_start_ms: number;
    label: string;
    total: number;
    values: Record<string, number> | Record<string, Record<string, number>>;
  }>;
  members: Array<TimeseriesMember & { totals?: Record<string, number> }>;
  totals: ReportTotals;
  metric_total: number;
  folded_members: number;
  fx_missing: string[];
  estimate_note: string;
}

/**
 * 归一化：把后端「单指标平面 / 双指标嵌套」两种 values 形状拉平成前端规范形。
 * 费用（money）模式下按桶跨成员求和出 cost/charge 两列，成员列改读 member.totals。
 */
export function normalizeTimeseries(raw: RawTimeseriesReport, requested: TrendMetric): TimeseriesReport {
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

export interface LatencyBlock {
  samples: number;
  p50_ms: number | null;
  p75_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
}

/**
 * 全样本分位块（W4-F）：窗口内全部事件——不过滤 ttft>0 配对，非流式（ttft=0）
 * 也计入——只有语义色锚点 p50/p75/p95（后端不回 p99）。样本不足 5 时分位为 null。
 */
export interface AllSamplesBlock {
  samples: number;
  p50_ms: number | null;
  p75_ms: number | null;
  p95_ms: number | null;
}

/** 与 paired 块同窗不同口径；all.samples 是窗口内全部事件数（≥ paired_samples）。 */
export interface AllSamplesLatency {
  samples: number;
  ttft: AllSamplesBlock;
  total: AllSamplesBlock;
}

export interface LatencyReport {
  /** 自定义区间生效时后端回显 "custom"；窗口缺省（全时段，W4-F）回显 "all"。 */
  range: ReportRange | "custom" | "all";
  paired_samples: number;
  min_samples: number;
  ttft: LatencyBlock;
  total: LatencyBlock;
  /** W4-F 新键：日志页耗时语义色的分位锚点；旧后端无此键，消费方一律判空降级。 */
  all?: AllSamplesLatency;
  timezone?: string;
  currency?: string;
  estimate_note: string;
}

export interface HeatmapColumn {
  key: string;
  label: string;
}

export interface HeatmapRow {
  key: string;
  label: string;
  values: number[];
}

export interface HeatmapReport {
  range: HeatmapRange;
  mode: "weekday_hour" | "date_hour";
  /** 规范化 metric（cost→cost_micro / spend→charge_micro）。 */
  metric: string;
  from_ms: number;
  to_ms: number;
  timezone: string;
  currency: string;
  columns: HeatmapColumn[];
  rows: HeatmapRow[];
  max: number;
  total: number;
  fx_missing: string[];
  estimate_note: string;
}

export interface FlowNodeMeta {
  id: string;
  label: string;
  stage: "user" | "key" | "model" | "umodel" | "channel";
  value: number;
}

export interface FlowLink {
  source: string;
  target: string;
  requests: number;
  tokens: number;
  value: number;
  cost_micro?: number;
  charge_micro?: number;
}

export interface FlowReport {
  metric: "requests" | "tokens";
  nodes: string[];
  node_meta: Record<string, FlowNodeMeta>;
  links: FlowLink[];
  stages: Array<{ id: string; label: string }>;
  totals: { requests: number; tokens: number; cost_micro?: number; charge_micro?: number };
  currency: string;
  fx_missing: string[];
  estimate_note: string;
}

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
