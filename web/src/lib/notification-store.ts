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
