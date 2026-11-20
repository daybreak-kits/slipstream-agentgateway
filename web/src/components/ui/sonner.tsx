import { Toaster as Sonner, type ToasterProps } from "sonner";

import {
  NOTIFY_DURATION_MS,
  TOAST_OFFSET,
  TOAST_POSITION,
  TOAST_VISIBLE_COUNT,
} from "@/lib/toast-policy";
import { useTheme } from "@/lib/theme";

/**
 * 全局唯一 Toaster：右上角 3s 自动消失 + 手动关闭；历史另存通知中心（lib/notify）。
 * 右上并下移 80px（顶栏 64 + 16）是为了不压住表格底部、分页条与 sticky 操作列。
 */
export function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position={TOAST_POSITION}
      offset={TOAST_OFFSET}
      visibleToasts={TOAST_VISIBLE_COUNT}
      closeButton
      toastOptions={{
        duration: NOTIFY_DURATION_MS,
        closeButton: true,
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-pop",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton: "group-[.toast]:bg-surface-2 group-[.toast]:text-body group-[.toast]:border-border",
        },
      }}
      {...props}
    />
  );
}
