import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconBadge } from "@/components/ui/icon-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtPctPoint } from "@/lib/format";
import type { MetricTone } from "@/lib/metric-icons";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: ReactNode | undefined;
  /** 副文案：11px 单行截断，超出部分靠 title 兜底 */
  hint?: string;
  /** 图标语义统一取自 lib/metric-icons.ts 的 METRIC_ICONS */
  icon?: LucideIcon;
  tone?: MetricTone;
  /** 环比趋势：↑/↓ + 百分比（正数 success、负数 danger） */
  trend?: { delta: number; label?: string };
  loading?: boolean;
  /** 请求失败信息；非空时显示错误+重试，骨架不再永挂 */
  error?: string | null;
  onRetry?: () => void;
  /** 紧凑档：内边距 12，用于明细页的密集指标条 */
  dense?: boolean;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}

/**
 * 全站唯一指标卡（ticket 22）：彩色图标方块 + 19px 数值 + 12px 标签 + 11px 说明。
 * 图标/底色只认 tone，页面不再自己拼颜色；旧 StatCard 是它的兼容薄壳。
 */
export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  trend,
  loading = false,
  error,
  onRetry,
  dense = false,
  onClick,
  active = false,
  className,
}: MetricCardProps) {
  const Icon = icon;
  const clickable = typeof onClick === "function";

  return (
    <Card
      className={cn(
        "min-w-0",
        clickable && "cursor-pointer transition-colors hover:border-border-strong",
        active && "border-primary/40 ring-1 ring-primary/30",
        className,
      )}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <CardContent className={cn("flex items-start gap-3", dense ? "p-3" : "p-4")}>
        {Icon && (
          // 图标方块 = ui/icon-badge 的轻盈分类 tint（--badge-*-bg/fg）；
          // 形状由 icon 决定、颜色由分类 tone 决定，配合右侧标签文字双编码。
          <IconBadge icon={Icon} tone={tone} size="md" className="rounded-control" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="truncate text-xs text-muted-foreground">{label}</div>
          {error ? (
            <div className="flex items-center gap-2">
              <span className="text-2sm text-danger-text">加载失败</span>
              {onRetry && (
                <Button
                  variant="link"
                  onClick={onRetry}
                  className="h-auto p-0 text-2xs underline underline-offset-2"
                >
                  重试
                </Button>
              )}
            </div>
          ) : loading || value === undefined ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            <div className="flex min-w-0 items-baseline gap-2">
              <div className="tnum truncate text-metric font-semibold leading-tight text-title">
                {value}
              </div>
              {trend && <TrendChip trend={trend} />}
            </div>
          )}
          {hint !== undefined && (
            <div className="line-clamp-2 text-2xs leading-snug text-faint" title={hint}>
              {hint}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TrendChip({ trend }: { trend: NonNullable<MetricCardProps["trend"]> }) {
  const up = trend.delta >= 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 text-2xs font-medium",
        up ? "text-success-text" : "text-danger-text",
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      {fmtPctPoint(Math.abs(trend.delta))}
      <span className="sr-only">{up ? "上升" : "下降"}</span>
      {trend.label !== undefined && <span className="text-faint">· {trend.label}</span>}
    </span>
  );
}

export interface StatCardProps {
  label: string;
  value: ReactNode | undefined;
  hint?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 旧页面语义；新代码用 MetricCard 的 tone + METRIC_ICONS */
  tone?: "default" | "primary" | "warning";
}

/**
 * @deprecated 兼容旧页面的纯文本卡（users / policies 还在用）。
 * 新代码一律 <MetricCard icon={METRIC_ICONS.x.icon} tone={METRIC_ICONS.x.tone} />。
 * 旧 tone 映射到分类色板：default→neutral、primary→brand、warning→cost。
 */
const LEGACY_TONE: Record<NonNullable<StatCardProps["tone"]>, MetricTone> = {
  default: "neutral",
  primary: "brand",
  warning: "cost",
};

export function StatCard({ tone = "default", ...rest }: StatCardProps) {
  return <MetricCard {...rest} tone={LEGACY_TONE[tone]} />;
}
