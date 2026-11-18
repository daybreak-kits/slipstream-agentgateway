import { fmtCount } from "@/lib/format";

/**
 * 图表专用金额/时间轴格式化。计数口径已上收 lib/format（fmtCount：K/M/B 2dp），
 * 金额与币种符号是报表域知识，留在 chart-format（billing 面板也在复用）。
 */

/** 报告币种符号：报表货币来自接口（默认 CNY），界面上不写死人民币符号。 */
const CURRENCY_SYMBOL: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", JPY: "JP¥", HKD: "HK$" };

export function currencySymbol(code: string | undefined | null): string {
  if (!code) return "";
  const key = code.toUpperCase();
  return CURRENCY_SYMBOL[key] ?? key + " ";
}

/** 金额一律整数微单位（1e-6 元）；图表按元保留 2 位小数，并跟随接口币种。 */
export function fmtMoney(micro: number | null | undefined, currency?: string | null, digits = 2): string {
  if (micro === null || micro === undefined || !Number.isFinite(micro)) return "—";
  return currencySymbol(currency) + (micro / 1_000_000).toFixed(digits);
}

/** 兼容旧调用（billing/my-spend-panel）：无币种信息时按人民币展示。 */
export function fmtMicroYuan(micro: number): string {
  return fmtMoney(micro, "CNY");
}

/** 金额的紧凑刻度（y 轴）：1.2K / 3.4M 元。 */
export function compactMoney(micro: number, currency?: string | null): string {
  if (!Number.isFinite(micro)) return "—";
  return currencySymbol(currency) + fmtCount(Math.round(micro / 1_000));
}

/** 时间桶标签：接口已按报表时区切桶并给出 label，这里只裁掉年份/秒。 */
export function shortBucketLabel(label: string, bucket: "hour" | "day"): string {
  if (!label) return "";
  if (label.includes(" ")) {
    const [, time] = label.split(" ");
    return (time ?? "").slice(0, 5);
  }
  if (bucket === "day") return label.length >= 10 ? label.slice(5) : label;
  return label;
}
