import type { LedgerEntry, LedgerKind } from "./types";

/** 账本类型顺序 = 界面筛选顺序；kinds 与后端 balances 的 kind 词表一致。 */
export const LEDGER_KINDS: readonly LedgerKind[] = ["topup", "charge", "refund", "adjust"];

export const KIND_LABEL: Record<LedgerKind, string> = {
  topup: "充值",
  charge: "消费",
  refund: "退款",
  adjust: "调整",
};

export const KIND_TONE: Record<LedgerKind, "success" | "info" | "warning" | "neutral"> = {
  topup: "success",
  charge: "info",
  refund: "warning",
  adjust: "neutral",
};

/** 后端只接受 25/50/100/200 四档 page_size（deps.page_params）。 */
export const LEDGER_PAGE_SIZE = 200;

/** 累计消费 = 所有 charge 的负 delta 绝对值；其余正负变动都算“入账”。 */
export function summarizeLedger(entries: readonly LedgerEntry[]): {
  consumedMicro: number;
  toppedMicro: number;
} {
  let consumedMicro = 0;
  let toppedMicro = 0;
  for (const entry of entries) {
    if (entry.kind === "charge") consumedMicro += Math.abs(entry.delta_micro);
    else toppedMicro += entry.delta_micro;
  }
  return { consumedMicro, toppedMicro };
}
