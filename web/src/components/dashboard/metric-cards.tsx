import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/stat-card";
import { fmtCount, fmtFixed, fmtInt, fmtPct, fmtSeconds } from "@/lib/format";
import { METRIC_ICONS } from "@/lib/metric-icons";
import { usePermissions } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { fmtMoney } from "./chart-format";
import type { LatencyReport, TimeseriesReport } from "./report-types";

interface DashboardKpisProps {
  data: TimeseriesReport | undefined;
  latency: LatencyReport | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * 看板六卡（F1 定案，本文件是 check-ui-foundation 门禁钉住的「看板指标条」文件）：
 * 请求量 / 词元 / 费用 / 成本·毛利率 / P50 延迟 / 速度。
 * 数据源 = 趋势接口的 totals（含 error_count/active_minutes 与缓存词元顶层字段）+ 延迟分位接口；
 * 不走 overview 的 range 枚举——overview 只吃 from_ms/to_ms，预设区间会让前端自算时区边界。
 * 词元口径（GLOSSARY §5）：入 = input − cache、缓 = cache_read + cache_write、总 = 入 + 缓 + 出；
 * 缓存字段待后端 H 合入前为 undefined，按 0 降级（入=input、缓=无缓存），不报错。
 */
export function DashboardKpis({ data, latency, loading, error, onRetry }: DashboardKpisProps) {
  const { can } = usePermissions();
  const showCost = can("billing:cost");
  const showSpend = can("billing:spend");

  if (error) {
    return (
      <div className="space-y-2">
        <Alert variant="destructive">
          <AlertDescription>{error instanceof Error ? error.message : "指标加载失败，请稍后重试"}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }

  const totals = data?.totals;
  const currency = data?.currency;
  const requests = totals?.requests ?? 0;
  const errorCount = totals?.error_count ?? 0;
  const cacheTokens = (totals?.cache_read_tokens ?? 0) + (totals?.cache_write_tokens ?? 0);
  const inputTokens = Math.max(0, (totals?.input_tokens ?? 0) - cacheTokens);
  const outputTokens = totals?.output_tokens ?? 0;
  const totalTokens = totals?.tokens ?? inputTokens + cacheTokens + outputTokens;
  const activeMinutes = totals?.active_minutes ?? 0;

  const charge = totals?.charge_micro;
  const cost = totals?.cost_micro;
  const marginRate =
    showCost && charge !== undefined && cost !== undefined && charge > 0
      ? (charge - cost) / charge
      : null;
  const avgPerMillion =
    charge !== undefined && totalTokens > 0 ? (charge / totalTokens) * 1_000_000 : null;
  const p50 = latency?.total.p50_ms ?? null;
  const p95 = latency?.total.p95_ms ?? null;
  const rpm = activeMinutes > 0 ? requests / activeMinutes : null;
  const tpm = activeMinutes > 0 ? totalTokens / activeMinutes : null;

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3",
        // 指标条在 xl 起一行铺满：任意断点 min-[1440px] 会被 Tailwind 排在 lg 之后覆盖掉，
        // 六卡分支同时给 xl(1280) 与 1440 两档，行为一致。
        showCost && showSpend
          ? "lg:grid-cols-3 xl:grid-cols-6 min-[1440px]:grid-cols-6"
          : showCost || showSpend
            ? "lg:grid-cols-3 xl:grid-cols-5"
            : "lg:grid-cols-3 xl:grid-cols-4",
      )}
    >
      <MetricCard
        label="请求量"
        value={loading ? undefined : fmtCount(requests)}
        hint={`错误 ${fmtCount(errorCount)} 次 · 错误率 ${requests > 0 ? fmtPct(errorCount / requests) : "—"}`}
        icon={METRIC_ICONS.requests.icon}
        tone={METRIC_ICONS.requests.tone}
        loading={loading}
      />
      <MetricCard
        label="词元"
        value={loading ? undefined : fmtCount(totalTokens)}
        hint={`入 ${fmtCount(inputTokens)}/出 ${fmtCount(outputTokens)}/缓 ${cacheTokens > 0 ? fmtCount(cacheTokens) : "无缓存"}`}
        icon={METRIC_ICONS.tokens.icon}
        tone={METRIC_ICONS.tokens.tone}
        loading={loading}
      />
      {showSpend && (
        <MetricCard
          label="费用"
          value={loading || charge === undefined ? undefined : fmtMoney(charge, currency)}
          hint={avgPerMillion === null ? "平均 — 元/百万词元" : `平均 ${fmtFixed(avgPerMillion)} 元/百万词元`}
          icon={METRIC_ICONS.charge.icon}
          tone={METRIC_ICONS.charge.tone}
          loading={loading}
        />
      )}
      {showCost && (
        <MetricCard
          label="成本 · 毛利率"
          value={loading || cost === undefined ? undefined : fmtMoney(cost, currency)}
          hint={marginRate === null ? "毛利率 —（缺花费账或暂无金额）" : `毛利率 ${fmtPct(marginRate)}`}
          icon={METRIC_ICONS.cost.icon}
          tone={METRIC_ICONS.cost.tone}
          loading={loading}
        />
      )}
      <MetricCard
        label="P50 延迟"
        value={loading ? undefined : fmtSeconds(p50)}
        hint={
          p50 === null && !loading
            ? `样本不足（${fmtInt(latency?.paired_samples ?? 0)}/${latency?.min_samples ?? 5}）`
            : `P95 延迟 ${fmtSeconds(p95)}`
        }
        icon={METRIC_ICONS.latency.icon}
        tone={METRIC_ICONS.latency.tone}
        loading={loading}
      />
      <MetricCard
        label="速度"
        value={loading || rpm === null ? undefined : fmtFixed(rpm)}
        hint={`活跃 ${fmtInt(activeMinutes)} 分钟 · TPM ${tpm === null ? "—" : fmtCount(tpm)}`}
        icon={METRIC_ICONS.cache.icon}
        tone={METRIC_ICONS.cache.tone}
        loading={loading}
      />
    </div>
  );
}
