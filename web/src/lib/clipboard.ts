/**
 * 剪贴板写入（W7 ticket 07 / User Story 47-48）：三级回退，绝不产生未捕获异常。
 *
 * 1. 优先 Clipboard API（安全上下文、有授权时）——`navigator.clipboard` 缺失
 *    或 writeText 被拒绝（NotAllowedError）都会落入回退；
 * 2. 回退 `textarea + document.execCommand("copy")`——非安全上下文/旧浏览器路径；
 * 3. 两者都失败时返回 false，调用方负责 toast 明确错误。
 *
 * 只在写入成功后返回 true：调用方必须据此才提示「已复制」。
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 授权被拒（NotAllowedError）或浏览器策略拦截：落入 textarea 回退
    }
  }
  return legacyCopyText(text);
}

function legacyCopyText(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.left = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  const selection = document.getSelection();
  const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
    if (savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
  }
}
