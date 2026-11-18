import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { SELECT_ALL_VALUE } from "@/lib/select-sentinels";

import {
  fmtMs,
  fmtSignedMicro,
  fmtYuan,
  isoMs,
  parseYuanToMicro,
  parseYuanToMicroAllowZero,
} from "./format";
import {
  KIND_LABEL,
  KIND_TONE,
  LEDGER_KINDS,
  LEDGER_PAGE_SIZE,
  summarizeLedger,
} from "./ledger-meta";
import type { ConsumerUser, LedgerEntry } from "./types";

const QUICK_AMOUNTS = ["100", "500", "1000", "5000"];

// ---------------------------------------------------------------- 充值

interface TopupDialogProps {
  user: ConsumerUser | null;
  open: boolean;
  pending: boolean;
  errorText: string | null;
  onClose: () => void;
  onSubmit: (values: { amountMicro: number; note: string }) => void;
}

/** 充值：金额按“元”输入，提交时折成 micro；成功由页面统一 toast + 失效缓存。 */
export function TopupDialog({ user, open, pending, errorText, onClose, onSubmit }: TopupDialogProps) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  const userId = user?.id;

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setNote("");
    setTouched(false);
  }, [open, userId]);

  const amountMicro = parseYuanToMicro(amount);
  const invalid = touched && amountMicro === null;
  const balanceAfter = (user?.balance_micro ?? 0) + (amountMicro ?? 0);

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
          <DialogTitle>充值 · {user?.name ?? "用户"}</DialogTitle>
          <DialogDescription>
            预付余额充值会写入账本，并触发一次配置下发让数据面令牌桶跟随（ADR-011）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {errorText !== null && (
            <Alert variant="destructive">
              <span>{errorText}</span>
            </Alert>
          )}

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

          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-2xs text-body">
            当前余额 <span className="tnum text-title">{fmtYuan(user?.balance_micro ?? 0)}</span>
            {amountMicro !== null && (
              <>
                {" "}→ 充值后 <span className="tnum font-medium text-primary">{fmtYuan(balanceAfter)}</span>
              </>
            )}
          </div>
          <p className="text-2xs text-faint">1 元 = 1,000,000 micro；账本记 topup，退款走独立的退款端点。</p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending || amountMicro === null}>
            {pending ? "入账中…" : "确认充值"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 账本

const LEDGER_QUERY_KEY = (userId: string) => ["user-ledger", userId] as const;

interface LedgerDialogProps {
  user: ConsumerUser | null;
  open: boolean;
  onClose: () => void;
}

/** 消费记录：拉最近 200 条账本，按类型筛选；同一 queryKey 与列表页汇总共用缓存。 */
export function LedgerDialog({ user, open, onClose }: LedgerDialogProps) {
  const [kind, setKind] = useState<string>(SELECT_ALL_VALUE);
  const userId = user?.id ?? "";

  useEffect(() => {
    if (!open) return;
    setKind(SELECT_ALL_VALUE);
  }, [open, userId]);

  const ledger = useQuery({
    queryKey: LEDGER_QUERY_KEY(userId),
    queryFn: () =>
      api.get<LedgerEntry[]>(
        "/admin/users/" + userId + "/ledger?page_size=" + LEDGER_PAGE_SIZE + "&offset=0",
      ),
    enabled: open && user !== null,
  });

  const entries = ledger.data ?? [];
  const filtered = kind === SELECT_ALL_VALUE ? entries : entries.filter((entry) => entry.kind === kind);
  const summary = summarizeLedger(entries);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>消费记录 · {user?.name ?? "用户"}</DialogTitle>
          <DialogDescription>
            账本按时间倒序，最多 {LEDGER_PAGE_SIZE} 条；累计消费 = 所有 charge 的负 delta 绝对值。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 text-2xs">
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <div className="text-faint">当前余额</div>
            <div className="tnum text-sm font-medium text-title">{fmtYuan(user?.balance_micro ?? 0)}</div>
          </div>
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <div className="text-faint">累计消费</div>
            <div className="tnum text-sm font-medium text-title">{fmtYuan(summary.consumedMicro)}</div>
          </div>
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <div className="text-faint">累计入账（充值/退款/调整）</div>
            <div className="tnum text-sm font-medium text-title">{fmtYuan(summary.toppedMicro)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SELECT_ALL_VALUE}>全部类型</SelectItem>
              {LEDGER_KINDS.map((item) => (
                <SelectItem key={item} value={item}>
                  {KIND_LABEL[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-2xs text-faint">
            共 <span className="tnum">{filtered.length}</span> 条
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => void ledger.refetch()}
            disabled={ledger.isFetching}
          >
            {ledger.isFetching ? "刷新中…" : "刷新"}
          </Button>
        </div>

        {ledger.isError ? (
          <Alert variant="destructive">
            <span>账本读取失败：{ledger.error.message}（可点“刷新”重试）</span>
          </Alert>
        ) : ledger.isPending ? (
          <div className="space-y-1.5">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Empty text={entries.length === 0 ? "该用户还没有账本记录" : "该类型下没有记录"} />
        ) : (
          <TableWrap className="max-h-80 overflow-y-auto rounded-md border border-border">
            <Table>
              <THead>
                <tr>
                  <TH>时间</TH>
                  <TH>类型</TH>
                  <TH className="text-right">变动</TH>
                  <TH className="text-right">变动后余额</TH>
                  <TH>备注</TH>
                  <TH>操作人</TH>
                </tr>
              </THead>
              <tbody>
                {filtered.map((entry: LedgerEntry) => (
                  <TR key={entry.id}>
                    <TD className="tnum whitespace-nowrap text-2xs">
                      {fmtMs(entry.created_at_ms ?? isoMs(entry.ts))}
                    </TD>
                    <TD>
                      <Badge tone={KIND_TONE[entry.kind]}>{KIND_LABEL[entry.kind]}</Badge>
                    </TD>
                    <TD
                      className={
                        "tnum whitespace-nowrap text-right " +
                        (entry.delta_micro > 0 ? "text-success-text" : "text-title")
                      }
                    >
                      {fmtSignedMicro(entry.delta_micro)}
                    </TD>
                    <TD className="tnum whitespace-nowrap text-right">{fmtYuan(entry.balance_after_micro)}</TD>
                    <TD className="text-2xs text-body">{entry.note || "—"}</TD>
                    <TD className="text-2xs text-faint">{entry.created_by || "—"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 新建用户

interface CreateUserDialogProps {
  open: boolean;
  pending: boolean;
  errorText: string | null;
  onClose: () => void;
  onSubmit: (values: { name: string; balanceMicro: number }) => void;
}

export function CreateUserDialog({ open, pending, errorText, onClose, onSubmit }: CreateUserDialogProps) {
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName("");
    setBalance("");
    setErrors({});
  }, [open]);

  const submit = () => {
    const next: Record<string, string> = {};
    if (name.trim().length === 0) next.name = "请输入用户名称";
    const balanceMicro = parseYuanToMicroAllowZero(balance);
    if (balanceMicro === null) next.balance = "请输入不小于 0 的金额";
    setErrors(next);
    if (Object.keys(next).length > 0 || balanceMicro === null) return;
    onSubmit({ name: name.trim(), balanceMicro });
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
          <DialogTitle>新建用户</DialogTitle>
          <DialogDescription>
            用户是 API 消费者（持有客户端密钥与预付余额），与管理员的账号体系相互独立。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {errorText !== null && (
            <Alert variant="destructive">
              <span>{errorText}</span>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="user-name">名称</Label>
            <Input
              id="user-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 数据分析组"
              maxLength={255}
              disabled={pending}
              autoComplete="off"
            />
            {errors.name !== undefined && <p className="text-2xs text-danger-text">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-balance">初始余额（元，可留空）</Label>
            <Input
              id="user-balance"
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              disabled={pending}
              autoComplete="off"
            />
            {errors.balance !== undefined && <p className="text-2xs text-danger-text">{errors.balance}</p>}
            <p className="text-2xs text-faint">初始余额在创建时记一条 topup 账本，便于对账。</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? "创建中…" : "创建用户"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
