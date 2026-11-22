/**
 * 密钥测试的纯 UI 逻辑（W8 票04）：行内单把与多选批量共用同一入口
 * POST /admin/upstreams/{id}/keys/test。
 *
 * 页面只根据这里算出的请求体/按钮文案/toast 摘要发起与展示，不再出现
 * 「点一行却测全部」：单把带 key_id，批量带选中 keys，后端按 scope 只探测
 * 指定行并把结果写回对应行（ADR-026 ③ 的逐把探测循环不变）。
 */

import type { UpstreamKeyTestIn } from "@/generated/contract";
import type { KeyTestResult } from "@/lib/control-plane/operations/upstreams";

/** 一次测试的目标：行内单把（keyId）或多选批量（keyIds）。 */
export type KeyTestTarget = { keyId: string } | { keyIds: string[] };

/** 目标 → 请求体：两种 scope 互斥（后端 schema 同口径，同时给会 422）。 */
export function keyTestInput(target: KeyTestTarget): UpstreamKeyTestIn {
  return "keyId" in target ? { key_id: target.keyId } : { keys: target.keyIds };
}

/** 多选集合 → 批量目标；没有选中返回 null（面板头部不出现批量测试按钮）。 */
export function batchTestTarget(selected: ReadonlySet<string>): KeyTestTarget | null {
  return selected.size === 0 ? null : { keyIds: [...selected] };
}

/** 本次 pending 是否命中该行：只有被测试的目标行显示「测试中」。 */
export function isKeyTestTarget(
  target: KeyTestTarget | null | undefined,
  keyId: string,
): boolean {
  if (!target) return false;
  return "keyId" in target ? target.keyId === keyId : target.keyIds.includes(keyId);
}

/** 行内测试按钮文案：其余行保持「测试」（按钮宽度由固定操作列兜底）。 */
export function rowTestLabel(pending: boolean, targeted: boolean): string {
  return pending && targeted ? "测试中" : "测试";
}

/** 批量测试按钮文案：进行中换「测试中」，固定按钮宽度下不随文案/把数抖动。 */
export function batchTestLabel(pending: boolean, count: number): string {
  return pending ? "测试中" : "批量测试 " + count + " 把";
}

export interface KeyTestNotice {
  tone: "success" | "warning";
  title: string;
  description: string;
}

/** 结果汇总（行内/批量共用一处口径）：失效数由结果列标红，toast 只给摘要。 */
export function keyTestNotice(target: KeyTestTarget, result: KeyTestResult): KeyTestNotice {
  const ok = result.items.filter((item) => item.ok).length;
  const failed = result.items.length - ok;
  return {
    tone: failed > 0 ? "warning" : "success",
    title: "keyIds" in target ? "批量测试完成" : "测试完成",
    description: "成功 " + ok + " 把" + (failed > 0 ? " · 失效 " + failed + " 把（已标红）" : ""),
  };
}
