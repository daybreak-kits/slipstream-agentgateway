import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/stat-card";
import { cacheHitFraction } from "@/components/logs/format";
import { fmtFixed, fmtInt, fmtMoney, fmtPct, fmtRpm, fmtSeconds } from "@/lib/format";
import { METRIC_ICONS } from "@/lib/metric-icons";
import { usePermissions } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import type { LatencyReport, TimeseriesReport } from "./report-types";

interface DashboardKpisProps {
  data: TimeseriesReport | undefined;
  latency: LatencyReport | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * 看板八卡（DESIGN-AUDIT 四期 §14「只拆不加」，本文件是 check-ui-foundation 门禁钉住的
 * 「看板指标条」文件）：请求量 / 词元 / 缓存 / 费用 / 成本·毛利率 / P50 延迟 / RPM / TPM，
 * 大屏每行 6 卡铺开（6+2），响应式降档 6→4→3→2（xl 起 6 列）。
 * 数据源 = 趋势接口的 totals（含 error_count/active_minutes/peak_rpm/peak_tpm 与缓存词元）
 * + 延迟分位接口；不走 overview 的 range 枚举——overview 只吃 from_ms/to_ms，预设区间会让
 * 前端自算时区边界。
 * 词元口径（GLOSSARY §5）：入 = input − cache、缓 = cache_read + cache_write、总 = 入 + 缓 + 出；
 * 缓存字段待后端 H 合入前为 undefined，按 0 降级（缓存卡显示「无缓存」），不报错。
 * 速率口径（GLOSSARY §5）：RPM = 请求 ÷ 活跃分钟、TPM = 词元 ÷ 活跃分钟（分母是活跃分钟，
 * 不是时间窗长度）；「最高峰」= totals.peak_rpm/peak_tpm，字段缺位（旧后端/mock 未合入）降级「—」。
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
  // 缓存命中率 = 缓 ÷（入 + 缓）＝ 缓 ÷ 折算 input（GLOSSARY §5，复用 logs 口径公式）
  const cacheFraction = cacheHitFraction(totals?.input_tokens ?? 0, totals?.cache_read_tokens ?? 0, totals?.cache_write_tokens ?? 0);

  const charge = totals?.charge_micro;
  const cost = totals?.cost_micro;
  const marginRate =
    showCost && charge !== undefined && cost !== undefined && charge > 0
      ? (charge - cost) / charge
      : null;
  // 均价（元/百万词元）= charge_micro ÷ totalTokens：charge 是 micro（每词元 ×1e-6 元），
  // 与「每百万词元」的 ×1e6 恰好相消，不能再乘 1e6（W4-B 前先算出的是百万倍均价）。
  const avgPerMillion = charge !== undefined && totalTokens > 0 ? charge / totalTokens : null;
  const p50 = latency?.total.p50_ms ?? null;
  const p95 = latency?.total.p95_ms ?? null;
  const rpm = activeMinutes > 0 ? requests / activeMinutes : null;
  const tpm = activeMinutes > 0 ? totalTokens / activeMinutes : null;
  const peakRpm = totals?.peak_rpm;
  const peakTpm = totals?.peak_tpm;

  return (
    <div
      className={cn(
        // 八卡按每行 6 铺开（DESIGN-AUDIT 四期 §8/§14）：xl 起 6 列（6+2 两行），
        // 向下 4→3→2 逐档降列；权限裁剪只影响卡片数量，不换栅格模板。
        "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
      )}
    >
      <MetricCard
        label="请求量"
        value={loading ? undefined : fmtInt(requests)}
        hint={`错误 ${fmtInt(errorCount)} 次 · 错误率 ${requests > 0 ? fmtPct(errorCount / requests) : "—"}`}
        icon={METRIC_ICONS.requests.icon}
        tone={METRIC_ICONS.requests.tone}
        loading={loading}
      />
      <MetricCard
        label="词元"
        value={loading ? undefined : fmtInt(totalTokens)}
        hint={`入 ${fmtInt(inputTokens)}/出 ${fmtInt(outputTokens)}`}
        icon={METRIC_ICONS.tokens.icon}
        tone={METRIC_ICONS.tokens.tone}
        loading={loading}
      />
      <MetricCard
        label="缓存"
        value={loading ? undefined : cacheTokens > 0 ? fmtInt(cacheTokens) : "无缓存"}
        hint={loading ? undefined : cacheFraction === null ? "无缓存" : `命中率 ${fmtPct(cacheFraction)}`}
        icon={METRIC_ICONS.cache.icon}
        tone={METRIC_ICONS.cache.tone}
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
        label="RPM 请求/分"
        value={loading ? undefined : fmtRpm(rpm)}
        hint={`活跃 ${fmtInt(activeMinutes)} 分钟 · 最高峰 ${fmtRpm(peakRpm)}`}
        icon={METRIC_ICONS.requests.icon}
        tone={METRIC_ICONS.requests.tone}
        loading={loading}
      />
      <MetricCard
        label="TPM 词元/分"
        value={loading ? undefined : fmtInt(tpm)}
        hint={`最高峰 ${fmtInt(peakTpm)} 词元/分`}
        icon={METRIC_ICONS.tokens.icon}
        tone={METRIC_ICONS.tokens.tone}
        loading={loading}
      />
    </div>
  );
}
