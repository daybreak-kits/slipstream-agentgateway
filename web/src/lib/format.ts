const intFmt = new Intl.NumberFormat("zh-CN");
// RPM 固定两位小数，整数部分仍带千分位（2572.01 → 2,572.01），与计数列对齐。
const rpmFmt = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 整数千分位（DESIGN-AUDIT §5 / W5-D2）：计数、词元、TPM、尝试次数、输入/输出词元一律
 * 「千分位整数」—— 先四舍五入到整数再编号，避免 565,920.4 这类小数漏出。
 * 缺值/非有限值回「—」。
 */
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return intFmt.format(Math.round(n));
}

/**
 * 图表轴紧凑计数（DESIGN-AUDIT §5：只有坐标轴可以用 K/M/B）：K/M/B 自适应但**不留小数**
 * （565920 → 566K，1.5M → 2M）；千位以内退千分位整数，999999 进位后升到 M。
 * 卡片、表格、tooltip 等用户直接读数的位置一律用 fmtInt。
 */
export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) {
    const billions = Math.round(n / 1_000_000_000);
    if (billions !== 0) return billions + "B";
  }
  if (abs >= 1_000_000) {
    const millions = Math.round(n / 1_000_000);
    if (millions !== 0) return millions + "M";
  }
  if (abs >= 1_000) {
    const thousands = Math.round(n / 1_000);
    // 999,500 一路进位到 1000K 时直接升 M，避免出现「1000K」。
    if (thousands >= 1000) return Math.round(thousands / 1000) + "M";
    return thousands + "K";
  }
  return intFmt.format(Math.round(n));
}

function pad2(value: number): string {
  return value < 10 ? "0" + value : String(value);
}

/**
 * 全站统一计时（DESIGN-AUDIT §5）：毫秒入，默认秒出、固定 2 位小数。
 * null / undefined / NaN / 负数统一显示破折号占位。
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "-";
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
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "-";
  const centiseconds = Math.round(ms / 10);
  if (centiseconds < 6000) return (centiseconds / 100).toFixed(2) + "s";
  const seconds = Math.floor(centiseconds / 100);
  if (seconds < 3600) return Math.floor(seconds / 60) + "m" + pad2(seconds % 60) + "s";
  if (seconds < 86400) {
    return Math.floor(seconds / 3600) + "h" + pad2(Math.floor((seconds % 3600) / 60)) + "m";
  }
  return Math.floor(seconds / 86400) + "d" + pad2(Math.floor((seconds % 86400) / 3600)) + "h";
}

/** 通用定点小数（均价、成本倍率等派生数）；非有限值回「—」。 */
export function fmtFixed(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

/**
 * RPM（DESIGN-AUDIT §5 / W5-D2）：固定 2 位小数；值域缺失回「—」。
 * TPM 属于词元计数，走 fmtInt，不要用本函数。
 */
export function fmtRpm(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return rpmFmt.format(n);
}

/**
 * 百分比（DESIGN-AUDIT §5 / W5-D2）：入参是 0–1 的比例，固定 1 位小数。
 * 例如 0.4148 → 41.5%；缺值/非有限值回「—」。
 */
export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return (n * 100).toFixed(1) + "%";
}

/**
 * 已是百分数的数值（如日志 cache_ratio 0–100、trend.delta 12.5）：固定 1 位小数。
 * 0–1 比例请用 fmtPct，避免重复乘 100。
 */
export function fmtPctPoint(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toFixed(1) + "%";
}

/** 吞吐（词元/s）：≥100 取整并千分位，<100 保留 1 位小数；无输出回「—」。 */
export function fmtThroughput(tps: number | null | undefined): string {
  if (tps === null || tps === undefined || !Number.isFinite(tps) || tps <= 0) return "-";
  return tps >= 100 ? fmtInt(Math.round(tps)) : tps.toFixed(1);
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "-";
  return iso.replace("T", " ").slice(0, 19);
}

/** 毫秒时间戳按本地时区展示到秒；0/空回「—」。 */
export function fmtMs(ms: number | null | undefined): string {
  if (!ms) return "-";
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

function moneyText(micro: number | null | undefined, currency: string | null | undefined, digits: number): string {
  if (micro === null || micro === undefined || !Number.isFinite(micro)) return "-";
  const value = micro / 1_000_000;
  const sign = value < 0 ? "-" : "";
  return sign + currencySymbol(currency) + Math.abs(value).toFixed(digits);
}

/**
 * 金额（DESIGN-AUDIT §5 / W5-D2）：表格、汇总、KPI 一律 2 位小数，负数符号在货币符号之前；
 * 缺值回「—」，不把未配置渲染成 0。
 */
export function fmtMoney(micro: number | null | undefined, currency?: string | null): string {
  return moneyText(micro, currency, 2);
}

/**
 * 单请求金额/均值（DESIGN-AUDIT §5 / W5-D2）：单次请求的金额量级很小，固定 4 位小数，
 * 避免 2 位小数把每一次请求都显示成 ¥0.00；缺值回「—」。
 */
export function fmtMoneyAvg(micro: number | null | undefined, currency?: string | null): string {
  return moneyText(micro, currency, 4);
}

/** 人民币 2 位小数（汇总/余额口径）。 */
export function fmtCny(micro: number): string {
  return fmtMoney(micro, "CNY");
}

/** 金额的紧凑刻度（y 轴）：1.2K → 1K / 3.4M → 3M 元（轴标签只留整数）。 */
export function compactMoney(micro: number, currency?: string | null): string {
  if (!Number.isFinite(micro)) return "-";
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
 * 单价金额（DESIGN-AUDIT §5 / W5-D2）：2 位小数；绝对值 < 0.01 时升到 4 位，
 * 避免 ¥0.00 掩盖真实单价（含 0 = 明示零价）；未配置回「—」。
 * 入参可以是十进制字符串（价目表）或数字（已从 micro 折算的元）。
 */
export function fmtPriceAmount(value: string | number | null | undefined, currency?: string | null): string {
  const text = value === null || value === undefined ? "" : String(value).trim();
  if (text === "") return "-";
  const symbol = currencySymbol(currency);
  const n = Number(text);
  if (!Number.isFinite(n)) return symbol + text;
  return symbol + n.toFixed(Math.abs(n) < 0.01 ? 4 : 2);
}

/**
 * 模型行进价文本（W4-C）：入参是十进制字符串（元 / 1M 词元），
 * 统一 2 位小数（¥2.00/M）；值 < 0.01 时升到 4 位；未配置回「—」。
 */
export function fmtPricePerM(value: string | null | undefined): string {
  const amount = fmtPriceAmount(value, "CNY");
  return amount === "-" ? amount : amount + "/M";
}

/** 微单位单价（元 / 1M 词元，micro）按 2 位小数展示；不足 0.01 升 4 位；缺值回「—」。 */
export function fmtUnitPriceMicro(micro: number | null | undefined, currency?: string | null): string {
  if (micro === null || micro === undefined || !Number.isFinite(micro)) return "-";
  return fmtPriceAmount(micro / 1_000_000, currency);
}

/** 成本倍率文本（W4-C）：2 位小数（×1.20）；值 < 0.01 升 4 位；未配置回「—」。 */
export function fmtMarkup(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (text === "") return "-";
  const n = Number(text);
  if (!Number.isFinite(n)) return "×" + text;
  return "×" + n.toFixed(n < 0.01 ? 4 : 2);
}

/** 附件大小（B/KB/MB）：KB/MB 保留 1 位小数，和表格里的等宽数字对齐。 */
export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
