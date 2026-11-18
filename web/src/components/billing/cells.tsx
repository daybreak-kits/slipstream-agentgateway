import { fmtCny, fmtInt } from "@/lib/format";

/** 词元列：总量在上，输入/输出拆解在下；取代原输入、输出两列（ticket 17 合并列）。 */
export function TokenCell({ input, output }: { input: number; output: number }) {
  return (
    <div className="space-y-0.5">
      <div className="tnum text-2sm text-title">{fmtInt(input + output)}</div>
      <div className="tnum text-2xs text-faint">
        入 {fmtInt(input)} · 出 {fmtInt(output)}
      </div>
    </div>
  );
}

/**
 * 花费 + 成本合并列：花费在上、成本在下，二者不混加。
 * showCost=false 或后端未返回 cost_micro 时，只渲染花费一行。
 */
export function MoneyStack({
  charge,
  cost,
  currency,
  showCost = false,
  unpriced = 0,
}: {
  charge: number | null | undefined;
  cost?: number | null;
  currency?: string;
  showCost?: boolean;
  unpriced?: number;
}) {
  const suffix = currency && currency !== "CNY" ? " " + currency : "";
  const chargeText = charge === null || charge === undefined ? "—" : fmtCny(charge) + suffix;
  const showCostLine = showCost && cost !== undefined;
  return (
    <div className="space-y-0.5">
      <div className="tnum text-2sm text-title">{chargeText}</div>
      {showCostLine && (
        <div className="tnum text-2xs text-faint">
          成本 {cost === null ? "—" : fmtCny(cost) + suffix}
        </div>
      )}
      {unpriced > 0 && <div className="text-2xs text-warning-text">待补价 {fmtInt(unpriced)}</div>}
    </div>
  );
}
