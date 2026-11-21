import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ACTION_ICONS } from "@/lib/icons";
import { cn } from "@/lib/utils";

export interface DirtyFieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** 该字段相对 baseline 是否已修改。 */
  dirty: boolean;
  /** 恢复该项：把该字段回填成 baseline 值；不传则不渲染恢复按钮。 */
  onReset?: () => void;
  /** 恢复按钮的无障碍文案，默认「恢复该项」（如「恢复角色名称」）。 */
  resetLabel?: string;
  children: ReactNode;
}

/**
 * 字段级脏标记（W6 ticket 14 重做）：变脏只换背景色，标记槽绝对定位挂在字段
 * 右上角——不加左 padding、不在文档流里插下方行，任何字段变脏都不改变自身与
 * 后续元素的位置/尺寸（布局零位移）。只标已修改字段——整表高亮是噪音；保存
 * 成功后由父级回填 baseline 自然清除。
 */
export function DirtyField({
  dirty,
  onReset,
  resetLabel = "恢复该项",
  children,
  className,
  ...rest
}: DirtyFieldProps) {
  return (
    <div
      data-slot="dirty-field"
      data-dirty={dirty ? "true" : "false"}
      className={cn(
        "relative rounded-control transition-colors",
        dirty && "bg-warning-soft/60",
        className,
      )}
      {...rest}
    >
      {dirty ? (
        <span
          aria-hidden="true"
          data-slot="dirty-bar"
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-full bg-warning"
        />
      ) : null}
      {children}
      {dirty ? (
        <div
          data-slot="dirty-marker"
          className="absolute right-1 top-0 z-[var(--z-sticky-column)] flex h-5 -translate-y-1/2 items-center gap-0.5 rounded-badge border border-warning/50 bg-surface px-1 text-2xs text-warning-text shadow-xs"
        >
          <span aria-hidden="true">●</span>
          <span>已修改</span>
          {onReset ? (
            <Button
              variant="ghost"
              size="dense"
              className="h-4 gap-0.5 px-0.5 text-2xs text-warning-text hover:bg-warning-soft hover:text-warning-text"
              onClick={onReset}
              title={resetLabel}
              aria-label={resetLabel}
            >
              <Undo2 aria-hidden="true" className="h-3 w-3" />
              恢复
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface DirtyCountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** 未保存变更数；<=0 时不渲染。 */
  count: number;
}

/** 区块标题上的未保存数量（如权限组「3 项未保存」）。 */
export function DirtyCountBadge({ count, className, ...rest }: DirtyCountBadgeProps) {
  if (count <= 0) return null;
  return (
    <Badge tone="warning" data-slot="dirty-count" className={cn("tnum", className)} {...rest}>
      {count} 项未保存
    </Badge>
  );
}

export interface DirtySummaryProps extends HTMLAttributes<HTMLSpanElement> {
  count: number;
  onResetAll?: () => void;
  saving?: boolean;
}

/** 底部动作条左侧摘要：未保存 N 项 + 恢复全部；保存中显示进度。 */
export function DirtySummary({ count, onResetAll, saving = false, className, ...rest }: DirtySummaryProps) {
  if (saving) {
    return (
      <span
        data-slot="dirty-summary"
        className={cn("inline-flex items-center gap-1.5 text-2sm text-body", className)}
        aria-live="polite"
        {...rest}
      >
        <Spinner size="sm" aria-hidden="true" />
        保存中…
      </span>
    );
  }
  if (count > 0) {
    return (
      <span
        data-slot="dirty-summary"
        className={cn("inline-flex items-center gap-1.5 text-2sm text-warning-text", className)}
        aria-live="polite"
        {...rest}
      >
        <span className="font-medium">未保存 {count} 项</span>
        {onResetAll ? (
          <Button
            variant="ghost"
            size="dense"
            className="h-5 gap-0.5 px-1 text-2xs text-warning-text hover:bg-warning-soft hover:text-warning-text"
            onClick={onResetAll}
          >
            <ACTION_ICONS.restore aria-hidden="true" className="h-3 w-3" />
            恢复全部
          </Button>
        ) : null}
      </span>
    );
  }
  return (
    <span data-slot="dirty-summary" className={cn("text-2sm text-faint", className)} {...rest}>
      所有修改已保存
    </span>
  );
}

export interface DirtySaveButtonProps extends Omit<ComponentProps<typeof Button>, "variant"> {
  /** 脏时=主按钮，干净时=中性 disabled（spec §7「按钮回到中性禁用」）。 */
  dirty: boolean;
  /** 保存中：禁用并显示进度。 */
  pending?: boolean;
  savingLabel?: string;
}

/** 脏表单保存按钮：脏=primary；干净=secondary+disabled；保存中=progress。 */
export function DirtySaveButton({
  dirty,
  pending = false,
  savingLabel = "保存中…",
  children = "保存",
  disabled,
  className,
  ...rest
}: DirtySaveButtonProps) {
  return (
    <Button
      variant={dirty ? "primary" : "secondary"}
      size="sm"
      disabled={pending || !dirty || disabled}
      className={cn("gap-1.5", className)}
      {...rest}
    >
      {pending ? (
        <>
          <Spinner size="sm" aria-hidden="true" />
          {savingLabel}
        </>
      ) : (
        <>
          <ACTION_ICONS.save aria-hidden="true" className="h-3.5 w-3.5" />
          {children}
        </>
      )}
    </Button>
  );
}

export interface DirtyFooterProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  count: number;
  onResetAll?: () => void;
  saving?: boolean;
  children?: ReactNode;
}

/** 脏表单底部动作条：左「未保存 N 项 + 恢复全部」，右保存/取消；sticky 贴底。 */
export function DirtyFooter({ count, onResetAll, saving = false, children, className, ...rest }: DirtyFooterProps) {
  return (
    <div
      data-slot="dirty-footer"
      className={cn(
        "sticky bottom-0 z-[var(--z-sticky)] -mx-1 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-1 pb-1 pt-2",
        className,
      )}
      {...rest}
    >
      <DirtySummary count={count} onResetAll={onResetAll} saving={saving} />
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}
