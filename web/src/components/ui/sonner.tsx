import { Toaster as Sonner, type ToasterProps } from "sonner";

import { NOTIFY_DURATION_MS } from "@/lib/notify";
import { useTheme } from "@/lib/theme";

/** 全局唯一 Toaster：右下角 3s 自动消失 + 手动关闭；历史另存通知中心（lib/notify）。 */
export function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="bottom-right"
      visibleToasts={3}
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
