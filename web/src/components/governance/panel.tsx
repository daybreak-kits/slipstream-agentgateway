import type { ReactNode } from "react";
import { AlertCircle, Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** 分组卡片：标题 + 说明 + 右上角动作 + 内容；用于设置分组与权限矩阵。 */
export function SectionCard({ title, description, actions, children, className }: SectionCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-title">{title}</h3>
          {description !== undefined && <div className="mt-0.5 text-2xs text-faint">{description}</div>}
        </div>
        {actions !== undefined && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
      </div>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

interface PageToolbarProps {
  children?: ReactNode;
  actions?: ReactNode;
}

/** 表格上方的工具条：左侧计数/说明，右侧主操作。 */
export function PageToolbar({ children, actions }: PageToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {actions !== undefined && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
}

/** 整页/整块的错误态：可读原因 + 重试。 */
export function ErrorState({ title = "加载失败", description, onRetry, retrying = false }: ErrorStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <AlertCircle aria-hidden="true" className="h-5 w-5 text-danger" strokeWidth={1.75} />
        <div className="text-2sm font-medium text-title">{title}</div>
        {description !== undefined && <p className="max-w-xl text-2xs text-faint">{description}</p>}
        {onRetry !== undefined && (
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? "重试中…" : "重试"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

/** 空态：说明“为什么空”并给一个主操作（DataTable 内置空态只能放文案）。 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <Inbox aria-hidden="true" className="h-5 w-5 text-faint" strokeWidth={1.75} />
        <div className="text-2sm font-medium text-title">{title}</div>
        {description !== undefined && <p className="max-w-xl text-2xs text-faint">{description}</p>}
        {action !== undefined && <div className="mt-1">{action}</div>}
      </CardContent>
    </Card>
  );
}
