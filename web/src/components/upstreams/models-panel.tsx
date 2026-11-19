import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { ACTION_ICONS } from "@/lib/icons";
import { costText, markupText, MODEL_TYPE_OPTIONS, type UpstreamRow } from "./shared";
import type { ModelParameters, UpstreamModel } from "@/types";

/** 能力位摘要：输入类型 → 输出类型 · 能力（与模型管理页同一口径）。 */
function parameterSummary(parameters?: ModelParameters): string {
  if (!parameters) return "—";
  const input = parameters.input_types.length > 0 ? parameters.input_types.join("/") : "—";
  const output = parameters.output_types.length > 0 ? parameters.output_types.join("/") : "—";
  const caps: string[] = [];
  if (parameters.tool_call) caps.push("工具");
  if (parameters.reasoning) caps.push("推理");
  if (parameters.structured_output) caps.push("结构化");
  return input + " → " + output + (caps.length > 0 ? " · " + caps.join("/") : "");
}

/** 添加 / 编辑上游模型弹窗：模型名 + 类型 + 进价（入 / 出 / 倍率），留空 = 不修改。 */
function ModelDialog({
  upstreamId,
  initial,
  onClose,
}: {
  upstreamId: string;
  initial: UpstreamModel | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = initial !== null;
  const [name, setName] = useState(initial?.name ?? "");
  const [modelType, setModelType] = useState(initial?.model_type ?? "chat");
  const [costIn, setCostIn] = useState(initial?.cost_input_per_1m ?? "");
  const [costOut, setCostOut] = useState(initial?.cost_output_per_1m ?? "");
  const [markup, setMarkup] = useState(initial?.markup ?? "");

  const numericOrUndefined = (value: string): string | undefined => {
    const text = value.trim();
    if (text === "") return undefined;
    return Number.isNaN(Number(text)) ? "" : text;
  };
  const badNumber = [costIn, costOut, markup].some((value) => {
    const text = value.trim();
    return text !== "" && Number.isNaN(Number(text));
  });

  const save = useMutation({
    mutationFn: () => {
      if (isEdit && initial) {
        const patch: Record<string, unknown> = { name: name.trim(), model_type: modelType };
        const cin = numericOrUndefined(costIn);
        const cout = numericOrUndefined(costOut);
        const mk = numericOrUndefined(markup);
        if (cin !== undefined) patch.cost_input_per_1m = cin;
        if (cout !== undefined) patch.cost_output_per_1m = cout;
        if (mk !== undefined) patch.markup = mk;
        return api.patch<UpstreamModel>(ENDPOINTS.upstreamModelUpdate(initial.id), patch);
      }
      return api.post<UpstreamModel>(ENDPOINTS.upstreamModelCreate, {
        upstream_id: upstreamId,
        name: name.trim(),
        model_type: modelType,
        ...(costIn.trim() !== "" ? { cost_input_per_1m: costIn.trim() } : {}),
        ...(costOut.trim() !== "" ? { cost_output_per_1m: costOut.trim() } : {}),
        ...(markup.trim() !== "" ? { markup: markup.trim() } : {}),
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "模型已更新" : "模型已登记");
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      void qc.invalidateQueries({ queryKey: ["upstreams"] });
      void qc.invalidateQueries({ queryKey: ["upstream", upstreamId] });
      onClose();
    },
  });

  const canSave = name.trim() !== "" && !badNumber;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑模型 " + initial.name : "添加模型"}</DialogTitle>
          <DialogDescription>
            上游模型是发给上游的原始名称；进价为元 / 1M 词元，倍率 = 花费 ÷ 成本，价格也可在价目管理维护。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field>
            <FieldLabel htmlFor="up-model-name">模型名</FieldLabel>
            <Input id="up-model-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 gpt-5-mini" className="font-mono" />
          </Field>
          <Field>
            <FieldLabel>类型</FieldLabel>
            <Select value={modelType} onValueChange={setModelType}>
              <SelectTrigger aria-label="模型类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field>
              <FieldLabel htmlFor="up-model-cost-in">进价·输入</FieldLabel>
              <Input id="up-model-cost-in" inputMode="decimal" value={costIn} onChange={(e) => setCostIn(e.target.value)} placeholder="元 / 1M" />
            </Field>
            <Field>
              <FieldLabel htmlFor="up-model-cost-out">进价·输出</FieldLabel>
              <Input id="up-model-cost-out" inputMode="decimal" value={costOut} onChange={(e) => setCostOut(e.target.value)} placeholder="元 / 1M" />
            </Field>
            <Field>
              <FieldLabel htmlFor="up-model-markup">倍率</FieldLabel>
              <Input id="up-model-markup" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder="如 1.2" />
            </Field>
          </div>
          {badNumber ? <p className="text-2xs text-danger-text">进价与倍率必须是数字</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tab2 路由与映射：本上游登记的上游模型表。
 *  说明：后端只有上游级 test-connection，没有模型级探测；「探测」列如实展示上游级最近探测。 */
export function UpstreamModelsPanel({ upstream }: { upstream: UpstreamRow }) {
  const qc = useQueryClient();
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
      cell: (c) => <span className="text-2xs text-body">{parameterSummary(c.row.original.parameters)}</span>,
    },
    {
      id: "price",
      header: "进价（入 · 出 · 倍率）",
      cell: (c) => (
        <span className="tnum text-2sm text-body">
          {costText(c.row.original.cost_input_per_1m)} · {costText(c.row.original.cost_output_per_1m)} · {markupText(c.row.original.markup)}
        </span>
      ),
    },
    {
      accessorKey: "enabled",
      header: "状态",
      cell: (c) =>
        // 「关闭」语义色 warning（DESIGN-AUDIT 四期 §16 / W4-A1）：中性灰不表达「被人为停用」的警示。
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
      cell: (c) => {
        const row = c.row.original;
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
        <Button size="sm" onClick={() => setDialog({ open: true, initial: null })}>
          <Plus className="h-3.5 w-3.5" /> 添加模型
        </Button>
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
        <ModelDialog upstreamId={upstream.id} initial={dialog.initial} onClose={() => setDialog({ open: false, initial: null })} />
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
