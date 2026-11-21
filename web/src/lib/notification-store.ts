import { useSyncExternalStore } from "react";

/**
 * 顶栏通知中心的本机历史（不落服务端）：toast 出现时同步记一条，最多 50 条。
 *
 * sonner 没有全局事件，所以由 lib/notify 的包装器在弹 toast 时写这里；
 * 通知中心只读这份历史，和右下角 3s 自动消失的 toast 解耦（用户仍可回看）。
 */
export type NotificationKind = "success" | "error" | "info" | "warning";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  description?: string;
  at: number;
  read: boolean;
}

const STORAGE_KEY = "slipstream.notifications.v1";
const MAX_ITEMS = 50;

function load(): NotificationItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is NotificationItem => {
      if (item === null || typeof item !== "object") return false;
      const row = item as Partial<NotificationItem>;
      return (
        typeof row.id === "string" &&
        typeof row.title === "string" &&
        typeof row.at === "number" &&
        (row.kind === "success" || row.kind === "error" || row.kind === "info" || row.kind === "warning")
      );
    }).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

let items: NotificationItem[] = load();
const listeners = new Set<() => void>();

function emit(): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // 存储写满/被禁用时只保留内存历史，不影响 toast。
    }
  }
  for (const listener of listeners) listener();
}

function nextId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
}

/** 记一条通知（新的在最前）；返回 id，便于调用方按需联动。 */
export function pushNotification(input: { kind: NotificationKind; title: string; description?: string }): string {
  const item: NotificationItem = {
    id: nextId(),
    kind: input.kind,
    title: input.title,
    description: input.description,
    at: Date.now(),
    read: false,
  };
  items = [item, ...items].slice(0, MAX_ITEMS);
  emit();
  return item.id;
}

/**
 * 错误通知去重窗口（W6 票07）：一次失败只产生一条通知。
 *
 * 查询（GET）失败统一走 pushErrorNotificationOnce：同因（同 dedupeKey，通常
 * 是 code+message）在窗口内的重复失败不再落新条目——一个页面的并行查询同时
 * 失败、或 5xx 重试后再失败，都只算一次失败；不同原因各记一条，窗口外的新
 * 失败再次提示。
 */
export const ERROR_DEDUPE_WINDOW_MS = 30_000;

const recentErrorKeys = new Map<string, number>();

/** 记一条错误通知；窗口内命中同 dedupeKey 时跳过并返回 false，真正落条返回 true。nowMs 仅测试注入。 */
export function pushErrorNotificationOnce(
  input: { title: string; description?: string; dedupeKey: string },
  nowMs: number = Date.now(),
): boolean {
  for (const [key, at] of recentErrorKeys) {
    if (nowMs - at >= ERROR_DEDUPE_WINDOW_MS) recentErrorKeys.delete(key);
  }
  const lastAt = recentErrorKeys.get(input.dedupeKey);
  if (lastAt !== undefined && nowMs - lastAt < ERROR_DEDUPE_WINDOW_MS) return false;
  recentErrorKeys.set(input.dedupeKey, nowMs);
  pushNotification({ kind: "error", title: input.title, description: input.description });
  return true;
}

export function markAllNotificationsRead(): void {
  if (!items.some((item) => !item.read)) return;
  items = items.map((item) => (item.read ? item : { ...item, read: true }));
  emit();
}

export function clearNotifications(): void {
  if (items.length === 0) return;
  items = [];
  emit();
}

export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNotificationsSnapshot(): NotificationItem[] {
  return items;
}

export function unreadNotificationCount(list: NotificationItem[]): number {
  return list.reduce((count, item) => (item.read ? count : count + 1), 0);
}

export function useNotifications(): NotificationItem[] {
  return useSyncExternalStore(subscribeNotifications, getNotificationsSnapshot, getNotificationsSnapshot);
}
