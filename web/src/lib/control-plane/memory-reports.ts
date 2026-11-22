/**
 * 报表域的内存实现（W4 票04）：复用 report-fixtures 的确定性演示投影，
 * 与 HTTP adapter 实现同一份 ReportsOperations。页面不再自己判断是否 mock。
 */

import type { HeatmapMetric, HeatmapRange, TrendDimension, TrendMetric } from "@/components/dashboard/report-types";
import type { TimeWindow, TimeWindowRange } from "@/components/time-range-picker";

import {
  mockFlow,
  mockHeatmap,
  mockLatency,
  mockOverview,
  mockRevisions,
  mockTimeseries,
} from "./memory/report-fixtures";
import type { ReportWindow, ReportsOperations } from "./operations/reports";

/** 操作层时间窗 → 展示层 TimeWindow（仅内存实现需要，HTTP 实现直接拼 query）。 */
function toWindow(window: ReportWindow): TimeWindow {
  if (window.kind === "range") return { kind: "range", value: window.value as TimeWindowRange };
  return { kind: "custom", fromMs: window.fromMs, toMs: window.toMs };
}

export function createMemoryReports(): ReportsOperations {
  return {
    overview: async (window) => {
      void window;
      return mockOverview();
    },
    timeseries: async (query) =>
      mockTimeseries(toWindow(query.window), query.dimension as TrendDimension, query.metric as TrendMetric),
    latency: async (window) => mockLatency(window ? toWindow(window) : { kind: "range", value: "7d" }),
    heatmap: async (query) => mockHeatmap(query.range as HeatmapRange, query.metric as HeatmapMetric),
    flow: async (query) =>
      mockFlow(
        query.metric,
        query.collapse ?? [],
        { focus: query.focus ?? "", q: query.q ?? "", topN: query.topN ?? 0 },
        toWindow(query.window),
      ),
    health: async () => ({
      status: "ok",
      ir_version: "v1",
      adapter: "agentgateway",
      data_plane_port: 3600,
      now_ms: Date.now(),
    }),
    revisions: async (limit) => mockRevisions().slice(0, limit),
  };
}
