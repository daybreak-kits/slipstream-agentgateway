import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseYuanToMicro } from "@/components/governance/format";

interface BalanceAdjustDialogProps {
  userName: string;
  open: boolean;
  pending: boolean;
  errorText: string | null;
  onClose: () => void;
  onSubmit: (values: { deltaMicro: number; note: string }) => void;
}

/** 输入带符号金额（元），折成带符号 micro；非法输入回 null。 */
function parseSignedYuanToMicro(input: string): number | null {
  const text = input.trim().replace(/^¥/, "");
  if (text === "" || text === "-" || text === "+") return null;
  const negative = text.startsWith("-");
  const magnitude = negative ? text.slice(1) : text.replace(/^\+/, "");
  const micro = parseYuanToMicro(magnitude);
  if (micro === null) return null;
  return negative ? -micro : micro;
}

/**
 * 调整余额（POST /admin/users/{id}/balance/adjust）：delta 可正可负，写入账本；
 * 与充值（只进不出）分开，用于纠错/回收等场景。
 */
export function BalanceAdjustDialog({
  userName,
  open,
  pending,
  errorText,
  onClose,
  onSubmit,
}: BalanceAdjustDialogProps) {
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDelta("");
    setNote("");
    setTouched(false);
  }, [open, userName]);

  const deltaMicro = parseSignedYuanToMicro(delta);
  const invalid = touched && deltaMicro === null;

  const submit = () => {
    setTouched(true);
    if (deltaMicro === null || deltaMicro === 0) return;
    onSubmit({ deltaMicro, note: note.trim() });
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
          <DialogTitle>调整余额 · {userName}</DialogTitle>
          <DialogDescription>输入带符号金额：正数入账、负数扣减；扣减可把余额变为负数。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {errorText !== null && <Alert variant="destructive"><span>{errorText}</span></Alert>}

          <div className="space-y-1.5">
            <Label htmlFor="adjust-delta">调整金额（元，可正可负）</Label>
            <Input
              id="adjust-delta"
              value={delta}
              onChange={(event) => setDelta(event.target.value)}
              placeholder="例如 -50.00"
              inputMode="decimal"
              disabled={pending}
              autoComplete="off"
            />
            {invalid && <p className="text-2xs text-danger-text">请输入有效的带符号金额（不为 0），最多 6 位小数</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adjust-note">备注</Label>
            <Textarea
              id="adjust-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：线下对账纠错"
              rows={2}
              disabled={pending}
              maxLength={200}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={pending || deltaMicro === null || deltaMicro === 0}
          >
            {pending ? "提交中…" : "确认调整"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
