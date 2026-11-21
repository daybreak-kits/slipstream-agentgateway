import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "@/lib/notify";

import { DataTable } from "@/components/data-table";
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
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { PAGE_SIZE_OPTIONS } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { ACTION_ICONS } from "@/lib/icons";
import { formatDateTime, useTimezone } from "@/lib/time";
import { usePermissions } from "@/lib/permissions";
import { partitionClosedLast } from "@/lib/table-order";
import type { TableRowTone } from "@/lib/table-columns";
import { API_STYLE_LABELS, probeStatusView, upstreamRoutingHref, type UpstreamRow } from "@/components/upstreams/shared";
import type { UpstreamBatchResult, Vendor } from "@/types";
import { PageHeader } from "@/components/layout/page-header";

type BatchAction = "enable" | "disable" | "delete";

const BATCH_LABEL: Record<BatchAction, string> = {
  enable: "批量启用",
  disable: "批量关闭",
  delete: "批量删除",
};

/** W6 ticket 11（user story 43）：关闭上游行微灰。模块作用域：组件内新建函数会让
 * DataTable 的数据 memo 失效（autoReset 循环）。 */
function upstreamRowTone(row: UpstreamRow): TableRowTone | undefined {
  return row.enabled ? undefined : "neutral";
}

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
  // W6 ticket 11（user story 41）：server 分页模式 DataTable 只见当前页，关闭行置尾必须
  // 在页面层先对全量筛选结果分区、再切片——关闭上游整体沉到最后一页，而不是只沉当前页尾部。
  const pagedRows = useMemo(
    () =>
      partitionClosedLast(rows, (row) => !row.enabled).slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize,
      ),
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

  // 「无数据 / 无匹配」双空态：由筛选结果决定文案与 CTA（保持迁移前行为）。
  const noMatch = allItems.length > 0 && rows.length === 0;

  /** DataTable 列定义：对齐镜像走 meta.className（头身同用）；操作列冻结走 sticky right-0（四期 §2）。 */
  const columns: ColumnDef<UpstreamRow, unknown>[] = [
    {
      id: "select",
      enableSorting: false,
      meta: { hideable: false },
      header: () => (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={() => toggleAll()}
          aria-label="全选当前页"
        />
      ),
      cell: ({ row }) => (
        // 阻止冒泡到行点击（整行进入编辑），勾选框只管选择。
        <span className="block" onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={selected.has(row.original.id)}
            onCheckedChange={() => toggleRow(row.original.id)}
            aria-label={"选择 " + row.original.name}
          />
        </span>
      ),
    },
    {
      id: "name",
      accessorKey: "name",
      header: "名称",
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div>
            <div className="flex items-center gap-2">
              <Link
                to={"/upstreams/" + item.id}
                className="font-medium text-primary-text hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {item.name}
              </Link>
              {!item.enabled ? <Badge tone="warning">已关闭</Badge> : null}
            </div>
            <div className="text-2xs text-faint">{vendorName(item.vendor_id)}</div>
          </div>
        );
      },
    },
    {
      id: "type",
      accessorKey: "api_style",
      header: "类型",
      enableSorting: false,
      cell: ({ row }) => (
        <Badge tone="info">{API_STYLE_LABELS[row.original.api_style] ?? row.original.api_style}</Badge>
      ),
    },
    {
      id: "keyCount",
      accessorKey: "key_count",
      header: "密钥数",
      enableSorting: false,
      meta: { className: "text-right" },
      cell: ({ row }) => {
        const keyCount = row.original.key_count ?? 0;
        if (keyCount > 0) return <span className="tnum text-2sm">{keyCount}</span>;
        // 旧库未迁移：密钥仍在退役列 api_key_enc，读取路径不再回退伪造「默认密钥」行（item 7）。
        return (
          <span className="inline-flex flex-col items-end gap-0.5">
            <span className="tnum text-2sm">0</span>
            <span
              className="text-2xs text-warning-text"
              title="旧库未迁移密钥行：运行 api/scripts/migrate_multikey_v2.py 后可在此管理密钥"
            >
              旧库需运行 migrate_multikey_v2
            </span>
          </span>
        );
      },
    },
    {
      id: "modelCount",
      accessorKey: "model_count",
      header: "模型数",
      enableSorting: false,
      meta: { className: "text-right" },
      cell: ({ row }) => <span className="tnum text-2sm">{row.original.model_count ?? 0}</span>,
    },
    {
      id: "probe",
      header: "最近探测",
      enableSorting: false,
      cell: ({ row }) => {
        const probe = row.original.last_probe;
        if (!probe) return <span className="text-faint">-</span>;
        const probeStatus = probeStatusView(probe.status);
        return (
          <div>
            <div className="flex items-center gap-2">
              <Badge tone={probeStatus.tone}>{probeStatus.label}</Badge>
              <span className="tnum text-2xs text-body">{probe.latency_ms} ms</span>
            </div>
            <div className="tnum text-2xs text-faint">{formatDateTime(probe.tested_at_ms, timezone)}</div>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "操作",
      enableSorting: false,
      meta: {
        // 操作列 = 最后一列 + 尾部冻结（DESIGN-AUDIT 四期 §2 / W5 D1）：align/sticky 由 lib/table-columns
        // 统一给 th 与 td 上类（不透明底 + 左分割阴影 + 行悬浮同步），窄屏横向滚动时仍可见。
        hideable: false,
        sticky: "right",
      },
      cell: ({ row }) => {
        const item = row.original;
        // 阻止冒泡到行点击：按钮动作不触发整行进入编辑。
        return (
          <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
            <ActionButton
              action={item.enabled ? "disable" : "enable"}
              size="dense"
              disabled={toggle.isPending || !canWrite}
              onClick={() => toggle.mutate(item)}
            >
              {item.enabled ? "关闭" : "启用"}
            </ActionButton>
            {/* W5 ticket 07：列表行内「测试」只做快速跳转——串行测试搬进详情「路由与模型」，
                不再点一行就全局 pending 灰掉所有行。 */}
            <ActionButton
              action="testConnection"
              size="dense"
              title="打开该上游的「路由与模型」页签执行模型探测"
              onClick={() => navigate(upstreamRoutingHref(item.id))}
            >
              测试
            </ActionButton>
            <ActionButton action="edit" size="dense" onClick={() => openEditor(item)}>
              编辑
            </ActionButton>
            <ActionButton
              action="delete"
              size="dense"
              disabled={!canWrite}
              onClick={() => setDeleting(item)}
            >
              删除
            </ActionButton>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="上游渠道"
        description="管理供应商连接、密钥与连通性；关闭或冷却会直接影响路由可用性。"
      />
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
              <ActionButton
                action="enable"
                variant="outline"
                disabled={batch.isPending || !canWrite}
                onClick={() => batch.mutate({ ids: Array.from(selected), action: "enable" })}
              >
                批量启用
              </ActionButton>
              <ActionButton
                action="disable"
                variant="outline"
                disabled={batch.isPending || !canWrite}
                onClick={() => batch.mutate({ ids: Array.from(selected), action: "disable" })}
              >
                批量关闭
              </ActionButton>
              <ActionButton
                action="delete"
                disabled={batch.isPending || !canWrite}
                onClick={() => setBatchDelete(true)}
              >
                批量删除
              </ActionButton>
              <Button variant="ghost" size="sm" disabled={batch.isPending} onClick={() => setSelected(new Set())}>
                <ACTION_ICONS.clear className="h-3.5 w-3.5" /> 清除选择
              </Button>
            </>
          ) : null}
          <Button size="sm" disabled={!canWrite} onClick={() => navigate("/upstreams/new")}>
            <ACTION_ICONS.add className="h-3.5 w-3.5" /> 新建上游渠道
          </Button>
        </div>
      </div>

      {/* 裸表迁移到 DataTable（W4-A1）：列设置 + 持久化 + 内部滚动；分页/筛选行为保持不变 ——
          页面自持 search/status 筛选与 page/pageSize 状态，经 server 分页模式只下发当前页。 */}
      <DataTable
        columns={columns}
        data={pagedRows}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        emptyText={noMatch ? "没有匹配的上游渠道" : "暂无上游渠道"}
        emptyDescription={
          noMatch
            ? "换个关键词，或清除筛选条件重试。"
            : "先建一个上游渠道：填连接地址、选协议风格（推荐自动探测）、登记第一把密钥。"
        }
        emptyAction={
          noMatch ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>清除筛选</Button>
          ) : canWrite ? (
            <Button size="sm" onClick={() => navigate("/upstreams/new")}>
              <ACTION_ICONS.add className="h-3.5 w-3.5" /> 新建上游渠道
            </Button>
          ) : undefined
        }
        onRowClick={openEditor}
        storageKey="slipstream.cols.upstreams"
        rowTone={upstreamRowTone}
        paging={{
          mode: "server",
          offset: (currentPage - 1) * pageSize,
          pageSize,
          total: rows.length,
          onOffsetChange: (offset) => setPage(Math.floor(offset / pageSize) + 1),
          onPageSizeChange: (size) => setPageSize(size),
        }}
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
