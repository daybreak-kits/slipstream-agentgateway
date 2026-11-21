import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useMock } from "@/lib/mock";

import { timeWindowKey, type TimeWindow } from "@/components/time-range-picker";

import { mockFlow, mockHeatmap, mockLatency, mockOverview, mockRevisions, mockTimeseries } from "./report-mocks";
import { normalizeTimeseries, REPORT_PATHS } from "./report-types";
import type {
  FlowReport,
  HealthReport,
  HeatmapMetric,
  HeatmapRange,
  HeatmapReport,
  LatencyReport,
  RawTimeseriesReport,
  ReportsOverview,
  RevisionLike,
  TimeseriesReport,
  TrendDimension,
  TrendMetric,
} from "./report-types";

/**
 * 全部报表 hooks 都把 react-query 的 queryFn signal 透传给 lib/api（AbortController）：
 * 换区间/换维度/换指标时旧请求立刻取消，连点不排队（W6 验收流程 4）。
 */

/**
 * 时间窗 → query 参数。预设区间只传 range 枚举（桶边界按报表时区切，前端不自算毫秒）；
 * 本周/本月/自定义传成对 from_ms/to_ms（后端 F 契约：成对生效，payload range 回显 "custom"）。
 */
function windowParams(window: TimeWindow): URLSearchParams {
  const params = new URLSearchParams();
  if (window.kind === "range") {
    params.set("range", window.value);
  } else {
    params.set("range", "7d");
    params.set("from_ms", String(window.fromMs));
    params.set("to_ms", String(window.toMs));
  }
  return params;
}

/** 指标卡备用入口：overview 只吃 from_ms/to_ms（0=全时段），报表时区由后端定。 */
export function useReportsOverview(window: TimeWindow) {
  return useQuery({
    queryKey: ["reports", "overview", ...timeWindowKey(window)],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<ReportsOverview> => {
      if (useMock) return mockOverview();
      const params = new URLSearchParams();
      if (window.kind === "custom") {
        params.set("from_ms", String(window.fromMs));
        params.set("to_ms", String(window.toMs));
      }
      const query = params.toString();
      return api.get<ReportsOverview>(REPORT_PATHS.overview + (query ? "?" + query : ""), { signal });
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
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<TimeseriesReport> => {
      if (useMock) return mockTimeseries(window, dimension, metric);
      const params = windowParams(window);
      params.set("dimension", dimension);
      if (metric === "money") params.set("metrics", "cost_micro,charge_micro");
      else params.set("metric", metric);
      const raw = await api.get<RawTimeseriesReport>(REPORT_PATHS.timeseries + "?" + params.toString(), {
        signal,
      });
      return normalizeTimeseries(raw, metric);
    },
  });
}

/** 延迟分位：TTFT / 总耗时 × P50/P75/P95/P99，配对样本不足时后端给 null。 */
export function useReportsLatency(window: TimeWindow) {
  return useQuery({
    queryKey: ["reports", "latency", ...timeWindowKey(window)],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<LatencyReport> => {
      if (useMock) return mockLatency(window);
      return api.get<LatencyReport>(REPORT_PATHS.latency + "?" + windowParams(window).toString(), { signal });
    },
  });
}

/** 热力图有独立区间（7D/30D/365D）与指标（词元/成本/花费）。 */
export function useReportsHeatmap(range: HeatmapRange, metric: HeatmapMetric) {
  return useQuery({
    queryKey: ["reports", "heatmap", range, metric],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<HeatmapReport> => {
      if (useMock) return mockHeatmap(range, metric);
      const params = new URLSearchParams({ range, metric });
      return api.get<HeatmapReport>(REPORT_PATHS.heatmap + "?" + params.toString(), { signal });
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
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<FlowReport> => {
      if (useMock) return mockFlow(metric, collapse, { focus, q, topN });
      const params = windowParams(window);
      params.set("metric", metric);
      if (hidden) params.set("collapse", hidden);
      if (focus.trim()) params.set("focus", focus.trim());
      if (q.trim()) params.set("q", q.trim());
      if (topN > 0) params.set("top_n", String(topN));
      return api.get<FlowReport>(REPORT_PATHS.flow + "?" + params.toString(), { signal });
    },
  });
}

/**
 * 控制面健康。mock 下没有 /admin/health 路由，直接给等价 fixture；
 * 真实模式打 routers_health.py 的 /admin/health（data_plane_port=3600）。
 */
export function useControlPlaneHealth() {
  return useQuery({
    queryKey: ["reports", "health"],
    queryFn: async ({ signal }): Promise<HealthReport> => {
      if (useMock) {
        return {
          status: "ok",
          ir_version: "v1",
          adapter: "agentgateway",
          data_plane_port: 3600,
          now_ms: Date.now(),
        };
      }
      return api.get<HealthReport>(REPORT_PATHS.health, { signal });
    },
    refetchInterval: 60_000,
  });
}

/** 最近配置版本；两个端点字段形状不同，渲染层用 normalizeRevision 归一。 */
export function useRecentRevisions(limit = 5) {
  return useQuery({
    queryKey: ["reports", "revisions", limit],
    queryFn: async ({ signal }): Promise<RevisionLike[]> => {
      if (useMock) return mockRevisions().slice(0, limit);
      // 真实后端：/admin/config/revisions?page_size=25&offset=0，取前 limit 条
      const rows = await api.get<RevisionLike[]>("/admin/config/revisions?page_size=25&offset=0", { signal });
      return rows.slice(0, limit);
    },
  });
}
