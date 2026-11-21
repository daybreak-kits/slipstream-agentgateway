import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { DashboardKpis } from "@/components/dashboard/metric-cards";
import { PageHeader } from "@/components/layout/page-header";
import { HeatmapCard } from "@/components/dashboard/heatmap";
import { LatencyCards } from "@/components/dashboard/latency-cards";
import {
  estimateNoteText,
  parseChartView,
  type ChartView,
  type TrendDimension,
  type TrendMetric,
} from "@/components/dashboard/report-types";
import { TrendPanel } from "@/components/dashboard/trend-panel";
import { useReportsLatency, useReportsTimeseries } from "@/components/dashboard/use-reports";
import { TimeRangePicker, type TimeWindow } from "@/components/time-range-picker";
import { Button } from "@/components/ui/button";

/**
 * 看板 v3（F1 重构）：区间选择器 → 八卡 → 趋势（柱形/面积/分流）→ 延迟分位 → 热力图。
 * 区间状态 {kind:"range",value} | {kind:"custom",fromMs,toMs} 归 TimeRangePicker 所有，
 * 进全部报表 queryKey；keepPreviousData + AbortController 保证切换平滑、连点不排队。
 * ?tab= 写 URL 与旧系统一致；桶边界与币种全部来自接口，前端不自算。
 * W6 票 17：独立「请求链路」面板已删（与分流图重复，组件留给登录页复用），
 * 「查看分流」入口移到页头，仍一键直达分流视图。
 */
export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const view = parseChartView(params.get("tab"));
  const [timeWindow, setTimeWindow] = useState<TimeWindow>({ kind: "range", value: "7d" });
  const [dimension, setDimension] = useState<TrendDimension>("combo");
  const [metric, setMetric] = useState<TrendMetric>("requests");

  const series = useReportsTimeseries({ window: timeWindow, dimension, metric });
  // 分流只接受 requests/tokens：指标是费用时回落到请求量。
  const latency = useReportsLatency(timeWindow);

  const setView = useCallback(
    (next: ChartView) => {
      const copy = new URLSearchParams(params);
      copy.set("tab", next);
      setParams(copy, { replace: true });
    },
    [params, setParams],
  );

  const currency = series.data?.currency;
  const timezone = series.data?.timezone;

  return (
    <div className="space-y-4">
      <PageHeader
        title="看板"
        description={
          <>
            调用量、词元、成本与花费
            {currency ? ` · 金额币种 ${currency}` : ""}
            {timezone ? ` · 时区 ${timezone}` : ""}
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setView("flow");
                document.getElementById("trend-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              查看分流
            </Button>
            <TimeRangePicker value={timeWindow} onChange={setTimeWindow} />
          </>
        }
      />

      <DashboardKpis
        data={series.data}
        latency={latency.data}
        loading={series.isPending}
        error={series.isError ? series.error : undefined}
        onRetry={() => void series.refetch()}
      />

      <div id="trend-panel">
      <TrendPanel
        window={timeWindow}
        view={view}
        onViewChange={setView}
        dimension={dimension}
        onDimensionChange={setDimension}
        metric={metric}
        onMetricChange={setMetric}
        series={series.data}
        seriesLoading={series.isPending}
        seriesError={series.isError ? series.error : undefined}
        onSeriesRetry={() => void series.refetch()}
      />
      </div>

      <LatencyCards
        window={timeWindow}
        data={latency.data}
        loading={latency.isPending}
        error={latency.isError ? latency.error : undefined}
        onRetry={() => void latency.refetch()}
      />

      <HeatmapCard />

      <p className="text-2xs text-faint">
        {estimateNoteText(series.data?.estimate_note ?? "")}
        {" · 成本/花费仅对具备相应权限的账号展示，无权限时接口直接不返回这些字段。"}
      </p>
    </div>
  );
}
