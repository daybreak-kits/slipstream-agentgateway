import { useEffect, useRef, useState, type UIEvent } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtCount } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";

import { ChartCard } from "./chart-card";
import { fmtMoney } from "./chart-format";
import { HEATMAP_METRICS, HEATMAP_RANGES, heatmapMetricLabel, type HeatmapMetric, type HeatmapRange } from "./report-types";
import { useReportsHeatmap } from "./use-reports";

const CHIP =
  "h-7 rounded-control px-2 text-2xs text-body data-[state=on]:bg-primary-soft data-[state=on]:text-primary";

/** 外框定高：7D/30D/365D 与指标切换时热力图区域尺寸不变，格子自适应缩放。 */
const FRAME_HEIGHT = 352;
/** 行标签列宽。 */
const LABEL_WIDTH = 64;
/** 行高钳制：下限保住 text-2xs（11px）可读，上限避免 7D 单行撑爆。 */
const MIN_ROW_H = 14;
const WEEKDAY_MAX_ROW_H = 48;
const DATE_MAX_ROW_H = 24;
/** 虚拟化上下各多渲染 4 行，滚动时不露白边。 */
const BUFFER_ROWS = 4;

function rowHeightFor(rowCount: number, mode: "weekday_hour" | "date_hour"): number {
  if (rowCount <= 0) return MIN_ROW_H;
  const ideal = FRAME_HEIGHT / rowCount;
  const max = mode === "weekday_hour" ? WEEKDAY_MAX_ROW_H : DATE_MAX_ROW_H;
  return Math.min(max, Math.max(MIN_ROW_H, Math.round(ideal)));
}

const GRID_TEMPLATE = `${LABEL_WIDTH}px repeat(24, minmax(0, 1fr))`;

/**
 * 时段热力图（F1 定案）：7D 星期×小时，30D/365D 日期×小时。
 * 外框定宽高 + 行虚拟化（只渲染可视行 ±4 行）：365d=366×24=8784 格时 DOM 里只有约 30 行，
 * 原生 title tooltip / 图例 / 合计全保留；格子透明度按 max 归一，零值格用 surface-2 表示「无请求」。
 */
export function HeatmapCard() {
  const { can } = usePermissions();
  const [range, setRange] = useState<HeatmapRange>("7d");
  const [metric, setMetric] = useState<HeatmapMetric>("tokens");
  const [scrollTop, setScrollTop] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);

  const metricOptions = HEATMAP_METRICS.filter((option) => !option.permission || can(option.permission));
  const fallback = metricOptions[0]?.value ?? "tokens";
  const effectiveMetric = metricOptions.some((option) => option.value === metric) ? metric : fallback;
  useEffect(() => {
    if (effectiveMetric !== metric) setMetric(effectiveMetric);
  }, [effectiveMetric, metric]);

  const query = useReportsHeatmap(range, effectiveMetric);
  const data = query.data;
  const isMoney = effectiveMetric === "cost" || effectiveMetric === "spend";
  const max = data?.max ?? 0;
  const rowCount = data?.rows.length ?? 0;
  const rowH = data ? rowHeightFor(rowCount, data.mode) : MIN_ROW_H;
  const contentHeight = rowCount * rowH;

  // 换档位/指标后回到顶部，避免残留的 scrollTop 落在新内容之外。
  useEffect(() => {
    frameRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [range, effectiveMetric]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollTop(top);
    });
  };

  const formatValue = (value: number): string =>
    isMoney ? fmtMoney(value, data?.currency) : fmtCount(value);
  const cellTitle = (rowLabel: string, columnLabel: string, value: number): string =>
    `${rowLabel} ${columnLabel}:00 · ${value > 0 ? formatValue(value) + (isMoney ? "" : " 词元") : "无请求"}`;
  const cellOpacity = (value: number): number => {
    if (!value || max <= 0) return 0;
    return 0.15 + 0.85 * Math.min(1, value / max);
  };

  // 可视行窗口（±BUFFER），行内 25 个格子照常渲染。
  const firstRow = Math.max(0, Math.floor(scrollTop / rowH) - BUFFER_ROWS);
  const lastRow = Math.min(rowCount, Math.ceil((scrollTop + FRAME_HEIGHT) / rowH) + BUFFER_ROWS);
  const visibleRows = data ? data.rows.slice(firstRow, lastRow) : [];

  return (
    <ChartCard
      title="时段热力图"
      subtitle={`${range.toUpperCase()} · 按${heatmapMetricLabel(effectiveMetric)}；每格${isMoney ? "金额（元）" : "词元数"}，颜色越深越高`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={range}
            aria-label="热力图区间"
            onValueChange={(value) => {
              if (value) setRange(value as HeatmapRange);
            }}
          >
            {HEATMAP_RANGES.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value} className={CHIP}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={effectiveMetric}
            aria-label="热力图指标"
            onValueChange={(value) => {
              if (value) setMetric(value as HeatmapMetric);
            }}
          >
            {metricOptions.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value} className={CHIP}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      }
      loading={query.isPending}
      error={query.isError ? query.error : undefined}
      onRetry={() => void query.refetch()}
      emptyText={!query.isPending && !query.isError && max === 0 ? "所选区间还没有调用记录，换一个区间看看" : null}
    >
      {data && (
        <div className="space-y-2">
          <div className="grid items-center gap-x-1" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
            <span aria-hidden="true" />
            {data.columns.map((column) => (
              <span key={column.key} className="text-center text-2xs text-faint">
                {Number(column.key) % 3 === 0 ? column.label : ""}
              </span>
            ))}
          </div>
          <div
            ref={frameRef}
            onScroll={onScroll}
            className="overflow-y-auto pr-1"
            style={{ height: FRAME_HEIGHT }}
            role="img"
            aria-label={`时段热力图：${data.mode === "weekday_hour" ? "星期 × 小时" : "日期 × 小时"}，${rowCount} 行 × 24 列`}
          >
            <div className="relative" style={{ height: contentHeight }}>
              {visibleRows.map((row, offset) => {
                const rowIndex = firstRow + offset;
                return (
                  <div
                    key={row.key}
                    className="absolute inset-x-0 grid items-center gap-x-1"
                    style={{ top: rowIndex * rowH, height: rowH, gridTemplateColumns: GRID_TEMPLATE }}
                  >
                    <span className="truncate text-2xs text-faint" title={row.label}>
                      {row.label}
                    </span>
                    {row.values.map((value, hour) => {
                      const column = data.columns[hour];
                      return (
                        <span
                          key={`${row.key}-${column?.key ?? hour}`}
                          title={cellTitle(row.label, column?.label ?? "", value)}
                          className={
                            value > 0 ? "block rounded-[2px] bg-primary" : "block rounded-[2px] bg-surface-2"
                          }
                          style={{
                            height: Math.max(MIN_ROW_H - 2, rowH - 2),
                            ...(value > 0 ? { opacity: cellOpacity(value) } : {}),
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-faint">
            <div className="flex items-center gap-1.5">
              <span>少</span>
              {[0.15, 0.4, 0.7, 1].map((opacity) => (
                <span
                  key={opacity}
                  aria-hidden="true"
                  className="h-2.5 w-4 rounded-[2px] bg-primary"
                  style={{ opacity }}
                />
              ))}
              <span>多</span>
              <span className="ml-2">峰值 {formatValue(max)}</span>
            </div>
            <span>
              合计 {formatValue(data.total)} · 时区 {data.timezone}
            </span>
          </div>
        </div>
      )}
    </ChartCard>
  );
}
