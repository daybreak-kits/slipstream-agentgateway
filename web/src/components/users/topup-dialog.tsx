import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseYuanToMicro } from "@/lib/format";

const QUICK_AMOUNTS = ["100", "500", "1000", "5000"];

interface TopupDialogProps {
  userName: string;
  open: boolean;
  pending: boolean;
  errorText: string | null;
  onClose: () => void;
  onSubmit: (values: { amountMicro: number; note: string }) => void;
}

/** 充值（ADR-023：充值入口在用户管理）：金额按元输入，提交折成 micro，写入账本。 */
export function TopupDialog({ userName, open, pending, errorText, onClose, onSubmit }: TopupDialogProps) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setNote("");
    setTouched(false);
  }, [open, userName]);

  const amountMicro = parseYuanToMicro(amount);
  const invalid = touched && amountMicro === null;

  const submit = () => {
    setTouched(true);
    if (amountMicro === null) return;
    onSubmit({ amountMicro, note: note.trim() });
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
          <DialogTitle>充值 · {userName}</DialogTitle>
          <DialogDescription>充值会写入账本并下发数据面，余额耗尽后请求返回 429。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {errorText !== null && <Alert variant="destructive"><span>{errorText}</span></Alert>}

          <div className="space-y-1.5">
            <Label htmlFor="topup-amount">充值金额（元）</Label>
            <Input
              id="topup-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="例如 100.00"
              inputMode="decimal"
              disabled={pending}
              autoComplete="off"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK_AMOUNTS.map((value) => (
                <Button
                  key={value}
                  variant="outline"
                  size="sm"
                  className="tnum"
                  disabled={pending}
                  onClick={() => setAmount(value)}
                >
                  ¥{value}
                </Button>
              ))}
            </div>
            {invalid && <p className="text-2xs text-danger-text">请输入大于 0 的金额，最多 6 位小数</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="topup-note">备注</Label>
            <Textarea
              id="topup-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：11 月预充值 / 项目 A 专项额度"
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
          <Button onClick={submit} disabled={pending || amountMicro === null}>
            {pending ? "充值中…" : "确认充值"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
