import type * as React from "react";

/**
 * 弹框统一键盘契约（spec「交互与界面-弹框」/ D11；User Story 41-44）。
 *
 * 全站弹框共用这一份判定，页面不再各写一套：
 * - Enter 触发主操作；输入法组合中（compositionstart 未结束）不触发；
 * - 焦点在按钮/链接上时 Enter 交给原生激活，不重复触发主操作；
 * - 多行输入（textarea）里 Enter 只换行，不提交；
 * - 提交中（submitDisabled）不再发起主操作。
 */

/** Enter 是否处于输入法组合中：组合中的 Enter 只用于选词。 */
export function isComposingEvent(event: React.KeyboardEvent | KeyboardEvent): boolean {
  const native = (event as { nativeEvent?: { isComposing?: boolean } }).nativeEvent;
  if (native && native.isComposing === true) return true;
  // 老内核用 keyCode 229 表示「组合中的按键」。
  return (event as { keyCode?: number }).keyCode === 229;
}

/** 目标元素是否会用 Enter 自己激活（按钮/链接/菜单项）：这类目标不重复触发主操作。 */
export function isSelfActivatingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest("button, a[href], [role='button'], [role='menuitem'], [role='option']") !== null;
}

/** 弹框里的第一个可输入元素（表单型弹框的默认落焦点）。 */
export function findFirstInput(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  return root.querySelector<HTMLElement>(
    "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable='true']",
  );
}
