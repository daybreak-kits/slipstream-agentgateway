import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 设置网格（ticket 16）：桌面最宽一行 6 栏，1440 宽命中 xl；窄屏按 3/2/1 栏降列。
 * 非强制每行填满 6 栏，卡片少于 6 个时右侧留白。
 */
export function SettingsGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6", className)}>
      {children}
    </div>
  );
}

interface SettingsTileProps {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** 设置网格里的一张卡：标题 + 说明 + 右侧动作 + 内容，纵向紧凑排版。 */
export function SettingsTile({ title, hint, action, children, className }: SettingsTileProps) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3 shadow-card",
        className,
      )}
    >
      <div className="flex items-start gap-1.5">
        <h3 className="min-w-0 flex-1 text-2sm font-medium leading-5 text-title">{title}</h3>
        {action !== undefined && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </div>
      {hint !== undefined && <p className="mt-0.5 text-2xs leading-4 text-faint">{hint}</p>}
      <div className="mt-2 flex flex-1 flex-col gap-2">{children}</div>
    </section>
  );
}
