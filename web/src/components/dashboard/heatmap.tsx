import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtInt } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";

import { ChartCard } from "./chart-card";
import { fmtMoney } from "./chart-format";
import { HEATMAP_METRICS, HEATMAP_RANGES, heatmapMetricLabel, type HeatmapMetric, type HeatmapRange, type HeatmapRow } from "./report-types";
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
/** 聚合行（≤13 行）的格子高度上限，与日期行的 24px 上限一致。 */
const AGG_MAX_CELL_H = 24;
/** 行间距：聚合模式 flex 列布局里行与行之间的 2px 缝。 */
const AGG_ROW_GAP = 2;
/** 虚拟化上下各多渲染 4 行，滚动时不露白边（仅 7D 星期模式仍需滚动）。 */
const BUFFER_ROWS = 4;

function rowHeightFor(rowCount: number): number {
  if (rowCount <= 0) return MIN_ROW_H;
  const ideal = FRAME_HEIGHT / rowCount;
  return Math.min(WEEKDAY_MAX_ROW_H, Math.max(MIN_ROW_H, Math.round(ideal)));
}

const GRID_TEMPLATE = `${LABEL_WIDTH}px repeat(24, minmax(0, 1fr))`;

/**
 * 聚合行（W4-B）：date_hour 的日期行在前端折叠成周/月行——30D 按自然周（周一为首，
 * 约 5–6 行）、365D 按自然月（≤13 行）。每格 = 该周/月在此小时的合计；行数远小于
 * 24–366，直接整列渲染且行高自适应铺满 352 定框，零滚动、虚拟化不再需要。
 */
interface AggregatedRow {
  key: string;
  label: string;
  values: number[];
  /** 覆盖日期段（tooltip 用），如「11/17–11/23」或「2025-11-21–2025-11-30」。 */
  coverage: string;
}

function parseRowDate(key: string): Date | null {
  const parts = key.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const date = new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function mondayOf(date: Date): Date {
  const offset = (date.getDay() + 6) % 7; // 周一为首（图例与中文习惯一致）
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

interface RowAccumulator {
  dates: Date[];
  values: number[];
}

function foldRows(rows: HeatmapRow[], groupKeyOf: (date: Date) => string): AggregatedRow[] {
  const groups = new Map<string, RowAccumulator>();
  const order: string[] = [];
  for (const row of rows) {
    const date = parseRowDate(row.key);
    if (!date) continue;
    const key = groupKeyOf(date);
    let group = groups.get(key);
    if (!group) {
      group = { dates: [], values: new Array<number>(24).fill(0) };
      groups.set(key, group);
      order.push(key);
    }
    group.dates.push(date);
    row.values.forEach((value, hour) => {
      group!.values[hour] = (group!.values[hour] ?? 0) + value;
    });
  }
  const folded: AggregatedRow[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    const first = group.dates[0]!;
    const last = group.dates[group.dates.length - 1]!;
    const sameDay = group.dates.length === 1;
    folded.push({
      key,
      label: sameDay ? shortDate(first) : `${shortDate(first)}–${shortDate(last)}`,
      coverage: sameDay ? isoDate(first) : `${isoDate(first)}–${isoDate(last)} · ${group.dates.length} 天`,
      values: group.values,
    });
  }
  return folded;
}

/** 30D：按周一开端的自然周折叠，行标签如「11/17–11/23」（覆盖不满一周时截到窗口）。 */
function aggregateWeeks(rows: HeatmapRow[]): AggregatedRow[] {
  return foldRows(rows, (date) => {
    const monday = mondayOf(date);
    return `week:${isoDate(monday)}`;
  });
}

/** 365D：按自然月折叠，行标签如「11月」；跨年窗口里去年的月份带年份前缀防重复。 */
function aggregateMonths(rows: HeatmapRow[]): AggregatedRow[] {
  const lastYear = parseRowDate(rows[rows.length - 1]?.key ?? "")?.getFullYear();
  const folded = foldRows(rows, (date) => `month:${date.getFullYear()}-${date.getMonth() + 1}`);
  return folded.map((row) => {
    const year = parseRowDate(row.coverage.slice(0, 10))?.getFullYear();
    const month = Number(row.key.split("-")[1]);
    if (year === undefined || !Number.isFinite(month)) return row;
    const baseLabel = `${month}月`;
    return { ...row, label: year !== lastYear ? `${year}年${baseLabel}` : baseLabel };
  });
}

/**
 * 时段热力图（F1 定案）：7D 星期×小时（保持原样，行虚拟化）；30D/365D 聚合行——
 * 周折叠约 5–6 行、月折叠 ≤13 行，行高自适应铺满 352 定框零滚动。
 * 7D 模式仍用行虚拟化（只渲染可视行 ±4 行）：格子透明度按 max 归一，零值格用 surface-2 表示「无请求」。
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
  const rowCount = data?.rows.length ?? 0;

  // 聚合模式（date_hour）：30D 周 / 365D 月；7D（weekday_hour）保持原样。
  const aggregated = useMemo(() => {
    if (!data || data.mode !== "date_hour") return null;
    return range === "365d" ? aggregateMonths(data.rows) : aggregateWeeks(data.rows);
  }, [data, range]);
  const aggRowCount = aggregated?.length ?? 0;
  // 峰值/透明度归一在聚合模式下要用聚合格的最大值（日期格 max 会偏大）。
  const aggMax = useMemo(
    () => Math.max(0, ...(aggregated ?? []).flatMap((row) => row.values)),
    [aggregated],
  );
  const displayMax = aggregated ? aggMax : (data?.max ?? 0);
  const rowH = data && !aggregated ? rowHeightFor(rowCount) : MIN_ROW_H;
  const contentHeight = rowCount * rowH;
  const aggRowH =
    aggRowCount > 0 ? Math.floor((FRAME_HEIGHT - (aggRowCount - 1) * AGG_ROW_GAP) / aggRowCount) : 0;
  const aggCellH = Math.max(MIN_ROW_H - 2, Math.min(AGG_MAX_CELL_H, aggRowH - 2));

  // 换档位/指标后回到顶部，避免残留的 scrollTop 落在新内容之外（仅 7D 会滚动）。
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
    isMoney ? fmtMoney(value, data?.currency) : fmtInt(value);
  const cellTitle = (rowLabel: string, columnLabel: string, value: number): string =>
    `${rowLabel} ${columnLabel}:00 · ${value > 0 ? formatValue(value) + (isMoney ? "" : " 词元") : "无请求"}`;
  const aggCellTitle = (row: AggregatedRow, columnLabel: string, value: number): string =>
    `${range === "365d" ? "按月聚合" : "按周聚合"} ${row.label}（覆盖 ${row.coverage}）` +
    ` ${columnLabel}:00 合计 · ${value > 0 ? formatValue(value) + (isMoney ? "" : " 词元") : "无请求"}`;
  const cellOpacity = (value: number): number => {
    if (!value || displayMax <= 0) return 0;
    return 0.15 + 0.85 * Math.min(1, value / displayMax);
  };

  // 可视行窗口（±BUFFER），行内 25 个格子照常渲染（仅 7D 星期模式）。
  const firstRow = Math.max(0, Math.floor(scrollTop / rowH) - BUFFER_ROWS);
  const lastRow = Math.min(rowCount, Math.ceil((scrollTop + FRAME_HEIGHT) / rowH) + BUFFER_ROWS);
  const visibleRows = aggregated ? [] : (data?.rows.slice(firstRow, lastRow) ?? []);

  return (
    <ChartCard
      title="时段热力图"
      subtitle={
        range === "7d"
          ? `7D · 按${heatmapMetricLabel(effectiveMetric)}；每格${isMoney ? "金额（元）" : "词元数"}，颜色越深越高`
          : `${range.toUpperCase()} · 按${heatmapMetricLabel(effectiveMetric)}；每格为该${range === "365d" ? "月" : "周"}同一小时的合计，颜色越深越高`
      }
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
      emptyText={
        !query.isPending && !query.isError && (data?.max ?? 0) === 0
          ? "所选区间还没有调用记录，换一个区间看看"
          : null
      }
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
          {aggregated ? (
            // 聚合模式：行数 ≤13，整列 flex 渲染、行高自适应铺满定框，零滚动。
            <div
              className="overflow-hidden pr-1"
              style={{ height: FRAME_HEIGHT }}
              role="img"
              aria-label={`时段热力图：${range === "365d" ? "按月" : "按周"}聚合，${aggRowCount} 行 × 24 列`}
            >
              <div className="flex flex-col" style={{ gap: AGG_ROW_GAP, height: FRAME_HEIGHT }}>
                {aggregated.map((row) => (
                  <div
                    key={row.key}
                    className="grid min-h-0 flex-1 items-center gap-x-1"
                    style={{ gridTemplateColumns: GRID_TEMPLATE }}
                  >
                    <span className="truncate text-2xs text-faint" title={row.coverage}>
                      {row.label}
                    </span>
                    {row.values.map((value, hour) => {
                      const column = data.columns[hour];
                      return (
                        <span
                          key={`${row.key}-${column?.key ?? hour}`}
                          title={aggCellTitle(row, column?.label ?? "", value)}
                          className={
                            value > 0 ? "block rounded-[2px] bg-primary" : "block rounded-[2px] bg-surface-2"
                          }
                          style={{
                            height: aggCellH,
                            ...(value > 0 ? { opacity: cellOpacity(value) } : {}),
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div
              ref={frameRef}
              onScroll={onScroll}
              className="overflow-y-auto pr-1"
              style={{ height: FRAME_HEIGHT }}
              role="img"
              aria-label={`时段热力图：星期 × 小时，${rowCount} 行 × 24 列`}
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
          )}
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
              <span className="ml-2">峰值 {formatValue(displayMax)}</span>
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
