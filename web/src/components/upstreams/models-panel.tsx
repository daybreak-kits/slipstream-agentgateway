import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "@/lib/notify";

import { UpstreamModelDialog } from "@/components/models/upstream-model-dialog";
import { parameterSummary } from "@/components/models/model-vocab";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { fmtMarkup, fmtPricePerM } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import { usePermissions } from "@/lib/permissions";
import { type UpstreamRow } from "./shared";
import type { UpstreamModel } from "@/types";

/** Tab2 路由与映射：本上游登记的上游模型表。
 *  说明：后端只有上游级 test-connection，没有模型级探测；「探测」列如实展示上游级最近探测。
 *  编辑弹窗与模型管理页共用同一实现（W4-C 归一，字段全集 + upstream_models:write 门禁）。 */
export function UpstreamModelsPanel({ upstream }: { upstream: UpstreamRow }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canWrite = can("upstream_models:write");
  const canCost = can("billing:cost");
  const q = useQuery({
    queryKey: ["upstream-models"],
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
  });
  const [dialog, setDialog] = useState<{ open: boolean; initial: UpstreamModel | null }>({ open: false, initial: null });
  const [deleting, setDeleting] = useState<UpstreamModel | null>(null);

  // 稳定引用：TanStack Table 行模型 memo 依赖 data 引用（见 DataTable 注释）。
  const rows = useMemo(
    () => (q.data?.items ?? []).filter((model) => model.upstream_id === upstream.id),
    [q.data, upstream.id],
  );

  const toggle = useMutation({
    mutationFn: (model: UpstreamModel) =>
      api.patch<UpstreamModel>(ENDPOINTS.upstreamModelUpdate(model.id), { enabled: !model.enabled }),
    onSuccess: (model) => {
      toast.success(model.enabled ? "模型已启用" : "模型已关闭");
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
    },
  });

  const del = useMutation({
    mutationFn: (model: UpstreamModel) => api.del<void>(ENDPOINTS.upstreamModelUpdate(model.id)),
    onSuccess: () => {
      toast.success("模型已删除");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      void qc.invalidateQueries({ queryKey: ["upstream", upstream.id] });
    },
  });

  const probe = upstream.last_probe;
  const probeBadge = probe ? (
    <Badge tone={probe.status === "ok" ? "success" : probe.status === "timeout" ? "warning" : "danger"}>
      {probe.status === "ok" ? "连通" : probe.status === "timeout" ? "超时" : "失败"}
    </Badge>
  ) : (
    <Badge tone="neutral">未测试</Badge>
  );

  const columns: ColumnDef<UpstreamModel, unknown>[] = [
    {
      accessorKey: "name",
      header: "上游模型",
      cell: (c) => <span className="tnum font-medium text-title">{c.row.original.name}</span>,
    },
    {
      accessorKey: "model_type",
      header: "类型",
      cell: (c) => <Badge tone="info">{c.row.original.model_type}</Badge>,
    },
    {
      id: "params",
      header: "参数摘要",
      cell: (c) => <span className="text-2xs text-body">{parameterSummary(c.row.original)}</span>,
    },
    {
      id: "price",
      header: "进价（入 · 出 · 倍率）",
      cell: (c) => (
        <span className="tnum text-2sm text-body">
          {fmtPricePerM(c.row.original.cost_input_per_1m)} · {fmtPricePerM(c.row.original.cost_output_per_1m)} · {fmtMarkup(c.row.original.markup)}
        </span>
      ),
    },
    {
      accessorKey: "enabled",
      header: "状态",
      cell: (c) =>
        // 「关闭」语义色 warning（DESIGN-AUDIT 四期 §16 / W4-A1）：中性灰不表达「被人为关闭」的警示。
        c.row.original.enabled ? <Badge tone="success">启用</Badge> : <Badge tone="warning">关闭</Badge>,
    },
    {
      id: "probe",
      header: "探测",
      cell: () => probeBadge,
    },
    {
      id: "actions",
      header: "操作",
      meta: { sticky: "right" },
      cell: (c) => {
        const row = c.row.original;
        if (!canWrite) return null;
        return (
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="dense" onClick={() => setDialog({ open: true, initial: row })}>
              <ACTION_ICONS.edit className="h-3.5 w-3.5" /> 编辑
            </Button>
            <Button variant="ghost" size="dense" disabled={toggle.isPending} onClick={() => toggle.mutate(row)}>
              {row.enabled ? <ACTION_ICONS.disable className="h-3.5 w-3.5" /> : <ACTION_ICONS.enable className="h-3.5 w-3.5" />}
              {row.enabled ? "关闭" : "启用"}
            </Button>
            <Button
              variant="ghost"
              size="dense"
              className="text-danger-text"
              disabled={(row.target_count ?? 0) > 0}
              title={(row.target_count ?? 0) > 0 ? "被公开模型成员引用，先移除成员再删除" : undefined}
              onClick={() => setDeleting(row)}
            >
              <ACTION_ICONS.delete className="h-3.5 w-3.5" /> 删除
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-faint">
          已接入 <span className="tnum">{rows.length}</span> 个模型；公开模型通过成员引用这里的行。
          探测列为上游级连通状态（后端仅提供上游级测试连接，没有模型级探测）。
        </p>
        {canWrite ? (
          <Button size="sm" onClick={() => setDialog({ open: true, initial: null })}>
            <ACTION_ICONS.add className="h-3.5 w-3.5" /> 添加模型
          </Button>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        emptyText="还没有登记模型；用页头「获取上游模型」探测导入，或手动添加"
        filterPlaceholder="搜索模型名"
        storageKey="slipstream.cols.upstream-models"
      />
      {dialog.open ? (
        <UpstreamModelDialog
          initial={dialog.initial}
          upstreams={[upstream]}
          canCost={canCost}
          onClose={() => setDialog({ open: false, initial: null })}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["upstreams"] });
            void qc.invalidateQueries({ queryKey: ["upstream", upstream.id] });
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title={"删除上游模型 " + (deleting?.name ?? "") + "？"}
        description="被公开模型引用的模型不能删除；历史计费流水保留。此操作不可逆。"
        confirmLabel="确认删除"
        destructive
        onConfirm={() => { if (deleting !== null) del.mutate(deleting); }}
      />
    </div>
  );
}

/** 未保存草稿占位：路由与映射 / 请求与响应两个 Tab 在新建时不可用。 */
export function LockedTabNotice({ subject }: { subject: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-2/40 px-6 py-12 text-center">
      <p className="text-2sm text-body">先保存上游渠道，再配置{subject}</p>
      <p className="mt-1 text-2xs text-faint">路由与映射、改写规则都挂在已保存的上游上。</p>
    </div>
  );
}
