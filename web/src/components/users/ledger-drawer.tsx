import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { fmtMs, fmtSignedMicro } from "@/components/governance/format";
import { KIND_LABEL, KIND_TONE, LEDGER_KINDS, LEDGER_PAGE_SIZE } from "@/components/governance/ledger-meta";
import type { LedgerEntry } from "@/components/governance/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { apiList } from "@/lib/api";
import { fmtCny } from "@/lib/format";
import { SELECT_ALL_VALUE } from "@/lib/select-sentinels";

interface LedgerDrawerProps {
  userId: string | null;
  userName: string;
  onClose: () => void;
}

/** 余额流水抽屉（ADR-023：流水入口在用户管理）；账本类型/文案复用 governance/ledger-meta。 */
export function LedgerDrawer({ userId, userName, onClose }: LedgerDrawerProps) {
  const [kind, setKind] = useState<string>(SELECT_ALL_VALUE);
  const ledger = useQuery({
    queryKey: ["user-ledger", userId],
    queryFn: () =>
      apiList<LedgerEntry>(
        "/admin/users/" + (userId ?? "") + "/ledger?page_size=" + LEDGER_PAGE_SIZE + "&offset=0",
      ),
    enabled: userId !== null,
  });

  const entries = ledger.data?.items ?? [];
  const filtered = useMemo(
    () => (kind === SELECT_ALL_VALUE ? entries : entries.filter((entry) => entry.kind === kind)),
    [entries, kind],
  );

  return (
    <Sheet
      open={userId !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent className="flex flex-col gap-3 sm:max-w-xl" showCloseButton={false}>
        <SheetHeader className="pr-8">
          <SheetTitle>余额流水 · {userName}</SheetTitle>
          <SheetDescription>预付余额的全部入账/扣减记录，最近 {LEDGER_PAGE_SIZE} 条。</SheetDescription>
        </SheetHeader>

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
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>

        {ledger.isError ? (
          <p className="text-2xs text-danger-text">账本读取失败：{(ledger.error as Error).message}（可点「刷新」重试）</p>
        ) : ledger.isPending ? (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Empty text={entries.length === 0 ? "该用户还没有账本记录" : "该类型下没有记录"} />
        ) : (
          <TableWrap className="max-h-[70vh] overflow-y-auto rounded-md border border-border">
            <Table>
              <THead>
                <TR>
                  <TH>时间</TH>
                  <TH>类型</TH>
                  <TH className="text-right">变动</TH>
                  <TH className="text-right">变动后余额</TH>
                  <TH>备注</TH>
                  <TH>操作人</TH>
                </TR>
              </THead>
              <tbody>
                {filtered.map((entry: LedgerEntry) => (
                  <TR key={entry.id}>
                    <TD className="tnum whitespace-nowrap text-2xs">{fmtMs(entry.created_at_ms)}</TD>
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
                    <TD className="tnum whitespace-nowrap text-right">{fmtCny(entry.balance_after_micro)}</TD>
                    <TD className="text-2xs text-body">{entry.note || "—"}</TD>
                    <TD className="text-2xs text-faint">{entry.created_by || "—"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </SheetContent>
    </Sheet>
  );
}
