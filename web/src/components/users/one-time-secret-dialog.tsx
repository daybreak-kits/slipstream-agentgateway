import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";
import { toast } from "@/lib/notify";

interface OneTimeSecretDialogProps {
  open: boolean;
  title: string;
  /** 一次性警示文案：如「此密码仅显示一次」/「关闭后不再展示，请立即复制保存」 */
  description: string;
  secret: string;
  onClose: () => void;
}

/**
 * 一次性明文展示（ADR-019/ADR-023）：创建用户的 initial_password、重置密码、
 * 重置密钥的新明文共用同一个弹窗形态——大号等宽字 + 复制 + 仅显示一次警示。
 * 关闭即失效，前端不缓存明文；footer 只有复制与关闭两个同尺寸按钮（票13，
 * 复制可重复点击，不设第二个复制入口）。
 */
export function OneTimeSecretDialog({
  open,
  title,
  description,
  secret,
  onClose,
}: OneTimeSecretDialogProps) {
  const copy = async () => {
    // W6 票 13 契约：复制可重复点击、弹窗不缓存明文——不加 pending 态，
    // 只在剪贴板写入成功后提示「已复制」，失败 toast 明确错误。
    const ok = await copyText(secret);
    if (ok) {
      toast.success("已复制");
    } else {
      toast.error("复制失败", {
        description: "浏览器剪贴板不可用或未授权，请手动抄录下方明文。",
      });
    }
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
          <Button onClick={copy}>复制</Button>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
