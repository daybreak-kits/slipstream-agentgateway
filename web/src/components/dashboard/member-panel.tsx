import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { fmtInt, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

import { fmtMoney } from "./chart-format";
import { seriesVar } from "./chart-theme";
import type { TimeseriesMember, TrendMetric } from "./report-types";

interface MemberPanelProps {
  members: TimeseriesMember[];
  metric: TrendMetric;
  currency: string | undefined;
  hidden: string[];
  /** 费用双系列模式下图上没有成员序列，行不可点（不提供隐藏）。 */
  interactive?: boolean;
  onToggle: (id: string) => void;
  onShowAll: () => void;
}

function memberValue(member: TimeseriesMember, metric: TrendMetric, currency: string | undefined): string {
  if (metric === "money") {
    // 费用口径：优先显示花费（charge），缺花费账再退成本；占比由后端首序列（成本）驱动。
    const value = member.totals?.charge_micro ?? member.charge_micro ?? member.totals?.cost_micro ?? member.cost_micro;
    return value === undefined ? "—" : fmtMoney(value, currency);
  }
  return fmtInt(member.total);
}

/**
 * 右侧成员列（F1 精简后只显 名称 + 占比% + 当前指标数，不再每成员铺花费/成本全套）：
 * 颜色按成员在完整列表中的位置分配，隐藏成员只从图上移除，不重排颜色（R5）。
 */
export function MemberPanel({
  members,
  metric,
  currency,
  hidden,
  interactive = true,
  onToggle,
  onShowAll,
}: MemberPanelProps) {
  // 成员序号先建 Map，避免每行 findIndex 的 O(n²)（F1 性能修）。
  const indexById = useMemo(() => new Map(members.map((member, index) => [member.id, index])), [members]);
  const visible = members.filter((member) => member.total > 0);
  if (visible.length === 0) {
    return <div className="text-2xs text-faint">所选区间没有成员数据</div>;
  }
  return (
    <div className="chart-frame flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 pb-1">
        <span className="text-2xs font-medium text-muted-foreground">成员（{visible.length}）</span>
        {hidden.length > 0 && (
          <Button variant="link" size="sm" onClick={onShowAll} className="h-auto px-0 text-2xs">
            全部显示
          </Button>
        )}
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {visible.map((member) => {
          const index = indexById.get(member.id) ?? 0;
          const isHidden = hidden.includes(member.id);
          const row = (
            <>
              <span
                aria-hidden="true"
                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: seriesVar(index) }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-2xs text-body">{member.label}</span>
                  <span className="shrink-0 text-2xs tnum text-title">{memberValue(member, metric, currency)}</span>
                </span>
                <span className="block text-2xs tnum text-faint">占比 {fmtPct(member.share)}</span>
              </span>
            </>
          );
          if (!interactive) {
            return (
              <li key={member.id}>
                <div className="flex h-auto w-full items-start justify-start gap-1.5 px-1.5 py-1 text-left whitespace-normal">
                  {row}
                </div>
              </li>
            );
          }
          return (
            <li key={member.id}>
              <Button
                variant="ghost"
                onClick={() => onToggle(member.id)}
                aria-pressed={!isHidden}
                title={isHidden ? "点击显示该成员" : "点击隐藏该成员"}
                className={cn(
                  "h-auto w-full items-start justify-start gap-1.5 px-1.5 py-1 text-left font-normal whitespace-normal transition-opacity",
                  isHidden && "opacity-40",
                )}
              >
                {row}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
