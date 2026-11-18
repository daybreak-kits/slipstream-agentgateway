/** 价目金额展示与换算（DESIGN-AUDIT 三期规范 §5：金额 6 位小数、未配置回「—」）。 */
import { fmtMoney6 } from "@/lib/format";

/** 单价单位：进价/派生售价/缓存价都按每 1M 词元计（item=request 的按次价除外）。 */
export const UNIT_HINT = "元 / 1M 词元";

/**
 * 进价/售价的十进制字符串 → 整数微单位（1e-6 元），与后端账本的 micro 口径对齐；
 * 空串/非法值回 null，展示层用 fmtMoney6 渲染成「—」。
 */
export function priceMicro(text: string | null | undefined): number | null {
  if (text === null || text === undefined || String(text).trim() === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed * 1_000_000) : null;
}

/** 十进制字符串金额按 6 位小数展示（与账单明细同一 fmtMoney6 口径）；未配置回「—」。 */
export function fmtPrice(text: string | null | undefined, currency = "CNY"): string {
  return fmtMoney6(priceMicro(text), currency);
}

/**
 * 派生售价 = 成本 × 倍率，整数微单位（与后端 pricing.spend_micro 同口径）。
 * 成本为负、倍率 ≤ 0 或输入非法时回 null（渲染「—」，不硬凑 0）。
 */
export function deriveSpendMicro(
  cost: string | null | undefined,
  markup: string | null | undefined,
): number | null {
  const costNum = Number(cost);
  const markupNum = Number(markup);
  if (!Number.isFinite(costNum) || costNum < 0) return null;
  if (!Number.isFinite(markupNum) || markupNum <= 0) return null;
  return Math.round(costNum * markupNum * 1_000_000);
}
