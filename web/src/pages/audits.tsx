import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api, ENDPOINTS } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import type { AuditLog, AuditLogList } from "@/types";
import { PageHeader } from "@/components/layout/page-header";

/**
 * 审计（统一列表规范）：actor/action 下拉筛选 + 统一表列 + 行详情抽屉（detail JSON
 * 美化懒序列化）+ 服务端分页。时间范围筛选不做：GET /admin/audit-logs 只有
 * actor/action 两个子串过滤参数，前端单页过滤会破坏服务端分页的正确性。
 */

const SAMPLE_LIMIT = 200;

/** 审计样本（最新 N 条）：只为拉取 actor/action 下拉的候选值。 */
function useAuditOptions() {
  const sample = useQuery({
    queryKey: ["audit-logs", "options"],
    queryFn: () => api.get<AuditLogList>(ENDPOINTS.auditLogs + "?limit=" + SAMPLE_LIMIT),
    staleTime: 60_000,
  });
  const distinct = (values: string[]) => [...new Set(values.filter((v) => v.length > 0))].sort();
  return {
    actors: distinct((sample.data?.items ?? []).map((item) => item.actor)),
    actions: distinct((sample.data?.items ?? []).map((item) => item.action)),
  };
}

/** detail JSON 美化：只在抽屉目标变化时算一次；非 JSON 原样展示。 */
function prettyDetail(raw: string): string {
  if (!raw || raw.trim().length === 0) return "（无详情）";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function AuditDetailDrawer({ row, open, onOpenChange }: {
  row: AuditLog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pretty = useMemo(() => prettyDetail(row?.detail ?? ""), [row?.detail]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="lg" className="flex w-full flex-col gap-0 overflow-hidden">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-mono">{row?.action ?? "-"}</span>
            <Badge tone="neutral">{row?.actor ?? "-"}</Badge>
          </SheetTitle>
          <SheetDescription className="text-2xs">
            对象 {row?.target || "-"} · {fmtTime(row?.created_at ?? null)}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <p className="mb-1 text-2xs text-faint">详情（JSON）</p>
          <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-2 font-mono text-2xs leading-5 text-body">
            {pretty}
          </pre>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AuditLogsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [actor, setActor] = useState("all");
  const [action, setAction] = useState("all");
  const [detailRow, setDetailRow] = useState<AuditLog | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { actors, actions } = useAuditOptions();
  const filtered = actor !== "all" || action !== "all";

  const { data, isPending, isError, error, refetch } = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ["audit-logs", page, pageSize, actor, action],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      if (actor !== "all") params.set("actor", actor);
      if (action !== "all") params.set("action", action);
      return api.get<AuditLogList>(ENDPOINTS.auditLogs + "?" + params.toString());
    },
  });

  useEffect(() => {
    if (!data) return;
    const maxPage = Math.max(0, Math.ceil(data.total / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [data, page, pageSize]);

  const openDetail = (row: AuditLog) => {
    setDetailRow(row);
    setDrawerOpen(true);
  };

  const columns: ColumnDef<AuditLog, unknown>[] = [
    {
      accessorKey: "created_at",
      header: "时间",
      cell: (c) => <span className="tnum">{fmtTime(c.row.original.created_at)}</span>,
    },
    { accessorKey: "actor", header: "操作者" },
    {
      accessorKey: "action",
      header: "动作",
      cell: (c) => <span className="font-mono text-2xs text-title">{c.row.original.action}</span>,
    },
    {
      accessorKey: "target",
      header: "对象",
      cell: (c) => (
        <span className="font-mono text-2xs text-body">{c.row.original.target || "-"}</span>
      ),
    },
    {
      accessorKey: "detail",
      header: "详情摘要",
      cell: (c) => (
        <span className="block max-w-64 truncate text-2xs text-faint">
          {c.row.original.detail || "-"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "操作",
      enableSorting: false,
      meta: { sticky: "right" },
      cell: (c) => (
        <Button variant="ghost" size="dense" onClick={() => openDetail(c.row.original)}>
          <ACTION_ICONS.view className="h-3.5 w-3.5" /> 详情
        </Button>
      ),
    },
  ];

  const clearFilters = () => {
    setActor("all");
    setAction("all");
    setPage(0);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="审计日志"
        description="记录控制面的写操作与治理动作；按操作者、动作筛选后查看详情。"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          className="w-44"
          ariaLabel="按操作者筛选"
          placeholder="全部操作者"
          searchPlaceholder="搜索操作者"
          value={actor === "all" ? "" : actor}
          options={actors.map((item) => ({ value: item, label: item }))}
          onChange={(value) => {
            setActor(value === "" ? "all" : value);
            setPage(0);
          }}
        />
        <Select
          value={action}
          onValueChange={(value) => {
            setAction(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-56" aria-label="按动作筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部动作</SelectItem>
            {actions.map((item) => (
              <SelectItem key={item} value={item}>{item}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            清除筛选
          </Button>
        )}
        <span className="ml-auto text-2xs text-faint">
          操作者 / 动作候选取自最新 {SAMPLE_LIMIT} 条审计
        </span>
      </div>

      <DataTable
        columns={columns}
        data={data?.items}
        loading={isPending}
        error={isError ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyText={filtered ? "没有匹配的审计记录" : "没有审计记录"}
        emptyAction={filtered ? <Button variant="outline" size="sm" onClick={clearFilters}>清除筛选</Button> : undefined}
        storageKey="slipstream.cols.audits"
        paging={{
          mode: "server",
          offset: page * pageSize,
          pageSize,
          total: data?.total ?? 0,
          onOffsetChange: (offset) => setPage(Math.floor(offset / pageSize)),
          onPageSizeChange: (size) => {
            setPage(0);
            setPageSize(size);
          },
        }}
      />

      <AuditDetailDrawer row={detailRow} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
