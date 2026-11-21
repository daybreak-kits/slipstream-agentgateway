import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "@/lib/notify";

import { isCooling, modelRowRank, modelRowTone, useAvailabilityMutation } from "@/components/models/availability";
import { UpstreamModelDrawer } from "@/components/models/upstream-model-drawer";
import { parameterSummary } from "@/components/models/model-vocab";
import { DataTable } from "@/components/data-table";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { fmtMarkup, fmtPricePerM } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import { usePermissions } from "@/lib/permissions";
import { SELECT_NONE_VALUE } from "@/lib/select-sentinels";
import { probeSummary, type ModelProbeController } from "./model-probe";
import { ModelProbeBadge, ModelProbeProgress } from "./model-probe-view";
import { type UpstreamRow } from "./shared";
import type { UpstreamKeyList, UpstreamModel } from "@/types";

/** Tab2 路由与模型：本上游登记的上游模型表 + 会话内模型探测（W5 ticket 07）。
 *
 *  「模型拉取」（GET /models，探测导入）与「模型探测」（POST models/probe，最小 chat）
 *  是两个独立动作；探测逐模型串行、可选密钥、可中止，结果只在本页会话内展示、不落库。 */
export function UpstreamModelsPanel({
  upstream,
  probe,
  onFetchModels,
}: {
  upstream: UpstreamRow;
  probe: ModelProbeController;
  onFetchModels: () => void;
}) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canWrite = can("upstream_models:write");
  const canCost = can("billing:cost");
  const q = useQuery({
    queryKey: ["upstream-models"],
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
  });
  const keysQ = useQuery({
    queryKey: ["upstream-keys", upstream.id],
    queryFn: () => api.get<UpstreamKeyList>(ENDPOINTS.upstreamKeys(upstream.id)),
  });
  const [drawer, setDrawer] = useState<{ open: boolean; initial: UpstreamModel | null }>({ open: false, initial: null });
  const [deleting, setDeleting] = useState<UpstreamModel | null>(null);
  // ticket 11：冷却设置进抽屉，行内只保留「解除」快捷入口。
  const availability = useAvailabilityMutation("upstream");

  // 稳定引用：TanStack Table 行模型 memo 依赖 data 引用（见 DataTable 注释）。
  const rows = useMemo(
    () => (q.data?.items ?? []).filter((model) => model.upstream_id === upstream.id),
    [q.data, upstream.id],
  );
  const keys = keysQ.data?.items ?? [];
  const summary = probeSummary(probe.session);
  const finished = !probe.session.running && probe.session.total > 0;

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
      id: "probe",
      header: "测试结果",
      cell: (c) => {
        const row = c.row.original;
        if (probe.session.running && probe.session.currentModelId === row.id) {
          return <Badge tone="info">测试中…</Badge>;
        }
        const item = probe.session.results[row.id];
        if (!item) return <span className="text-faint">—</span>;
        return <ModelProbeBadge item={item} />;
      },
    },
    {
      id: "actions",
      header: "操作",
      meta: { sticky: "right" },
      cell: (c) => {
        const row = c.row.original;
        if (!canWrite) return null;
        return (
          <div className="flex gap-1">
            <ActionButton
              action="testConnection"
              size="dense"
              disabled={probe.running}
              title="对该模型发一次最小 chat，结果仅本次会话展示"
              onClick={() => probe.run([{ id: row.id, name: row.name }])}
            >
              测试
            </ActionButton>
            <ActionButton action="edit" size="dense" onClick={() => setDrawer({ open: true, initial: row })}>
              编辑
            </ActionButton>
            <ActionButton
              action={row.enabled ? "disable" : "enable"}
              size="dense"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(row)}
            >
              {row.enabled ? "关闭" : "启用"}
            </ActionButton>
            {isCooling(row) ? (
              <ActionButton
                action="releaseCooldown"
                size="dense"
                disabled={availability.isPending}
                onClick={() => availability.mutate({ id: row.id, action: "release" })}
              >
                解除
              </ActionButton>
            ) : null}
            <ActionButton
              action="delete"
              size="dense"
              disabled={(row.target_count ?? 0) > 0}
              title={(row.target_count ?? 0) > 0 ? "被公开模型成员引用，先移除成员再删除" : undefined}
              onClick={() => setDeleting(row)}
            >
              删除
            </ActionButton>
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
          模型探测逐模型发最小 chat，结果仅本页会话内展示、不写库。
        </p>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setDrawer({ open: true, initial: null })}>
              <ACTION_ICONS.add className="h-3.5 w-3.5" /> 添加模型
            </Button>
            <ActionButton action="fetchModels" variant="outline" size="sm" onClick={onFetchModels}>
              拉取模型
            </ActionButton>
            <ActionButton
              action="testConnection"
              variant="outline"
              size="sm"
              disabled={probe.running || rows.length === 0}
              title={rows.length === 0 ? "先拉取或添加模型" : "串行测试该上游的全部模型"}
              onClick={() => probe.run(rows.map((row) => ({ id: row.id, name: row.name })))}
            >
              全部测试
            </ActionButton>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-2">
        <span className="text-2xs text-faint">测试密钥</span>
        <Select
          value={probe.keyId === "" ? SELECT_NONE_VALUE : probe.keyId}
          onValueChange={(value) => probe.setKeyId(value === SELECT_NONE_VALUE ? "" : value)}
          disabled={probe.running}
        >
          <SelectTrigger aria-label="选择测试密钥" className="h-7 w-52 text-2xs">
            <SelectValue placeholder="默认（第一把）" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SELECT_NONE_VALUE}>默认（第一把）</SelectItem>
            {keys.map((key) => (
              <SelectItem key={key.id} value={key.id}>
                {key.label || key.masked}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {keys.length === 0 ? (
          <span className="text-2xs text-faint">该上游还没有密钥，测试请求不会携带鉴权头。</span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {probe.running ? <ModelProbeProgress session={probe.session} onCancel={probe.cancel} /> : null}
          {finished ? (
            <>
              <span className="text-2xs text-body">
                本次会话：成功 <span className="tnum text-success-text">{summary.ok}</span> · 失败{" "}
                <span className="tnum text-danger-text">{summary.failed}</span> · 共{" "}
                <span className="tnum">{Object.keys(probe.session.results).length}</span>
                {probe.session.cancelled ? "（已取消）" : ""}
              </span>
              <Button variant="ghost" size="dense" onClick={probe.clear}>
                清空结果
              </Button>
            </>
          ) : null}
          {probe.session.error !== "" ? <span className="text-2xs text-danger-text">{probe.session.error}</span> : null}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        emptyText="还没有登记模型；先点「拉取模型」探测导入，或手动添加"
        filterPlaceholder="搜索模型名"
        storageKey="slipstream.cols.upstream-models"
        // W6 ticket 11：与模型管理两表同一套行语义——关闭行微灰置尾、冷却行微黄不置尾；
        // 状态列只表达启停已删除（启停按钮在操作列），冷却态经行色与「解除」按钮呈现。
        rowTone={modelRowTone}
        closedLast={modelRowRank}
      />
      {drawer.open ? (
        <UpstreamModelDrawer
          initial={drawer.initial}
          upstreams={[upstream]}
          canCost={canCost}
          onClose={() => setDrawer({ open: false, initial: null })}
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

/** 未保存草稿占位：路由与模型 / 请求与响应两个 Tab 在新建时不可用。 */
export function LockedTabNotice({ subject }: { subject: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-2/40 px-6 py-12 text-center">
      <p className="text-2sm text-body">先保存上游渠道，再配置{subject}</p>
      <p className="mt-1 text-2xs text-faint">路由与模型、改写规则都挂在已保存的上游上。</p>
    </div>
  );
}
