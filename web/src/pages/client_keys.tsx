import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { fmtCny } from "@/lib/format";
import type { ApiKey as ApiKeyRow, EndUser, LedgerRow } from "@/types";

export function ClientKeysPage() {
  const qc = useQueryClient();
  const qKeys = useQuery({ queryKey: ["api-keys"], queryFn: () => apiList<ApiKeyRow>(ENDPOINTS.apiKeys) });
  const qUsers = useQuery({ queryKey: ["users"], queryFn: () => apiList<EndUser>(ENDPOINTS.users) });

  const [revealed, setRevealed] = useState<{ keyId: string; plaintext: string } | null>(null);
  const reveal = useMutation({
    mutationFn: (id: string) => api.post<{ plaintext: string }>(ENDPOINTS.apiKeyReveal(id), {}),
    onSuccess: (data, keyId) => setRevealed({ keyId, plaintext: data.plaintext }),
    onError: (e: Error) => toast.error("无法读取明文", { description: e.message }),
  });
  const [ledgerFor, setLedgerFor] = useState<string | null>(null);
  const qLedger = useQuery({
    queryKey: ["user-ledger", ledgerFor],
    queryFn: () => apiList<LedgerRow>(ENDPOINTS.userLedger(ledgerFor ?? "")),
    enabled: ledgerFor !== null,
  });
  const [topupUserId, setTopupUserId] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const topup = useMutation({
    mutationFn: (input: { userId: string; deltaMicro: number }) =>
      api.post(ENDPOINTS.userBalance(input.userId), { delta_micro: input.deltaMicro }),
    onSuccess: () => {
      toast.success("充值成功");
      void qc.invalidateQueries({ queryKey: ["users"] });
      setTopupUserId(null);
      setTopupAmount("");
    },
    onError: (e: Error) => toast.error("充值失败", { description: e.message }),
  });

  const userName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of qUsers.data?.items ?? []) m.set(u.id, u.name);
    return m;
  }, [qUsers.data]);
  const userById = useMemo(() => {
    const m = new Map<string, EndUser>();
    for (const u of qUsers.data?.items ?? []) m.set(u.id, u);
    return m;
  }, [qUsers.data]);

  const doTopup = () => {
    if (topupUserId === null) return;
    const yuan = Number(topupAmount);
    if (Number.isNaN(yuan) || yuan <= 0) {
      toast.error("请输入有效金额（元）");
      return;
    }
    topup.mutate({ userId: topupUserId, deltaMicro: Math.round(yuan * 1_000_000) });
  };

  const columns: ColumnDef<ApiKeyRow, unknown>[] = [
    {
      accessorKey: "mask",
      header: "密钥",
      cell: (c) => (
        <span className="tnum font-mono text-2xs">{c.row.original.mask}…{c.row.original.key_suffix}</span>
      ),
    },
    {
      accessorKey: "user_id",
      header: "所属用户",
      cell: (c) => userName.get(c.row.original.user_id) ?? c.row.original.user_id,
    },
    {
      id: "balance",
      header: "余额",
      cell: (c) => {
        const u = userById.get(c.row.original.user_id);
        return <span className="tnum">{u ? fmtCny(u.balance_micro) : "—"}</span>;
      },
    },
    {
      id: "topup",
      header: "充值",
      cell: (c) => (
        <Button variant="outline" size="sm" onClick={() => { setTopupUserId(c.row.original.user_id); setTopupAmount(""); }}>充值</Button>
      ),
    },
    {
      id: "ledger",
      header: "流水",
      cell: (c) => (
        <Button variant="ghost" size="sm" onClick={() => setLedgerFor(c.row.original.user_id)}>查看</Button>
      ),
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: (c) => <Badge tone={c.row.original.status === "active" ? "success" : "neutral"}>{c.row.original.status === "active" ? "启用" : "停用"}</Badge>,
    },
    {
      id: "reveal",
      header: "明文",
      cell: (c) => (
        <Button variant="ghost" size="sm" onClick={() => reveal.mutate(c.row.original.id)}>查看明文</Button>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <p className="text-2xs text-faint">密钥列表只显示掩码；明文仅在点击查看后返回一次，不缓存。余额耗尽后请求返回 429；充值走用户余额（元，两位小数以内）。</p>
      <DataTable
        columns={columns}
        data={qKeys.data?.items}
        loading={qKeys.isPending}
        error={qKeys.isError ? (qKeys.error as Error).message : null}
        onRetry={() => void qKeys.refetch()}
        emptyText="还没有 API 密钥"
        filterPlaceholder="筛选密钥 / 用户"
      />

      <Dialog open={revealed !== null} onOpenChange={(v) => { if (!v) setRevealed(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>密钥明文</DialogTitle>
            <DialogDescription>关闭后不再展示；请立即复制保存。</DialogDescription>
          </DialogHeader>
          <p className="break-all rounded-md border border-border bg-surface-2 p-2 font-mono text-2xs">{revealed?.plaintext}</p>
          <DialogFooter>
            <Button onClick={() => { void navigator.clipboard.writeText(revealed?.plaintext ?? ""); toast.success("已复制"); }}>复制</Button>
            <Button variant="outline" onClick={() => setRevealed(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={topupUserId !== null} onOpenChange={(v) => { if (!v) setTopupUserId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>充值 · {topupUserId ? userName.get(topupUserId) ?? topupUserId : ""}</DialogTitle>
            <DialogDescription>金额以元为单位，最多两位小数。</DialogDescription>
          </DialogHeader>
          <Input className="h-auto px-3 py-2 text-sm" placeholder="如 50.00" inputMode="decimal" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopupUserId(null)}>取消</Button>
            <Button onClick={doTopup} disabled={topup.isPending}>{topup.isPending ? "充值中…" : "确认充值"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ledgerFor !== null} onOpenChange={(v) => { if (!v) setLedgerFor(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>余额流水 · {ledgerFor ? userName.get(ledgerFor) ?? ledgerFor : ""}</DialogTitle>
          </DialogHeader>
          {qLedger.isError && <p className="text-2xs text-danger-text">{(qLedger.error as Error).message}</p>}
          <TableWrap className="max-h-80 overflow-auto">
            <Table className="text-2xs">
              <THead className="bg-transparent">
                <TR className="border-t-0 border-b border-border text-faint hover:bg-transparent">
                  <TH className="p-1 text-left font-normal text-faint">时间</TH>
                  <TH className="p-1 text-left font-normal text-faint">类型</TH>
                  <TH className="p-1 text-right font-normal text-faint">变动（元）</TH>
                  <TH className="p-1 text-right font-normal text-faint">变动后余额（元）</TH>
                  <TH className="p-1 text-left font-normal text-faint">说明</TH>
                </TR>
              </THead>
              <tbody>
                {(qLedger.data?.items ?? []).map((r) => (
                  <TR key={r.id} className="border-t border-border">
                    <TD className="p-1">{r.ts}</TD>
                    <TD className="p-1">{r.kind === "topup" ? "充值" : "消费"}</TD>
                    <TD className="p-1 text-right tnum">{r.delta_micro >= 0 ? "+" : ""}{fmtCny(r.delta_micro)}</TD>
                    <TD className="p-1 text-right tnum">{fmtCny(r.balance_after_micro)}</TD>
                    <TD className="p-1">{r.note}</TD>
                  </TR>
                ))}
                {(qLedger.data?.items.length ?? 0) === 0 && !qLedger.isError && (
                  <TR><TD className="p-2 text-faint" colSpan={5}>暂无流水</TD></TR>
                )}
              </tbody>
            </Table>
          </TableWrap>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLedgerFor(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}