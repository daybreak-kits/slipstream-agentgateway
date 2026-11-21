import { useCallback, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export interface DialogDraftGuardOptions {
  /** 弹框里有没有未保存的改动。 */
  dirty: boolean;
  /** 真正关闭弹框的动作。 */
  onClose: () => void;
  /** 放弃确认的标题。 */
  title?: string;
  /** 放弃确认的说明（各弹框说明丢了什么）。 */
  description?: string;
  /** 放弃确认的动作文案。 */
  confirmLabel?: string;
}

export interface DialogDraftGuard {
  /** 取消/关闭请求：有未保存改动时先确认「放弃修改？」。 */
  requestClose: () => void;
  /** 需要渲染在弹框外的确认节点（没有未保存改动时为 null）。 */
  confirmNode: ReactNode;
}

/**
 * 弹框草稿守卫（W4-G 弹窗草稿守卫的统一实现，W7 D11 收口到一处）。
 *
 * Esc、遮罩点击与「取消」都走 requestClose：有未保存改动时先问「放弃修改？」，
 * 确认后才关窗。各弹框只声明「什么算脏」，不再各写一套确认框。
 */
export function useDialogDraftGuard(options: DialogDraftGuardOptions): DialogDraftGuard {
  const {
    dirty,
    onClose,
    title = "放弃修改？",
    description = "弹窗内的修改不会保存，关闭后将丢失。",
    confirmLabel = "放弃修改",
  } = options;
  const [confirming, setConfirming] = useState(false);

  const requestClose = useCallback(() => {
    if (dirty) setConfirming(true);
    else onClose();
  }, [dirty, onClose]);

  const confirmNode = confirming ? (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) setConfirming(false);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      destructive
      initialFocus="cancel"
      onConfirm={() => {
        setConfirming(false);
        onClose();
      }}
    />
  ) : null;

  return { requestClose, confirmNode };
}
