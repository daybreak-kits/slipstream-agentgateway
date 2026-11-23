import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "@/lib/notify";

import {
  coolingUntil, isCooling, modelRowRank, modelRowTone, modelStatusKind, useAvailabilityMutation,
} from "@/components/models/availability";
import { UpstreamModelDrawer } from "@/components/models/upstream-model-drawer";
import { ModelParamsCell } from "@/components/models/model-params-cell";
import { DataTable } from "@/components/data-table";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusIcon } from "@/components/ui/status-icon";
import { ResultCell } from "@/components/ui/table";
import { controlPlane } from "@/lib/control-plane";
import { fmtInt, fmtMarkup, fmtPricePerM } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import { usePermissions } from "@/lib/permissions";
import { formatDateTime, useTimezone } from "@/lib/time";
import { probeSummary, type ModelProbeController } from "./model-probe";
import type { ModelTestResultItem } from "@/lib/control-plane/operations/upstreams";
import { ModelProbeBadge, ModelProbeProgress } from "./model-probe-view";
import { type UpstreamRow } from "./shared";
import type { UpstreamModel } from "@/types";

/** Tab2 路由与模型：本上游登记的上游模型表 + 会话内模型探测（W5 ticket 07）。
 *
 *  「模型拉取」（GET /models，探测导入）与「模型探测」（POST models/probe，最小 chat）
 *  是两个独立动作；探测逐模型串行、可选密钥、可中止，结果只在本页会话内展示、不落库。 */
/** 日志回读结果 → 本页徽章的展示形状。 */
function persistedToProbeItem(item: ModelTestResultItem) {
  return {
    model_id: item.model_id,
    model: item.model,
    ok: item.ok,
    status: item.status,
    latency_ms: item.latency_ms,
    error_type: item.ok ? "" : item.status >= 400 ? "http" : "connection",
    message: item.error,
  };
}

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
    queryFn: () => controlPlane.models.listUpstreamModels(),
  });
  const { mode: timezone } = useTimezone();
  const resultsQ = useQuery({
    queryKey: ["model-test-results", upstream.id],
    queryFn: () => controlPlane.upstreams.listModelTestResults(upstream.id),
    refetchInterval: 60_000,
  });
  const [drawer, setDrawer] = useState<{ open: boolean; initial: UpstreamModel | null }>({ open: false, initial: null });
  const [deleting, setDeleting] = useState<UpstreamModel | null>(null);
  // ticket 11：冷却设置进抽屉，行内只保留「解除」快捷入口。
  const availability = useAvailabilityMutation("upstream");

  // 稳定引用：TanStack Table 行模型 memo 依赖 data 引用（见 DataTable 注释）。
  const rows = useMemo(
    () => (q.data ?? []).filter((model) => model.upstream_id === upstream.id),
    [q.data, upstream.id],
  );
  const summary = probeSummary(probe.session);
  const finished = !probe.session.running && probe.session.total > 0;
  const persistedByModel = useMemo(
    () => new Map((resultsQ.data?.items ?? []).map((item) => [item.model_id, item] as const)),
    [resultsQ.data],
  );
  // 运行结束后回读一次日志，刷新后仍能看到最近一次测试结果。
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !probe.session.running) {
      void qc.invalidateQueries({ queryKey: ["model-test-results", upstream.id] });
    }
    wasRunning.current = probe.session.running;
  }, [probe.session.running, qc, upstream.id]);

  const toggle = useMutation({
    mutationFn: (model: UpstreamModel) =>
      controlPlane.models.updateUpstreamModel(model.id, { enabled: !model.enabled }),
    onSuccess: (model) => {
      toast.success(model.enabled ? "模型已启用" : "模型已关闭");
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
    },
  });

  const del = useMutation({
    mutationFn: (model: UpstreamModel) => controlPlane.models.removeUpstreamModel(model.id),
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
      // W7 t10：与模型管理页同一口径——非正常状态的名字旁出状态图标（normal 不出图标）。
      cell: (c) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="tnum font-medium text-title">{c.row.original.name}</span>
          <StatusIcon kind={modelStatusKind(c.row.original)} cooldownUntilMs={coolingUntil(c.row.original)} />
        </span>
      ),
    },
    {
      accessorKey: "model_type",
      header: "类型",
      // W8 t03：table-fixed 下由列定义写死宽度，内容（型号长短）不再改变列宽。
      meta: { width: "8rem" },
      cell: (c) => <Badge tone="info">{c.row.original.model_type}</Badge>,
    },
    {
      id: "params",
      header: "参数",
      meta: { width: "12rem" },
      // W7 t09：与模型管理页同一口径——列里只留输入/输出上限，其余进悬浮详情。
      cell: (c) => <ModelParamsCell row={c.row.original} />,
    },
    {
      id: "price",
      header: "进价（入 · 出 · 倍率）",
      meta: { width: "10rem" },
      cell: (c) => (
        <span className="tnum text-2sm text-body">
          {fmtPricePerM(c.row.original.cost_input_per_1m)} · {fmtPricePerM(c.row.original.cost_output_per_1m)} · {fmtMarkup(c.row.original.markup)}
        </span>
      ),
    },
    {
      id: "probe",
      header: "测试结果",
      meta: { width: "11rem" },
      // W8 t03：三态共用固定两行槽位（运行中/无结果/有结果），结果出现时行高与列宽不变。
      cell: (c) => {
        const row = c.row.original;
        if (probe.session.running && probe.session.currentModelId === row.id) {
          return (
            <ResultCell primary={<Badge tone="info">测试中…</Badge>} />
          );
        }
        const sessionItem = probe.session.results[row.id];
        const persistedItem = persistedByModel.get(row.id);
        const item = sessionItem ?? (persistedItem ? persistedToProbeItem(persistedItem) : undefined);
        if (!item) return <ResultCell primary={<span className="text-faint">未测试</span>} />;
        const title = sessionItem
          ? "本次会话测试结果"
          : persistedItem
            ? "最近一次 " + formatDateTime(persistedItem.started_at_ms, timezone) +
              " · 输入 " + fmtInt(persistedItem.input_tokens) + " / 输出 " + fmtInt(persistedItem.output_tokens) + " tokens"
            : undefined;
        return (
          <span title={title}>
            <ModelProbeBadge item={item} />
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "操作",
      // W9：auto 布局操作列按内容 max-content 收缩（按钮组真实宽度）。
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
              title="对该模型发一次最小 chat，结果写入使用日志，刷新后仍显示最近一次"
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
          模型测试逐模型经数据面发最小 chat，结果写入使用日志；刷新后仍显示最近一次测试结果。
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
        <span className="text-2xs text-faint">测试请求使用内置“测试专用”凭据，结果写入使用日志。</span>
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
