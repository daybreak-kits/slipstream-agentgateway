import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/**
 * 路由级 lazy 的兜底：骨架 + spinner，避免切换路由时白屏。
 * 布局对齐列表/看板页的常见结构（页头 + 指标卡 + 主内容块）。
 */
export function RouteFallback() {
  return (
    <div className="flex flex-col gap-4 px-1 py-2" role="status" aria-live="polite" aria-label="页面加载中">
      <div className="flex items-center gap-2 text-2sm text-muted-foreground">
        <Spinner size="sm" />
        <span>页面加载中…</span>
      </div>
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-4 w-full max-w-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
