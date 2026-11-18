import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { PAGE_SIZE_OPTIONS, Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { formatDateTime, useTimezone } from "@/lib/time";
import { usePermissions } from "@/lib/permissions";
import { API_STYLE_LABELS, probeStatusView, type ProbeResultView, type UpstreamRow } from "@/components/upstreams/shared";
import type { UpstreamBatchResult, Vendor } from "@/types";

type BatchAction = "enable" | "disable" | "delete";

const BATCH_LABEL: Record<BatchAction, string> = {
  enable: "批量启用",
  disable: "批量关闭",
  delete: "批量删除",
};

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "关闭" },
];

/** 批量删除红色确认；超过 10 条需手动输入「删除」二字（DESIGN-AUDIT §4 三档确认）。 */
function BatchDeleteDialog({
  count,
  pending,
  onConfirm,
  onClose,
}: {
  count: number;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const needTyping = count > 10;
  const ready = !needTyping || typed.trim() === "删除";
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>批量删除 {count} 个上游渠道？</AlertDialogTitle>
          <AlertDialogDescription>
            此操作不可逆：逐项处理，被公开模型目标引用的上游会单独拒绝并保留，其余照常删除；密钥、上游模型与探测记录连带删除，历史计费流水保留。
            {needTyping ? "数量超过 10 条，请输入「删除」二字确认。" : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {needTyping ? (
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="输入「删除」以确认"
            aria-label="输入删除以确认"
            autoFocus
          />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className="bg-danger text-white hover:bg-danger/90"
            disabled={!ready || pending}
            onClick={(event) => { event.preventDefault(); onConfirm(); }}
          >
            {pending ? "删除中…" : "确认删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function UpstreamsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canWrite = can("upstreams:write");
  const { mode: timezone } = useTimezone();

  const q = useQuery({ queryKey: ["upstreams"], queryFn: () => apiList<UpstreamRow>(ENDPOINTS.upstreams) });
  const vendorsQ = useQuery({ queryKey: ["vendors"], queryFn: () => apiList<Vendor>(ENDPOINTS.vendors) });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [deleting, setDeleting] = useState<UpstreamRow | null>(null);
  const [batchDelete, setBatchDelete] = useState(false);

  const allItems = q.data?.items ?? [];
  const vendorName = (vendorId: string | null | undefined) =>
    vendorsQ.data?.items.find((vendor) => vendor.id === vendorId)?.name ?? "未分组";

  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () => allItems.filter((row) => {
      if (status === "enabled" && !row.enabled) return false;
      if (status === "disabled" && row.enabled) return false;
      if (needle === "") return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.base_url.toLowerCase().includes(needle)
      );
    }),
    [allItems, needle, status],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / Math.max(1, pageSize)));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pagedRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize],
  );

  const allSelected = pagedRows.length > 0 && pagedRows.every((row) => selected.has(row.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleRow = (rowId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pagedRows.map((row) => row.id)));
  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    setPage(1);
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["upstreams"] });
  };

  const toggle = useMutation({
    mutationFn: (upstream: UpstreamRow) =>
      api.patch<UpstreamRow>(ENDPOINTS.upstreamDetail(upstream.id), { enabled: !upstream.enabled }),
    onSuccess: (upstream) => {
      toast.success(upstream.enabled ? "上游已启用" : "上游已关闭");
      refresh();
    },
    onError: () => { /* api.ts 已统一提示 */ },
  });

  const test = useMutation({
    mutationFn: (upstream: UpstreamRow) => api.post<ProbeResultView>(ENDPOINTS.upstreamTest(upstream.id)),
    onSuccess: (result) => {
      if (result.status === "ok") {
        toast.success("连通性测试通过", { description: (result.model_count ?? 0) + " 个模型 · " + result.latency_ms + " ms" });
      } else {
        toast.error("连通性测试未通过", { description: result.message || undefined });
      }
      refresh();
    },
  });

  const del = useMutation({
    mutationFn: (upstream: UpstreamRow) => api.del<{ deleted: string }>(ENDPOINTS.upstreamDetail(upstream.id)),
    onSuccess: () => {
      toast.success("上游渠道已删除");
      setDeleting(null);
      refresh();
    },
  });

  const batch = useMutation({
    mutationFn: (vars: { ids: string[]; action: BatchAction }) =>
      api.patch<UpstreamBatchResult>(ENDPOINTS.upstreamBatch, { ids: vars.ids, action: vars.action }),
    onSuccess: (result, vars) => {
      const nameOf = (rowId: string) => allItems.find((row) => row.id === rowId)?.name ?? rowId;
      const parts = ["成功 " + result.changed.length + " 个"];
      if (result.missing.length > 0) parts.push(result.missing.length + " 个不存在");
      if (result.failed.length > 0) {
        parts.push(
          result.failed.length + " 个被拒绝：" +
          result.failed.map((item) => nameOf(item.id) + "（" + item.message + "）").join("；"),
        );
      }
      const description = parts.join("；");
      if (result.failed.length > 0) toast.warning(BATCH_LABEL[vars.action] + "部分完成", { description });
      else toast.success(BATCH_LABEL[vars.action] + "完成", { description });
      setSelected(new Set());
      setBatchDelete(false);
      refresh();
    },
    onError: () => { /* api.ts 已统一提示 */ },
  });

  const openEditor = (row: UpstreamRow) => navigate("/upstreams/" + row.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索名称或连接地址"
          aria-label="搜索名称或连接地址"
          className="max-w-64"
        />
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
          <SelectTrigger className="w-28" aria-label="按状态筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {selected.size > 0 ? (
            <>
              <span className="text-2xs text-faint">已选 <span className="tnum font-medium text-title">{selected.size}</span></span>
              <Button variant="outline" size="sm" disabled={batch.isPending || !canWrite} onClick={() => batch.mutate({ ids: Array.from(selected), action: "enable" })}>
                批量启用
              </Button>
              <Button variant="outline" size="sm" disabled={batch.isPending || !canWrite} onClick={() => batch.mutate({ ids: Array.from(selected), action: "disable" })}>
                批量关闭
              </Button>
              <Button variant="ghost" size="sm" className="text-danger-text" disabled={batch.isPending || !canWrite} onClick={() => setBatchDelete(true)}>
                批量删除
              </Button>
              <Button variant="ghost" size="sm" disabled={batch.isPending} onClick={() => setSelected(new Set())}>
                清除选择
              </Button>
            </>
          ) : null}
          <Button size="sm" disabled={!canWrite} onClick={() => navigate("/upstreams/new")}>
            <Plus className="h-3.5 w-3.5" /> 新建上游渠道
          </Button>
        </div>
      </div>

      <TableWrap className="rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            <tr>
              <TH className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={() => toggleAll()}
                  aria-label="全选当前页"
                />
              </TH>
              <TH>名称</TH>
              <TH>类型</TH>
              <TH className="text-right">密钥数</TH>
              <TH className="text-right">模型数</TH>
              <TH>最近探测</TH>
              <TH>操作</TH>
            </tr>
          </THead>
          <tbody data-testid="upstream-table-body">
            {q.isPending ? (
              Array.from({ length: 5 }, (_, index) => (
                <TR key={index}>
                  {["w-10", "", "", "text-right", "text-right", "", ""].map((cell, cellIndex) => (
                    <TD key={cellIndex} className={cell}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </TD>
                  ))}
                </TR>
              ))
            ) : q.isError ? (
              <tr>
                <td colSpan={7}>
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <p className="text-sm text-danger-text">加载失败：{(q.error as Error).message}</p>
                    <Button variant="outline" size="sm" onClick={() => void q.refetch()}>重试</Button>
                  </div>
                </td>
              </tr>
            ) : allItems.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty
                    title="暂无上游渠道"
                    description="先建一个上游渠道：填连接地址、选协议风格（推荐自动探测）、登记第一把密钥。"
                    action={canWrite ? (
                      <Button size="sm" onClick={() => navigate("/upstreams/new")}>新建上游渠道</Button>
                    ) : undefined}
                  />
                </td>
              </tr>
            ) : pagedRows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty
                    title="没有匹配的上游渠道"
                    description="换个关键词，或清除筛选条件重试。"
                    action={<Button variant="outline" size="sm" onClick={clearFilters}>清除筛选</Button>}
                  />
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => {
                const probe = row.last_probe;
                const probeStatus = probeStatusView(probe?.status);
                return (
                  <TR key={row.id} className="cursor-pointer transition-colors hover:bg-surface-2" onClick={() => openEditor(row)}>
                    <TD onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleRow(row.id)}
                        aria-label={"选择 " + row.name}
                      />
                    </TD>
                    <TD onClick={(event) => event.stopPropagation()}>
                      <div>
                        <div className="flex items-center gap-2">
                          <Link
                            to={"/upstreams/" + row.id}
                            className="font-medium text-primary-text hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {row.name}
                          </Link>
                          {!row.enabled ? <Badge tone="neutral">已关闭</Badge> : null}
                        </div>
                        <div className="text-2xs text-faint">{vendorName(row.vendor_id)}</div>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone="info">{API_STYLE_LABELS[row.api_style] ?? row.api_style}</Badge>
                    </TD>
                    <TD className="text-right"><span className="tnum text-2sm">{row.key_count ?? 0}</span></TD>
                    <TD className="text-right"><span className="tnum text-2sm">{row.model_count ?? 0}</span></TD>
                    <TD>
                      {probe ? (
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge tone={probeStatus.tone}>{probeStatus.label}</Badge>
                            <span className="tnum text-2xs text-body">{probe.latency_ms} ms</span>
                          </div>
                          <div className="tnum text-2xs text-faint">{formatDateTime(probe.tested_at_ms, timezone)}</div>
                        </div>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </TD>
                    <TD onClick={(event) => event.stopPropagation()}>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="ghost"
                          size="dense"
                          disabled={toggle.isPending || !canWrite}
                          onClick={() => toggle.mutate(row)}
                        >
                          {row.enabled ? "关闭" : "启用"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="dense"
                          disabled={test.isPending || !canWrite}
                          title={test.isPending && test.variables?.id === row.id ? "测试中…" : undefined}
                          onClick={() => test.mutate(row)}
                        >
                          {test.isPending && test.variables?.id === row.id ? "测试中…" : "测试连接"}
                        </Button>
                        <Button variant="ghost" size="dense" onClick={() => openEditor(row)}>编辑</Button>
                        <Button
                          variant="ghost"
                          size="dense"
                          className="text-danger-text"
                          disabled={!canWrite}
                          onClick={() => setDeleting(row)}
                        >
                          删除
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })
            )}
          </tbody>
        </Table>
      </TableWrap>

      <Pagination
        page={currentPage}
        pageSize={pageSize}
        total={rows.length}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        className="rounded-lg border border-border bg-surface"
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title={"删除上游渠道 " + (deleting?.name ?? "") + "？"}
        description="连带删除该上游的全部密钥、上游模型与探测记录；被公开模型目标引用的上游会被拒绝删除。此操作不可逆。"
        confirmLabel="确认删除"
        destructive
        onConfirm={() => { if (deleting !== null) del.mutate(deleting); }}
      />

      {batchDelete ? (
        <BatchDeleteDialog
          count={selected.size}
          pending={batch.isPending}
          onConfirm={() => batch.mutate({ ids: Array.from(selected), action: "delete" })}
          onClose={() => setBatchDelete(false)}
        />
      ) : null}
    </div>
  );
}
