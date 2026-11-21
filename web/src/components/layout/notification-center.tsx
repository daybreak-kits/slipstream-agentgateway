/**
 * 顶栏通知中心：回顾本轮会话里出现过的 toast（右下角 3s 消失后仍可回看）。
 * 历史存本机 localStorage（lib/notification-store），打开面板即标记已读。
 */
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  clearNotifications, markAllNotificationsRead, unreadNotificationCount, useNotifications,
  type NotificationItem, type NotificationKind,
} from "@/lib/notification-store";
import { cn } from "@/lib/utils";

const KIND_META: Record<NotificationKind, { icon: typeof CheckCircle2; className: string; label: string }> = {
  success: { icon: CheckCircle2, className: "text-success-text", label: "成功" },
  error: { icon: AlertCircle, className: "text-danger-text", label: "失败" },
  warning: { icon: AlertTriangle, className: "text-warning-text", label: "注意" },
  info: { icon: Info, className: "text-primary", label: "提示" },
};

const TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

/** 行 hover 详情全文：标题在前、正文随后（票13：单行省略后完整信息靠 title 兜底）。 */
function detailOf(item: NotificationItem): string {
  return item.description ? item.title + "：" + item.description : item.title;
}

/** 导出供 check-ui-foundation SSR 渲染真实行 DOM（面板容器在 Radix Portal 内，SSR 不落 DOM）。 */
export function NotificationRow({ item }: { item: NotificationItem }) {
  const meta = KIND_META[item.kind];
  const at = new Date(item.at);
  return (
    <li className="flex gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0" title={detailOf(item)} data-slot="notification-row">
      {/* 图标 16px 对标题行高 20px（text-2sm）：mt-0.5 = (20-16)/2，与标题垂直居中 */}
      <meta.icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.className)} strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2" data-slot="notification-head">
          <p className="truncate text-2sm font-medium text-title" title={item.title} data-slot="notification-title">
            {item.title}
          </p>
          <time className="shrink-0 text-2xs text-faint" dateTime={at.toISOString()} data-slot="notification-time">
            <span className="sr-only">{meta.label}，</span>
            {TIME_FORMAT.format(at)}
          </time>
        </div>
        {item.description ? (
          <p className="mt-0.5 truncate text-2xs text-muted-foreground" data-slot="notification-desc">
            {item.description}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function NotificationCenter() {
  const items = useNotifications();
  const unread = unreadNotificationCount(items);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) markAllNotificationsRead();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          title={unread > 0 ? "通知（" + unread + " 条未读）" : "通知"}
          aria-label={unread > 0 ? "通知，未读 " + unread + " 条" : "通知"}
        >
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-0" data-slot="notification-panel">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-2sm font-medium text-title">通知</span>
          {items.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1.5 text-2xs text-faint"
              onClick={clearNotifications}
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </Button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-10 text-center text-2sm text-faint">暂无通知</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((item) => (
              <NotificationRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
