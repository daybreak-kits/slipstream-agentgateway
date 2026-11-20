/**
 * toast 统一策略（spec §7）：所有 toast 3 秒自动消失、带关闭按钮，同时写通知中心历史。
 *
 * 位置选右上（DESIGN-AUDIT 四期 §4 / W2.6）：避开表格底部、分页条与 sticky 操作列；
 * top 偏移按 64px 顶栏 + 16px 间距下移，不会被顶栏压住。需要持续可见的反馈由
 * lib/notification-store 的历史承担（每条 toast 都会记一条），而不是让 toast 常驻。
 */
import type { ExternalToast } from "sonner";

/** 统一时长：3 秒，任何调用方都不能覆盖。 */
export const NOTIFY_DURATION_MS = 3000;

/** 右上，且从顶栏下方出现，不遮挡页面标题/筛选行与表格操作列。 */
export const TOAST_POSITION = "top-right" as const;

/** top 80 = 顶栏 64 + 16 间距；right 16 与页面留白一致。 */
export const TOAST_OFFSET = { top: 80, right: 16 } as const;

/** 同屏最多 3 条，避免堆叠盖住内容。 */
export const TOAST_VISIBLE_COUNT = 3;

/** 先铺开调用方选项，再强制统一时长与关闭按钮（顺序是有意的）。 */
export function withToastDefaults(options?: ExternalToast): ExternalToast {
  return { ...options, closeButton: true, duration: NOTIFY_DURATION_MS };
}
