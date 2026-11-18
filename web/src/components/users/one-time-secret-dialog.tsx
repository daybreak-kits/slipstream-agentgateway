import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface OneTimeSecretDialogProps {
  open: boolean;
  title: string;
  /** 一次性警示文案：如「此密码仅显示一次」/「关闭后不再展示，请立即复制保存」 */
  description: string;
  secret: string;
  /** 重置密钥场景需要「再次复制」入口（仅本弹窗存活期有效）；密码类默认关 */
  showRecopy?: boolean;
  onClose: () => void;
}

/**
 * 一次性明文展示（ADR-019/ADR-023）：创建用户的 initial_password、重置密码、
 * 重置密钥的新明文共用同一个弹窗形态——大号等宽字 + 复制 + 仅显示一次警示。
 * 关闭即失效，前端不缓存明文。
 */
export function OneTimeSecretDialog({
  open,
  title,
  description,
  secret,
  showRecopy = false,
  onClose,
}: OneTimeSecretDialogProps) {
  const copy = () => {
    void navigator.clipboard.writeText(secret);
    toast.success("已复制");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <p className="break-all rounded-md border border-border bg-surface-2 p-3 font-mono text-base text-title tnum">
          {secret}
        </p>
        <DialogFooter>
          {showRecopy && (
            <Button variant="outline" size="sm" onClick={copy}>
              再次复制
            </Button>
          )}
          <Button onClick={copy}>复制</Button>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
