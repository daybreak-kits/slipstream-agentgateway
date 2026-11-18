import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RenameKeyDialogProps {
  open: boolean;
  /** 当前名称，null = 未选中行（弹窗关闭） */
  keyName: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

/** 重命名连接密钥（控制台元数据，不影响数据面）。 */
export function RenameKeyDialog({ open, keyName, pending, onClose, onSubmit }: RenameKeyDialogProps) {
  const [name, setName] = useState("");

  const isOpen = open && keyName !== null;
  useEffect(() => {
    if (isOpen) setName(keyName ?? "");
  }, [isOpen, keyName]);

  const submit = () => {
    const cleaned = name.trim();
    if (cleaned.length === 0 || cleaned === keyName) return;
    onSubmit(cleaned);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>重命名密钥</DialogTitle>
          <DialogDescription>名称只用于控制台展示，可随时再改。</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rename-key-name">密钥名称</Label>
          <Input
            id="rename-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={255}
            disabled={pending}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending || name.trim().length === 0}>
            {pending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
