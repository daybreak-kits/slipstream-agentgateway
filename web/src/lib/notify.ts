/**
 * toast 统一入口：右上角 3s 自动消失、带关闭按钮，同时写一条到顶栏通知中心。
 *
 * 页面只 import { toast } from "@/lib/notify"；不要直接 import sonner，否则该条
 * 消息不会进通知历史。时长/位置/关闭按钮统一由 lib/toast-policy 决定，调用方
 * 传 duration 也会被强制覆盖成 3 秒——需要持续可见的反馈去通知中心回看。
 */
import type { ExternalToast } from "sonner";
import { toast as sonnerToast } from "sonner";

import { pushNotification, type NotificationKind } from "@/lib/notification-store";
import { withToastDefaults } from "@/lib/toast-policy";

export { NOTIFY_DURATION_MS } from "@/lib/toast-policy";

function record(kind: NotificationKind, title: unknown, options?: ExternalToast): void {
  const description = typeof options?.description === "string" ? options.description : undefined;
  pushNotification({
    kind,
    title: typeof title === "string" ? title : "通知",
    description,
  });
}

function success(title: string, options?: ExternalToast): string | number {
  record("success", title, options);
  return sonnerToast.success(title, withToastDefaults(options));
}

function error(title: string, options?: ExternalToast): string | number {
  record("error", title, options);
  return sonnerToast.error(title, withToastDefaults(options));
}

function info(title: string, options?: ExternalToast): string | number {
  record("info", title, options);
  return sonnerToast.info(title, withToastDefaults(options));
}

function warning(title: string, options?: ExternalToast): string | number {
  record("warning", title, options);
  return sonnerToast.warning(title, withToastDefaults(options));
}

function plain(message: string, options?: ExternalToast): string | number {
  record("info", message, options);
  return sonnerToast(message, withToastDefaults(options));
}

/** 形状与 sonner 的 toast 一致（含 dismiss/promise 等少数直通方法，它们不进历史）。 */
export const toast = Object.assign(plain, {
  success,
  error,
  info,
  warning,
  message: sonnerToast.message,
  custom: sonnerToast.custom,
  loading: sonnerToast.loading,
  promise: sonnerToast.promise,
  dismiss: sonnerToast.dismiss,
  getHistory: sonnerToast.getHistory,
  getToasts: sonnerToast.getToasts,
}) as typeof sonnerToast;
