import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 全站统一页头（unslop pass 4）：一个 h1 + 一句说明 + 可选动作。
 * 所有一级页面共用，保证标题层级、间距与文案位置一致。
 * W6 ticket 14：标题区 flex-1 + h1 truncate——超长标题省略而不是把动作区挤到
 * 换行（动作区内容随状态增减时，页头高度必须稳定，否则整页内容会被推挤）。
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-h1 font-semibold tracking-tight text-title" title={title}>{title}</h1>
        {description ? (
          <p
            className="mt-1 max-w-[76ch] text-pretty text-sm leading-5 text-faint"
            title={typeof description === "string" ? description : undefined}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
