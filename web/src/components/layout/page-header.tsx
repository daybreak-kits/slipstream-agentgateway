import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 全站统一页头（unslop pass 4）：一个 h1 + 一句说明 + 可选动作。
 * 所有一级页面共用，保证标题层级、间距与文案位置一致。
 * W6 ticket 14：标题区 flex-1 + h1 truncate——超长标题省略而不是把动作区挤到
 * 换行（动作区内容随状态增减时，页头高度必须稳定，否则整页内容会被推挤）。
 * W7 ticket 12：说明行移出与 actions 共享的 flex 行，单独成行——说明列宽只随
 * 容器变化，与 actions 宽度彻底解耦。此前说明与 actions 同行互斥占宽，脏态
 * 徽章变宽会把说明挤到折行、页头增高、整页 +20px 位移（responsive_matrix
 * public-edit.* 预置回归）。静态页说明仍 text-pretty 自然换行（e5ecfa2 意图）。
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
    <header className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-3" data-slot="page-head-row">
        <h1 className="min-w-0 flex-1 truncate text-h1 font-semibold tracking-tight text-title" title={title}>{title}</h1>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? (
        <p
          className="max-w-[76ch] text-pretty text-sm leading-5 text-faint"
          title={typeof description === "string" ? description : undefined}
        >
          {description}
        </p>
      ) : null}
    </header>
  );
}
