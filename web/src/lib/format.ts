const intFmt = new Intl.NumberFormat("zh-CN");

export function fmtInt(n: number): string {
  return intFmt.format(n);
}

/**
 * 计数紧凑口径（DESIGN-AUDIT 三期规范 §5：卡片主数与图表 tooltip 用）：
 * K/M/B 自适应，2 位小数；千位以内退千分位。表格明细仍用 fmtInt。
 */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(2) + "K";
  return intFmt.format(n);
}

/** 延迟口径（§5）：毫秒入、秒出，固定 2 位小数；空值/非有限值回「—」。 */
export function fmtSeconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return (ms / 1_000).toFixed(2) + "s";
}

/** 通用定点小数（均价、RPM/TPM 等派生数）；非有限值回「—」。 */
export function fmtFixed(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

/** 金额一律整数微单位（micro = 1e-6 币）；展示按元保留 4 位小数，配合 tnum 使用 */
export function fmtCny(micro: number): string {
  return "¥" + (micro / 1_000_000).toFixed(4);
}

export function formatCount(n: number): string {
  return intFmt.format(n);
}

export function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19);
}

/** 货币符号：账本金额的 currency 取 CNY/USD，空串按主币种 CNY 展示（GLOSSARY §5）。 */
export function currencySymbol(currency: string): string {
  if (currency === "USD") return "$";
  if (currency === "CNY" || currency === "") return "¥";
  return currency + " ";
}

/**
 * 单笔金额 6 位小数（DESIGN-AUDIT 三期规范 §5：日志/账单明细用）；
 * micro 缺失（未配置价/无权限）回「—」，负数（毛利为负）符号在货币符号之前。
 */
export function fmtMoney6(micro: number | null | undefined, currency: string): string {
  if (micro === null || micro === undefined) return "—";
  const value = micro / 1_000_000;
  const sign = value < 0 ? "-" : "";
  return sign + currencySymbol(currency) + Math.abs(value).toFixed(6);
}
