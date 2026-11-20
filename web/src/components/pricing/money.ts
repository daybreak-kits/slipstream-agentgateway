/**
 * 价目字段的换算（W5-D2）：展示函数统一在 lib/format（fmtPriceAmount / fmtPricePerM /
 * fmtUnitPriceMicro），本文件只保留「十进制字符串 ↔ 整数 micro」的转换与单位文案。
 */

/** 单价单位：进价/派生售价/缓存价都按每 1M 词元计（item=request 的按次价除外）。 */
export const UNIT_HINT = "元 / 1M 词元";

/**
 * 进价/售价的十进制字符串 → 整数微单位（1e-6 元），与后端账本的 micro 口径对齐；
 * 空串/非法值回 null，展示层用 lib/format 的金额函数渲染成「—」。
 */
export function priceMicro(text: string | null | undefined): number | null {
  if (text === null || text === undefined || String(text).trim() === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed * 1_000_000) : null;
}

/**
 * 派生售价 = 成本 × 倍率，整数微单位（与后端 pricing.spend_micro 同口径）。
 * 成本为负、倍率 ≤ 0 或输入非法时回 null（渲染「—」，不硬凑 0）。
 */
export function deriveSpendMicro(
  cost: string | null | undefined,
  markup: string | null | undefined,
): number | null {
  if (cost === null || cost === undefined || String(cost).trim() === "") return null;
  if (markup === null || markup === undefined || String(markup).trim() === "") return null;
  const costNum = Number(cost);
  const markupNum = Number(markup);
  if (!Number.isFinite(costNum) || costNum < 0) return null;
  if (!Number.isFinite(markupNum) || markupNum <= 0) return null;
  return Math.round(costNum * markupNum * 1_000_000);
}
