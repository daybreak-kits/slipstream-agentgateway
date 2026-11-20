const intFmt = new Intl.NumberFormat("zh-CN");

/** 整数/千分位展示（表格明细、词元计数等）。 */
export function fmtInt(n: number): string {
  return intFmt.format(n);
}

/** 兼容旧名：整数千分位。 */
export function formatCount(n: number): string {
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

function pad2(value: number): string {
  return value < 10 ? "0" + value : String(value);
}

/**
 * 全站统一计时（DESIGN-AUDIT §5）：毫秒入，默认秒出、固定 2 位小数。
 * null / undefined / NaN / 负数统一显示破折号占位。
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  // 先取 0.01s 整数再格式化，避免 75.765 一类浮点边界被舍成 75.76。
  return (Math.round(ms / 10) / 100).toFixed(2) + "s";
}

/** 兼作延迟口径（§5）：毫秒入、秒出，固定 2 位小数。 */
export function fmtSeconds(ms: number | null | undefined): string {
  return formatDuration(ms);
}

/**
 * 自适应计时格式：不足 60s 仍用秒（2 位小数），更长时自动转 m/s、h/m、d/h，
 * 例如 75.765s → "1m15s"、1h2m → "1h02m"、2d3h → "2d03h"。
 * 60s 以上内部取整到秒，不再带小数，保证可读性。
 */
export function formatDurationAdaptive(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const centiseconds = Math.round(ms / 10);
  if (centiseconds < 6000) return (centiseconds / 100).toFixed(2) + "s";
  const seconds = Math.floor(centiseconds / 100);
  if (seconds < 3600) return Math.floor(seconds / 60) + "m" + pad2(seconds % 60) + "s";
  if (seconds < 86400) {
    return Math.floor(seconds / 3600) + "h" + pad2(Math.floor((seconds % 3600) / 60)) + "m";
  }
  return Math.floor(seconds / 86400) + "d" + pad2(Math.floor((seconds % 86400) / 3600)) + "h";
}

/** 通用定点小数（均价、RPM/TPM、比例等派生数）；非有限值回「—」。 */
export function fmtFixed(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19);
}

/** 毫秒时间戳按本地时区展示到秒；0/空回「—」。 */
export function fmtMs(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return (
    d.getFullYear() +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate()) +
    " " +
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes()) +
    ":" +
    pad2(d.getSeconds())
  );
}

/** ISO 字符串（旧 mock / 部分只读字段）折成毫秒；解析失败给 undefined。 */
export function isoMs(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  JPY: "JP¥",
  HKD: "HK$",
};

/** 货币符号：CNY/空串按主币种人民币；未知币种回大写代码 + 空格（GLOSSARY §5）。 */
export function currencySymbol(currency?: string | null): string {
  const code = (currency ?? "").trim().toUpperCase();
  if (!code || code === "CNY") return "¥";
  return CURRENCY_SYMBOLS[code] ?? code + " ";
}

/** 金额一律整数微单位（micro = 1e-6 币）；金额统一 2 位小数，负数符号在货币符号之前。 */
export function fmtMoney(micro: number | null | undefined, currency?: string | null, digits = 2): string {
  if (micro === null || micro === undefined || !Number.isFinite(micro)) return "—";
  const value = micro / 1_000_000;
  const sign = value < 0 ? "-" : "";
  return sign + currencySymbol(currency) + Math.abs(value).toFixed(digits);
}

/**
 * 单笔金额 6 位小数（DESIGN-AUDIT 三期规范 §5：日志/账单明细用）；
 * micro 缺失（未配置价/无权限）回「—」，负数（毛利为负）符号在货币符号之前。
 */
export function fmtMoney6(micro: number | null | undefined, currency: string): string {
  return fmtMoney(micro, currency, 6);
}

/** 人民币 2 位小数（汇总/余额口径）。 */
export function fmtCny(micro: number): string {
  return fmtMoney(micro, "CNY", 2);
}

/** 人民币 2 位小数（兼容旧名）。 */
export function fmtYuan(micro: number): string {
  return fmtMoney(micro, "CNY", 2);
}

/** 兼容旧调用：无币种信息时按人民币展示。 */
export function fmtMicroYuan(micro: number): string {
  return fmtMoney(micro, "CNY", 2);
}

/** 金额的紧凑刻度（y 轴）：1.2K / 3.4M 元。 */
export function compactMoney(micro: number, currency?: string | null): string {
  if (!Number.isFinite(micro)) return "—";
  return currencySymbol(currency) + fmtCount(Math.round(micro / 1_000));
}

/** 账本变动：正数带 +，负数带 −（真减号，配合 .tnum 对齐）。 */
export function fmtSignedMicro(delta: number): string {
  if (delta === 0) return "¥0.00";
  return (delta > 0 ? "+" : "−") + "¥" + (Math.abs(delta) / 1_000_000).toFixed(2);
}

/** 输入框按「元」收，落库前转 micro；最多 6 位小数（1 micro 精度）。 */
export function parseYuanToMicro(input: string): number | null {
  const text = input.replace(/[,，\s]/g, "").replace(/^¥/, "");
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null;
  const micro = Math.round(Number(text) * 1_000_000);
  if (!Number.isFinite(micro) || micro <= 0) return null;
  return micro;
}

/** 0 元也合法的场景（如初始余额），单独放开下界。 */
export function parseYuanToMicroAllowZero(input: string): number | null {
  const text = input.replace(/[,，\s]/g, "").replace(/^¥/, "");
  if (text === "" || text === "0") return 0;
  return parseYuanToMicro(text);
}

/** 金额输入框回填：micro -> 元（两位小数足够人工编辑）。 */
export function yuanInput(micro: number): string {
  return (micro / 1_000_000).toFixed(2);
}

/**
 * 模型行进价文本（W4-C）：入参是十进制字符串（元 / 1M 词元），统一 2 位小数（¥2.00/M）；
 * 值 < 0.01 时升到 4 位（避免 ¥0.00 掩盖真实单价，含 0 = 明示零价）；未配置回「—」。
 * 解析失败的原样回显（编辑弹窗会另行校验）。
 */
export function fmtPricePerM(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (text === "") return "—";
  const n = Number(text);
  if (!Number.isFinite(n)) return "¥" + text + "/M";
  return "¥" + n.toFixed(n < 0.01 ? 4 : 2) + "/M";
}

/** 成本倍率文本（W4-C）：2 位小数（×1.20）；值 < 0.01 升 4 位；未配置回「—」。 */
export function fmtMarkup(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (text === "") return "—";
  const n = Number(text);
  if (!Number.isFinite(n)) return "×" + text;
  return "×" + n.toFixed(n < 0.01 ? 4 : 2);
}
