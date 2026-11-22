/**
 * 报表域的 typed operations（W4 票04）：看板总览 / 趋势 / 延迟 / 热力 / 分流 / 健康 / 配置版本。
 *
 * 页面只传领域参数（时间窗、维度、指标），query 串与端点路径由适配器负责；
 * 响应类型用 web/src/generated/contract.ts 的生成类型（报表契约由票03定稿）。
 */

import type {
  FlowReportOut,
  HeatmapReportOut,
  LatencyReportOut,
  ReportsOverviewOut,
  TimeseriesReportOut,
} from "@/generated/contract";

import type { OperationOptions } from "../types";

/** 报表时间窗（与 UI 的 TimeWindow 同形，但不依赖组件层类型）。 */
export type ReportWindow =
  | { kind: "range"; value: string }
  | { kind: "custom"; fromMs: number; toMs: number };

export interface TimeseriesQuery {
  window: ReportWindow;
  dimension: string;
  metric: string;
}

export interface HeatmapQuery {
  range: string;
  metric: string;
}

export interface FlowQuery {
  window: ReportWindow;
  metric: "requests" | "tokens";
  collapse?: string[];
  focus?: string;
  q?: string;
  topN?: number;
}

/** 配置版本行：/admin/config/revisions 响应字段（历史接口较宽松，渲染层归一）。 */
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

/** 控制面健康响应（routers_health.py）。 */
export interface HealthReport {
  status: string;
  ir_version: string;
  adapter: string;
  data_plane_port: number;
  now_ms: number;
}

export interface ReportsOperations {
  overview(window: ReportWindow, options?: OperationOptions): Promise<ReportsOverviewOut>;
  timeseries(query: TimeseriesQuery, options?: OperationOptions): Promise<TimeseriesReportOut>;
  /** 日志页的分位锚可只带 from/to；window 缺省表示不传时间参数（后端默认全时段）。 */
  latency(window: ReportWindow | undefined, options?: OperationOptions): Promise<LatencyReportOut>;
  heatmap(query: HeatmapQuery, options?: OperationOptions): Promise<HeatmapReportOut>;
  flow(query: FlowQuery, options?: OperationOptions): Promise<FlowReportOut>;
  health(options?: OperationOptions): Promise<HealthReport>;
  revisions(limit: number, options?: OperationOptions): Promise<RevisionLike[]>;
}
