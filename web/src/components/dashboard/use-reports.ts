import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type {
  FlowReportOut,
  HeatmapReportOut,
  LatencyReportOut,
  ReportsOverviewOut,
  TimeseriesReportOut,
} from "@/generated/contract";
import { controlPlane } from "@/lib/control-plane";
import type { ReportWindow } from "@/lib/control-plane/operations/reports";

import { timeWindowKey, timeWindowUsable, type TimeWindow } from "@/components/time-range-picker";

import { normalizeTimeseries } from "./report-types";
import type {
  HealthReport,
  HeatmapMetric,
  HeatmapRange,
  RevisionLike,
  TimeseriesReport,
  TrendDimension,
  TrendMetric,
} from "./report-types";

/**
 * 全部报表 hooks 都把 react-query 的 queryFn signal 透传给控制面（AbortController）：
 * 换区间/换维度/换指标时旧请求立刻取消，连点不排队（W6 验收流程 4）。
 *
 * W4 票04：页面/hook 不再判断 mock、不拼 URL——数据来自 control-plane 的 reports 操作，
 * 适配器（HTTP / 内存）在组合根按 VITE_MOCK 选择。
 */

/** 展示层时间窗 → 操作层参数（query 串由适配器生成）。 */
function toReportWindow(window: TimeWindow): ReportWindow {
  return window.kind === "range"
    ? { kind: "range", value: window.value }
    : { kind: "custom", fromMs: window.fromMs, toMs: window.toMs };
}

/**
 * W6 票 16：自定义窗超界（跨度 > 契约上限）时 enabled=false，聚合请求根本不发出——
 * 这是发布路径校验之外的纵深防御，日志页/未来调用方同样被这扇门覆盖。
 */
export function useReportsOverview(window: TimeWindow) {
  return useQuery({
    queryKey: ["reports", "overview", ...timeWindowKey(window)],
    enabled: timeWindowUsable(window),
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<ReportsOverviewOut> => {
      return controlPlane.reports.overview(toReportWindow(window), { signal });
    },
  });
}

export interface TimeseriesParams {
  window: TimeWindow;
  dimension: TrendDimension;
  metric: TrendMetric;
  /** 分流图不画柱形/面积，切到分流时停掉这条查询。 */
  enabled?: boolean;
}

/**
 * 柱形/面积共用的分桶数据：时间窗、维度、指标都进 queryKey，
 * 切换时用 keepPreviousData 保住上一帧，避免图表闪成骨架。
 */
export function useReportsTimeseries({ window, dimension, metric, enabled = true }: TimeseriesParams) {
  return useQuery({
    queryKey: ["reports", "timeseries", ...timeWindowKey(window), dimension, metric],
    enabled: enabled && timeWindowUsable(window),
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<TimeseriesReport> => {
      const raw = await controlPlane.reports.timeseries(
        { window: toReportWindow(window), dimension, metric },
        { signal },
      );
      return normalizeTimeseries(raw as TimeseriesReportOut, metric);
    },
  });
}

/** 延迟分位：TTFT / 总耗时 × P50/P75/P95/P99，配对样本不足时后端给 null。 */
export function useReportsLatency(window: TimeWindow) {
  return useQuery({
    queryKey: ["reports", "latency", ...timeWindowKey(window)],
    enabled: timeWindowUsable(window),
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<LatencyReportOut> => {
      return controlPlane.reports.latency(toReportWindow(window), { signal });
    },
  });
}

/** 热力图有独立区间（7D/30D/365D）与指标（词元/成本/花费）。 */
export function useReportsHeatmap(range: HeatmapRange, metric: HeatmapMetric) {
  return useQuery({
    queryKey: ["reports", "heatmap", range, metric],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<HeatmapReportOut> => {
      return controlPlane.reports.heatmap({ range, metric }, { signal });
    },
  });
}

export interface FlowParams {
  window: TimeWindow;
  metric: "requests" | "tokens";
  /** 被隐藏的阶段 id；后端按完整五元组路径投影后返回可见子图。 */
  collapse?: string[];
  /** focus 节点 id：只保留该节点前后整条链（W6 票 17，后端聚合过滤）。 */
  focus?: string;
  /** q 标签子串：大量节点时由后端过滤，前端不再硬算。 */
  q?: string;
  /** top_n：每段保留前 n 个节点、尾段折为 other:<stage>（0=关）。 */
  topN?: number;
  enabled?: boolean;
}

/** 分流：五段桑基（用户 → 密钥 → 公开模型 → 上游模型 → 上游渠道）。 */
export function useReportsFlow({
  window,
  metric,
  collapse = [],
  focus = "",
  q = "",
  topN = 0,
  enabled = true,
}: FlowParams) {
  // 隐藏集合是集合语义：排序后再进查询键/参数，同一组隐藏阶段命中同一份缓存。
  const hidden = [...collapse].sort().join(",");
  const narrowedKey = `${hidden}|${focus.trim()}|${q.trim()}|${topN}`;
  return useQuery({
    queryKey: ["reports", "flow", ...timeWindowKey(window), metric, narrowedKey],
    enabled: enabled && timeWindowUsable(window),
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<FlowReportOut> => {
      return controlPlane.reports.flow(
        { window: toReportWindow(window), metric, collapse, focus, q, topN },
        { signal },
      );
    },
  });
}

/** 控制面健康：真实模式打 /admin/health，离线演示由内存适配器给等价 fixture。 */
export function useControlPlaneHealth() {
  return useQuery({
    queryKey: ["reports", "health"],
    queryFn: async ({ signal }): Promise<HealthReport> => {
      return controlPlane.reports.health({ signal });
    },
    refetchInterval: 60_000,
  });
}

/** 最近配置版本；两个端点字段形状不同，渲染层用 normalizeRevision 归一。 */
export function useRecentRevisions(limit = 5) {
  return useQuery({
    queryKey: ["reports", "revisions", limit],
    queryFn: async ({ signal }): Promise<RevisionLike[]> => {
      return controlPlane.reports.revisions(limit, { signal });
    },
  });
}
