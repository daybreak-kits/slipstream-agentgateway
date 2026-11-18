import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

interface ChartCardProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** 空态提示；null 表示不空。 */
  emptyText?: string | null;
  emptyAction?: ReactNode;
  className?: string;
  children: ReactNode;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "请求失败，请稍后重试";
}

/** 看板卡片的四态外壳：加载骨架 / 空态（带主操作）/ 错误态（可重试）/ 内容。 */
export function ChartCard({
  title,
  subtitle,
  actions,
  loading = false,
  error,
  onRetry,
  emptyText = null,
  emptyAction,
  className,
  children,
}: ChartCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {subtitle !== undefined && <div className="mt-0.5 text-2xs text-faint">{subtitle}</div>}
        </div>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="space-y-2 py-6">
            <Alert variant="destructive">
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription>{errorMessage(error)}</AlertDescription>
            </Alert>
            {onRetry !== undefined && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                重试
              </Button>
            )}
          </div>
        ) : loading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : emptyText !== null ? (
          <div className="space-y-2 py-4">
            <Empty text={emptyText} />
            {emptyAction}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
