import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Empty } from "@/components/ui/empty";
import { TabBar } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtCount } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";

import { ChartCard } from "./chart-card";
import { compactMoney, fmtMoney, shortBucketLabel } from "./chart-format";
import { seriesVar, useChartPalette } from "./chart-theme";
import { FlowChart } from "./flow-chart";
import { MemberPanel } from "./member-panel";
import {
  CHART_VIEWS,
  TREND_DIMENSIONS,
  TREND_METRICS,
  type ChartView,
  type FlowReport,
  type TimeseriesReport,
  type TrendDimension,
  type TrendMetric,
} from "./report-types";
import { timeWindowKey, type TimeWindow } from "@/components/time-range-picker";

const CHIP =
  "h-7 rounded-control px-2 text-2xs text-body data-[state=on]:bg-primary-soft data-[state=on]:text-primary";

interface TooltipRow {
  dataKey?: string | number;
  value?: number | string;
}

interface SeriesTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<TooltipRow>;
  label?: string | number;
  metric: TrendMetric;
  currency: string | undefined;
  labels: Record<string, string>;
}

function formatMetric(value: number, metric: TrendMetric, currency: string | undefined): string {
  return metric === "money" ? fmtMoney(value, currency) : fmtCount(value);
}

/** 工具提示：固定深色（两主题同值），空桶写「该时段无数据」。 */
function SeriesTooltip({ active, payload, label, metric, currency, labels }: SeriesTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload
    .map((row) => ({ key: String(row.dataKey ?? ""), value: Number(row.value ?? 0) }))
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const shown = rows.slice(0, 10);
  const rest = rows.length - shown.length;

  return (
    <div className="w-56 rounded-control border border-[var(--tooltip-border)] bg-[var(--tooltip-bg)] p-2 text-2xs text-[var(--tooltip-fg)] shadow-pop">
      <div className="mb-1 font-medium">{String(label ?? "")}</div>
      {total <= 0 ? (
        <div className="text-[var(--tooltip-fg-muted)]">该时段无数据</div>
      ) : (
        <>
          <ul className="space-y-0.5">
            {shown.map((row) => (
              <li key={row.key} className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
                  <span className="truncate">{labels[row.key] ?? row.key}</span>
                </span>
                <span className="shrink-0 tnum tabular-nums">{formatMetric(row.value, metric, currency)}</span>
              </li>
            ))}
          </ul>
          {rest > 0 && <div className="mt-1 text-[var(--tooltip-fg-muted)]">另有 {rest} 个成员</div>}
          <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-white/10 pt-1">
            <span className="text-[var(--tooltip-fg-muted)]">合计</span>
            <span className="tnum tabular-nums">{formatMetric(total, metric, currency)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** 费用双系列的图例芯片：成本/花费各占一个色板槽。 */
function MoneyLegend() {
  return (
    <div className="flex items-center gap-3 text-2xs text-faint">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: seriesVar(0) }} />
        成本
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: seriesVar(1) }} />
        花费
      </span>
    </div>
  );
}

interface TrendPlotProps {
  report: TimeseriesReport;
  metric: TrendMetric;
  hidden: string[];
  kind: "bar" | "area";
}

/** 柱形堆叠 / 面积分层：两图共用同一份分桶数据与 16 槽色板；费用指标改画成本/花费双系列。 */
function TrendPlot({ report, metric, hidden, kind }: TrendPlotProps) {
  const palette = useChartPalette();
  const labels = useMemo(() => {
    if (metric === "money") return { cost: "成本", charge: "花费" };
    return Object.fromEntries(report.members.map((member) => [member.id, member.label]));
  }, [report.members, metric]);
  // 成员序号先建 Map，替代 map 内 findIndex 的 O(n²)（F1 性能修）。
  const indexById = useMemo(
    () => new Map(report.members.map((member, index) => [member.id, index] as const)),
    [report.members],
  );
  const members = report.members.filter((member) => member.total > 0);
  const visible = members.filter((member) => !hidden.includes(member.id));
  const isMoney = metric === "money";
  const formatAxis = (value: number): string =>
    isMoney ? compactMoney(value, report.currency) : fmtCount(value);

  if (!isMoney && visible.length === 0) {
    return <Empty title="已隐藏全部成员" description="在右侧成员列点一下即可重新显示。" />;
  }

  const ChartRoot = kind === "bar" ? BarChart : AreaChart;
  const content = (props: unknown) => (
    <SeriesTooltip
      {...(props as SeriesTooltipProps)}
      metric={metric}
      currency={report.currency}
      labels={labels}
    />
  );

  const moneyData = report.points.map((point) => ({
    label: point.label,
    cost: point.cost_micro ?? 0,
    charge: point.charge_micro ?? 0,
  }));

  return (
    <div className="h-[320px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ChartRoot
          data={isMoney ? moneyData : report.points.map((point) => ({ label: point.label, ...point.values }))}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke={palette.grid} />
          <XAxis
            dataKey="label"
            tickFormatter={(value: string) => shortBucketLabel(value, report.bucket)}
            tick={{ fontSize: 11, fill: palette.faint }}
            axisLine={{ stroke: palette.axis }}
            tickLine={false}
            minTickGap={24}
            tickMargin={8}
          />
          <YAxis
            tickFormatter={formatAxis}
            tick={{ fontSize: 11, fill: palette.faint }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            content={content}
            cursor={
              kind === "bar"
                ? { fill: "var(--surface-2)", opacity: 0.6 }
                : { stroke: "var(--border-strong)", strokeDasharray: "3 3" }
            }
          />
          {isMoney ? (
            <>
              {kind === "bar" ? (
                <>
                  <Bar dataKey="cost" name="成本" fill={seriesVar(0)} stroke="none" maxBarSize={26} isAnimationActive={false} />
                  <Bar dataKey="charge" name="花费" fill={seriesVar(1)} stroke="none" maxBarSize={26} isAnimationActive={false} />
                </>
              ) : (
                <>
                  <Area
                    dataKey="cost"
                    name="成本"
                    type="monotone"
                    stroke={seriesVar(0)}
                    fill={seriesVar(0)}
                    fillOpacity={0.16}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                  <Area
                    dataKey="charge"
                    name="花费"
                    type="monotone"
                    stroke={seriesVar(1)}
                    fill={seriesVar(1)}
                    fillOpacity={0.16}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                </>
              )}
            </>
          ) : (
            visible.map((member) => {
              const color = seriesVar(indexById.get(member.id) ?? 0);
              return kind === "bar" ? (
                <Bar
                  key={member.id}
                  dataKey={member.id}
                  name={member.label}
                  stackId="all"
                  fill={color}
                  stroke="none"
                  maxBarSize={26}
                  isAnimationActive={false}
                />
              ) : (
                <Area
                  key={member.id}
                  dataKey={member.id}
                  name={member.label}
                  type="monotone"
                  stroke={color}
                  fill={color}
                  fillOpacity={0.16}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              );
            })
          )}
        </ChartRoot>
      </ResponsiveContainer>
    </div>
  );
}

export interface TrendPanelProps {
  window: TimeWindow;
  view: ChartView;
  onViewChange: (view: ChartView) => void;
  dimension: TrendDimension;
  onDimensionChange: (dimension: TrendDimension) => void;
  metric: TrendMetric;
  onMetricChange: (metric: TrendMetric) => void;
  series: TimeseriesReport | undefined;
  seriesLoading: boolean;
  seriesError: unknown;
  onSeriesRetry: () => void;
  flow: FlowReport | undefined;
  flowLoading: boolean;
  flowError: unknown;
  onFlowRetry: () => void;
}

/**
 * 趋势卡片：同一张卡里切柱形/面积/分流（?tab= 写 URL）。
 * 柱形/面积右侧固定成员列（只显 名称+占比+当前指标数）；维度单选、指标 请求/词元/费用。
 * 费用 = 成本+花费双系列（metrics=cost_micro,charge_micro）；分流只接受 请求/词元。
 */
export function TrendPanel({
  window,
  view,
  onViewChange,
  dimension,
  onDimensionChange,
  metric,
  onMetricChange,
  series,
  seriesLoading,
  seriesError,
  onSeriesRetry,
  flow,
  flowLoading,
  flowError,
  onFlowRetry,
}: TrendPanelProps) {
  const { can } = usePermissions();
  const [hidden, setHidden] = useState<string[]>([]);
  const [hiddenStages, setHiddenStages] = useState<string[]>([]);
  const windowKey = timeWindowKey(window).join("|");

  // 换维度/区间后成员集合与分流轴的隐藏集合都没有意义，一并重置。
  useEffect(() => {
    setHidden([]);
    setHiddenStages([]);
  }, [dimension, windowKey]);

  // 分流五段轴的隐藏集合：换区间后重置，点击节点/芯片/底部轴名都可切换。
  const toggleStage = useCallback((stageId: string) => {
    setHiddenStages((prev) =>
      prev.includes(stageId) ? prev.filter((item) => item !== stageId) : [...prev, stageId],
    );
  }, []);

  const isFlow = view === "flow";
  const allowedMetrics = TREND_METRICS.filter((option) => !option.permission || can(option.permission));
  const metricOptions = isFlow
    ? allowedMetrics.filter((option) => option.value === "requests" || option.value === "tokens")
    : allowedMetrics;
  const fallback = metricOptions[0]?.value ?? "requests";
  const effectiveMetric = metricOptions.some((option) => option.value === metric) ? metric : fallback;
  useEffect(() => {
    if (effectiveMetric !== metric) onMetricChange(effectiveMetric);
  }, [effectiveMetric, metric, onMetricChange]);

  const subtitle = isFlow
    ? "五段流向：用户 → 连接密钥 → 公开模型 → 上游模型 → 上游渠道；链路宽度按所选指标加权"
    : view === "bar"
      ? "按成员堆叠；柱形只画可叠加指标，P95 分位见下方「延迟分位」"
      : "按成员分层不堆叠；费用指标为成本/花费双系列，P95 分位见下方「延迟分位」卡片";

  const hasSeries = Boolean(series && series.members.length > 0);
  const hasFlow = Boolean(flow && flow.links.length > 0);
  const loading = isFlow ? flowLoading : seriesLoading;
  const error = isFlow ? flowError : seriesError;
  const onRetry = isFlow ? onFlowRetry : onSeriesRetry;
  const emptyText =
    !loading && !error && !(isFlow ? hasFlow : hasSeries)
      ? isFlow
        ? "所选区间还没有调用链：先在「上游渠道」与「公开模型」保存一次配置，再发起真实调用"
        : "所选区间还没有调用记录：换一个时间范围，或先发起一次真实调用"
      : null;

  const toggleMember = (id: string) => {
    setHidden((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  return (
    <ChartCard
      title="用量趋势"
      subtitle={subtitle}
      actions={
        <div className="max-w-full overflow-x-auto">
          <TabBar
            items={CHART_VIEWS.map((item) => ({ key: item.value, label: item.label }))}
            value={view}
            onValueChange={(key) => onViewChange(key as ChartView)}
            ariaLabel="图表类型"
            className="-mb-px"
          />
        </div>
      }
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyText={emptyText}
    >
      {isFlow ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xs text-faint">指标</span>
            <ToggleGroup
              type="single"
              value={effectiveMetric}
              aria-label="分流指标"
              onValueChange={(value) => {
                if (value) onMetricChange(value as TrendMetric);
              }}
            >
              {metricOptions.map((item) => (
                <ToggleGroupItem key={item.value} value={item.value} className={CHIP} title={item.hint}>
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <FlowChart data={flow} hiddenStages={hiddenStages} onToggleStage={toggleStage} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-2xs text-faint">维度</span>
              <ToggleGroup
                type="single"
                value={dimension}
                aria-label="维度"
                onValueChange={(value) => {
                  if (value) onDimensionChange(value as TrendDimension);
                }}
              >
                {TREND_DIMENSIONS.map((item) => (
                  <ToggleGroupItem key={item.value} value={item.value} className={CHIP}>
                    {item.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xs text-faint">指标</span>
              <ToggleGroup
                type="single"
                value={effectiveMetric}
                aria-label="指标"
                onValueChange={(value) => {
                  if (value) onMetricChange(value as TrendMetric);
                }}
              >
                {metricOptions.map((item) => (
                  <ToggleGroupItem key={item.value} value={item.value} className={CHIP} title={item.hint}>
                    {item.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>

          {series && effectiveMetric === "money" && <MoneyLegend />}
          {series && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
              <TrendPlot report={series} metric={effectiveMetric} hidden={hidden} kind={view} />
              <MemberPanel
                members={series.members}
                metric={effectiveMetric}
                currency={series.currency}
                hidden={hidden}
                interactive={effectiveMetric !== "money"}
                onToggle={toggleMember}
                onShowAll={() => setHidden([])}
              />
            </div>
          )}
          {series && series.folded_members > 0 && (
            <p className="text-2xs text-faint">
              指标前十名之外还有 {series.folded_members} 个成员，已折叠为「其他」
            </p>
          )}
        </div>
      )}
    </ChartCard>
  );
}
