import { fmtInt, fmtSeconds } from "@/lib/format";

import { seriesVar } from "./chart-theme";
import { ChartCard } from "./chart-card";
import type { LatencyBlockOut, LatencyReportOut } from "@/generated/contract";
import { timeWindowLabel, type TimeWindow } from "@/components/time-range-picker";

interface LatencyCardsProps {
  window: TimeWindow;
  data: LatencyReportOut | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

const QUANTILES = [
  { key: "p50_ms", label: "P50" },
  { key: "p75_ms", label: "P75" },
  { key: "p95_ms", label: "P95" },
  { key: "p99_ms", label: "P99" },
] as const;

type QuantileKey = (typeof QUANTILES)[number]["key"];

/** 行网格模板（表头与两行共用同一模板，列天然对齐）。 */
const GRID_COLUMNS = { gridTemplateColumns: "minmax(110px, 170px) repeat(4, minmax(0, 1fr))" };

function quantileOf(block: LatencyBlockOut | undefined, key: QuantileKey): number | null {
  if (!block) return null;
  return block[key];
}

/**
 * 延迟分位卡（F1 定案，参考旧系统横条图样式）：两行（首字延迟 TTFT / 总体耗时）×
 * 四列（P50/P75/P95/P99）。每格 = 数值（秒，2 位小数）+ 横条（宽 = 值 / 行内最大，色板色）；
 * 配对样本 < min_samples 时后端给 null，界面显示「样本不足」。
 */
export function LatencyCards({ window, data, loading, error, onRetry }: LatencyCardsProps) {
  const rows: Array<{ key: string; label: string; hint: string; block: LatencyBlockOut | undefined; color: string }> = [
    { key: "ttft", label: "首字延迟 TTFT", hint: "请求到首个词元", block: data?.ttft, color: seriesVar(0) },
    { key: "total", label: "总体耗时", hint: "请求到响应结束", block: data?.total, color: seriesVar(1) },
  ];

  return (
    <ChartCard
      title="延迟分位"
      subtitle={`${timeWindowLabel(window)} · 成对样本 ${fmtInt(data?.paired_samples ?? 0)} 条；每桶样本 < ${data?.min_samples ?? 5} 条时不出分位`}
      loading={loading}
      error={error}
      onRetry={onRetry}
    >
      <div role="group" aria-label="延迟分位横条图：首字延迟与总体耗时的 P50 / P75 / P95 / P99" className="space-y-3">
        <div className="grid gap-x-5" style={GRID_COLUMNS}>
          <span aria-hidden="true" />
          {QUANTILES.map((quantile) => (
            <span key={quantile.key} className="text-2xs text-faint">
              {quantile.label}
            </span>
          ))}
        </div>
        {rows.map((row) => {
          const values = QUANTILES.map((quantile) => quantileOf(row.block, quantile.key));
          const rowMax = values.reduce<number>((peak, value) => (value !== null && value > peak ? value : peak), 0);
          return (
            <div key={row.key} className="grid gap-x-5" style={GRID_COLUMNS}>
              <div className="min-w-0">
                <span className="block truncate text-2sm text-body">{row.label}</span>
                <span className="block text-2xs text-faint">{row.hint}</span>
              </div>
              {QUANTILES.map((quantile, index) => {
                const value = values[index] ?? null;
                return (
                  <div key={quantile.key} className="min-w-0 space-y-1">
                    {value === null ? (
                      <span
                        className="text-2xs text-faint"
                        title={`样本不足（${row.block?.samples ?? 0}/${data?.min_samples ?? 5}），暂不展示分位`}
                      >
                        样本不足
                      </span>
                    ) : (
                      <span className="tnum text-2sm text-title">{fmtSeconds(value)}</span>
                    )}
                    <div className="h-1.5 rounded-control bg-surface-2">
                      {value !== null && rowMax > 0 && (
                        <div
                          className="h-full rounded-control"
                          style={{
                            width: `${Math.max(2, Math.round((value / rowMax) * 100))}%`,
                            backgroundColor: row.color,
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-2xs text-faint">
        {`分位只统计 ttft > 0 且 duration > 0 的成对样本（共 ${fmtInt(data?.paired_samples ?? 0)} 条），避免把失败/空响应算进延迟`}
      </p>
    </ChartCard>
  );
}
