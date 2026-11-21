import { useEffect, useRef, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  /**
   * 打开后的落焦点：cancel=取消，action=确认。
   * 默认按 destructive 决定——危险确认落在「取消」，误按 Enter 不会直接执行删除。
   */
  initialFocus?: "cancel" | "action";
}

/**
 * AlertDialog 上的业务确认框：受控 open，危险动作复用 Button 的 danger 变体。
 * 动作按钮由 Radix 负责关闭，因此 onConfirm 只负责提交。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  onConfirm,
  destructive = false,
  initialFocus,
}: ConfirmDialogProps) {
  // 一次确认只发一次：连按 Enter/点击不会重复提交。
  const firedRef = useRef(false);
  useEffect(() => {
    if (open) firedRef.current = false;
  }, [open]);

  const handleConfirm = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    void onConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md" initialFocus={initialFocus ?? (destructive ? "cancel" : "action")}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? buttonVariants({ variant: "danger" }) : undefined}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
