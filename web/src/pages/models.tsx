import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";
import { useMatch, useNavigate, useSearchParams } from "react-router-dom";

import {
  coolingUntil, isCooling, modelRowRank, modelRowTone, modelStatusKind,
  periodicByRow, ruleSummary, useAvailabilityMutation, useAvailabilityRulesQuery, useBatchMutation,
} from "@/components/models/availability";
import { Field } from "@/components/models/field";
import { type MemberDraft, nextPriority, targetsPayload, validateMembers } from "@/components/models/member-drafts";
import { MemberEditor } from "@/components/models/member-editor";
import {
  isImageType, MODEL_TYPES, ROUTING_LABELS, similarity, TYPE_SOURCE_LABELS,
} from "@/components/models/model-vocab";
import { ModelParamsCell } from "@/components/models/model-params-cell";
import { PublicModelEditor } from "@/components/models/public-model-editor";
import { UpstreamModelDrawer } from "@/components/models/upstream-model-drawer";
import { PageHeader } from "@/components/layout/page-header";
import { ModelsTable, type ModelColumn } from "@/components/models/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { StatusIcon } from "@/components/ui/status-icon";
import { Tabs } from "@/components/ui/tabs";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { fmtInt, fmtMarkup, fmtMs, fmtPricePerM, fmtUnitPriceMicro } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import { usePermissions } from "@/lib/permissions";
import { useDialogDraftGuard } from "@/lib/use-dialog-draft-guard";
import { SELECT_ALL_VALUE } from "@/lib/select-sentinels";
import type {
  AdoptModelsDevBatchResult,
  ModelsDevSnapshotStatus,
  PublicModel,
  RoutingMode,
  Upstream,
  UpstreamModel,
} from "@/types";

/** 周期冷却窗口语义增强（窗口期内启用=仅跳过当前窗口）待后端合入；本页文案按现行为描述。 */
const ENABLE_SEMANTICS_NOTE =
  "启用为本次启用：解除该行托管冷却；若周期规则正处于窗口期，本次启用仅跳过当前窗口，后续窗口照常冷却（GLOSSARY §3）。";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制");
  } catch {
    toast.error("复制失败", { description: "浏览器拒绝了剪贴板访问" });
  }
}

/** GET /admin/prices/upstream 行（ADR-030：挂 upstream_model_id）；收窄到用到的字段。 */
interface UpstreamPriceRow {
  id: string;
  upstream_model_id: string;
  item: string;
  unit_price_micro: number;
  effective_from_ms: number;
}

interface CachePrice {
  micro: number;
  fromMs: number;
}

/** ADR-020：缓存价没有模型行列，只有 /admin/prices/upstream 的 cache_read 版本行；
 * 按模型行 id（upstream_model_id）取 effective_from_ms 最新的一条。 */
function cacheMapOf(items: UpstreamPriceRow[] | undefined): Map<string, CachePrice> {
  const map = new Map<string, CachePrice>();
  for (const price of items ?? []) {
    if (price.item !== "cache_read") continue;
    const prev = map.get(price.upstream_model_id);
    if (!prev || price.effective_from_ms >= prev.fromMs) {
      map.set(price.upstream_model_id, { micro: price.unit_price_micro, fromMs: price.effective_from_ms });
    }
  }
  return map;
}

// ---------------------------------------------------------------- 批量改价

/** 批量改价：入 / 出 / 倍率留空 = 不修改；前端逐条 PATCH 现有
 * PATCH /admin/upstream-models/{id}（该端点接受这三个字段，未提供的字段保持不变）。 */
function BatchPriceDialog({
  ids, onDone, onClose,
}: {
  ids: string[]; onDone: () => void; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [markup, setMarkup] = useState("");
  const numeric = (raw: string): number | null => {
    const text = raw.trim();
    if (text === "") return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : Number.NaN;
  };
  const inNum = numeric(input);
  const outNum = numeric(output);
  const markupNum = numeric(markup);
  const invalid =
    Number.isNaN(inNum) || (inNum !== null && inNum < 0) ||
    Number.isNaN(outNum) || (outNum !== null && outNum < 0) ||
    Number.isNaN(markupNum) || (markupNum !== null && (markupNum <= 0 || markupNum > 100));
  const nothingFilled = input.trim() === "" && output.trim() === "" && markup.trim() === "";

  // W4-G 弹窗草稿守卫（D11 统一实现）：填了内容后 Esc/遮罩/取消先确认「放弃修改？」。
  const guard = useDialogDraftGuard({
    dirty: !nothingFilled,
    onClose,
    description: "弹窗内已填的批量价目不会写入任何模型，关闭后将丢失。",
  });

  const apply = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (input.trim() !== "") body.cost_input_per_1m = input.trim();
      if (output.trim() !== "") body.cost_output_per_1m = output.trim();
      if (markup.trim() !== "") body.markup = markup.trim();
      const results = await Promise.allSettled(
        ids.map((id) => api.patch<UpstreamModel>(ENDPOINTS.upstreamModelUpdate(id), body)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      return { total: results.length, failed, firstError: firstError?.reason as Error | undefined };
    },
    onSuccess: ({ total, failed, firstError }) => {
      if (failed === 0) toast.success("批量改价完成", { description: "成功 " + total + " 个" });
      else {
        toast.warning("批量改价部分完成", {
          description: "成功 " + (total - failed) + " 个；失败 " + failed + " 个" + (firstError ? "：" + firstError.message : ""),
        });
      }
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      onDone();
      onClose();
    },
  });

  return (
    <>
    <Dialog open onOpenChange={(v) => { if (!v) guard.requestClose(); }}>
      <DialogContent className="max-w-md" onSubmit={() => apply.mutate()} submitDisabled={invalid || nothingFilled || apply.isPending}>
        <DialogHeader>
          <DialogTitle>批量改价 · {ids.length} 个上游模型</DialogTitle>
        </DialogHeader>
        <p className="text-2xs text-faint">
          逐条写入模型行进价（现行权威，ADR-020）；留空的字段保持每行原值不变。缓存价在价目页维护，不在本弹窗。
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Field label="输入成本 / 1M" hint={Number.isNaN(inNum) || inNum !== null && inNum < 0 ? "必须是非负数字" : "元，留空不动"}>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="留空不动" className="tnum" />
          </Field>
          <Field label="输出成本 / 1M" hint={Number.isNaN(outNum) || outNum !== null && outNum < 0 ? "必须是非负数字" : "元，留空不动"}>
            <Input value={output} onChange={(e) => setOutput(e.target.value)} placeholder="留空不动" className="tnum" />
          </Field>
          <Field label="倍率" hint={markupNum !== null && (markupNum <= 0 || markupNum > 100) ? "必须是 (0, 100]" : "留空不动"}>
            <Input value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder="留空不动" className="tnum" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={guard.requestClose}>取消</Button>
          <Button
            disabled={invalid || nothingFilled || apply.isPending}
            onClick={() => apply.mutate()}
          >
            {apply.isPending ? "保存中…" : "应用到所选 " + ids.length + " 个"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {guard.confirmNode}
    </>
  );
}

// ---------------------------------------------------------------- 上游模型 Tab

function UpstreamTab() {
  const { can } = usePermissions();
  const canCost = can("billing:cost");
  const canWrite = can("upstream_models:write");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["upstream-models"],
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
    refetchInterval: 30_000,
  });
  const qUpstreams = useQuery({ queryKey: ["upstreams"], queryFn: () => apiList<Upstream>(ENDPOINTS.upstreams) });
  // ADR-020：缓存价不在模型行，只有上游价目表的 cache_read 版本行；有 prices:read 才附显。
  const qPrices = useQuery({
    queryKey: ["upstream-prices"],
    queryFn: () => apiList<UpstreamPriceRow>(ENDPOINTS.pricesUpstream + "?page_size=200"),
    enabled: canCost && can("prices:read"),
    staleTime: 60_000,
  });
  const cachePrices = useMemo(() => cacheMapOf(qPrices.data?.items), [qPrices.data]);

  const availability = useAvailabilityMutation("upstream");
  const batch = useBatchMutation("upstream");
  const rulesQuery = useAvailabilityRulesQuery(can("availability:read"));
  const periodicRules = periodicByRow(rulesQuery.data, "upstream_model");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [typeValue, setTypeValue] = useState<string>(SELECT_ALL_VALUE);
  const [drawer, setDrawer] = useState<{ open: boolean; initial: UpstreamModel | null }>({ open: false, initial: null });
  const [deleting, setDeleting] = useState<UpstreamModel | null>(null);
  const [batchDelete, setBatchDelete] = useState(false);
  const [batchPrice, setBatchPrice] = useState(false);

  const allItems = q.data?.items ?? [];
  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () => allItems.filter((row) => {
      if (typeValue !== SELECT_ALL_VALUE && row.model_type !== typeValue) return false;
      if (needle === "") return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        (row.upstream_name ?? "").toLowerCase().includes(needle) ||
        row.model_type.toLowerCase().includes(needle)
      );
    }),
    [allItems, needle, typeValue],
  );

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  const clearFilters = () => {
    setSearch("");
    setTypeValue(SELECT_ALL_VALUE);
  };

  const del = useMutation({
    mutationFn: (id: string) => api.del<void>(ENDPOINTS.upstreamModelUpdate(id)),
    onSuccess: () => {
      toast.success("上游模型已删除");
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      void qc.invalidateQueries({ queryKey: ["public-models"] });
      setDeleting(null);
    },
    onError: (e: Error) => toast.error("删除失败", { description: e.message }),
  });

  // W4-H：工具条「同步 models.dev」——批量兑入端点（只填空键，手改不覆盖）。
  const syncModelsDev = useMutation({
    mutationFn: () => api.post<AdoptModelsDevBatchResult>(ENDPOINTS.upstreamModelsAdopt),
    onSuccess: (result) => {
      const source = result.refreshed ? "已拉取 models.dev 快照" : "拉取失败，使用库内快照";
      if (result.filled_models > 0) {
        toast.success("已兑入 " + result.filled_models + " 个模型", {
          description: source + "；共填 " + result.filled_keys + " 个键，" + result.no_match + " 个未命中（手改值未覆盖）",
        });
      } else {
        toast.info("没有需要兑入的空键", {
          description: source + "；" + result.matched + " 个命中但无空键，" + result.no_match + " 个未命中",
        });
      }
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      void qc.invalidateQueries({ queryKey: ["modelsdev-status"] });
    },
    onError: (e: Error) => toast.error("同步 models.dev 失败", { description: e.message }),
  });

  // W4-H：工具条常显「上次同步」——读库内快照摘要，不发网络请求；同步成功后刷新。
  const modelsDevStatus = useQuery({
    queryKey: ["modelsdev-status"],
    queryFn: () => api.get<ModelsDevSnapshotStatus>(ENDPOINTS.upstreamModelsModelsDevStatus),
    staleTime: 60_000,
  });

  // 价格单元格（W4-C）：进价 2 位小数（<0.01 升 4 位）；入出均未配置显示灰字「未设置」（同参数列「未配置」写法）。
  const priceCell = (row: UpstreamModel) => {
    const cache = cachePrices.get(row.id);
    const unpriced = (row.cost_input_per_1m ?? "").trim() === "" && (row.cost_output_per_1m ?? "").trim() === "";
    return (
      <div className="space-y-0.5 text-2sm tnum">
        {unpriced ? (
          <div className="text-faint">未设置</div>
        ) : (
          <div className="whitespace-nowrap" title={"入 " + fmtPricePerM(row.cost_input_per_1m) + " / 出 " + fmtPricePerM(row.cost_output_per_1m)}>
            {fmtPricePerM(row.cost_input_per_1m)} / {fmtPricePerM(row.cost_output_per_1m)}
          </div>
        )}
        <div className="whitespace-nowrap text-2xs text-faint">
          倍率 {fmtMarkup(row.markup)} · 缓存 {cache ? fmtUnitPriceMicro(cache.micro) + "/M" : "-"}
        </div>
      </div>
    );
  };

  const selectColumn: ModelColumn<UpstreamModel> = {
    key: "select",
    label: "选择",
    hideable: false,
    headerClassName: "w-10",
    header: (
      <Checkbox
        checked={allSelected ? true : someSelected ? "indeterminate" : false}
        onCheckedChange={() => toggleAll()}
        aria-label="全选当前列表"
      />
    ),
    cell: (row) => (
      <Checkbox
        checked={selected.has(row.id)}
        onCheckedChange={() => toggleRow(row.id)}
        aria-label={"选择 " + row.name}
      />
    ),
  };

  const columns: ModelColumn<UpstreamModel>[] = [
    ...(canWrite ? [selectColumn] : []),
    {
      key: "name",
      label: "模型 / 上游",
      cell: (row) => {
        const periodic = periodicRules.get(row.id);
        return (
          <div>
            {/* W7 t10：状态列删除后，状态由「行底色 + 操作文案 + 名字旁图标」表达；
                图标只在非正常状态出现（normal 不出图标也不留占位）。 */}
            <div className="flex items-center gap-1.5">
              <span className="tnum font-medium text-title">{row.name}</span>
              <StatusIcon kind={modelStatusKind(row)} cooldownUntilMs={coolingUntil(row)} />
            </div>
            <div className="text-2xs text-faint">
              {row.upstream_name ?? "-"}
            </div>
            {/* 周期规则摘要随状态列一起搬到这里：它不是启停的重复信息，删列不能连带丢掉。 */}
            {periodic ? <div className="text-2xs text-faint">周期：{ruleSummary(periodic)}</div> : null}
          </div>
        );
      },
    },
    {
      key: "type",
      label: "类型 / 来源",
      cell: (row) => (
        <div className="space-y-1">
          <Badge tone="info">{row.model_type}</Badge>
          <div className="text-2xs text-faint">{TYPE_SOURCE_LABELS[row.model_type_source ?? "default"]}</div>
          {isImageType(row.model_type) ? (
            <div className="text-2xs text-warning-text">AG 不记词元，无法计费</div>
          ) : null}
        </div>
      ),
    },
    ...(canCost ? [{
      key: "price",
      label: "价格（入 / 出）",
      className: "whitespace-nowrap text-right tnum",
      headerClassName: "whitespace-nowrap",
      cell: priceCell,
    } as ModelColumn<UpstreamModel>] : []),
    {
      key: "params",
      label: "参数",
      // W7 t09：列里只留输入/输出上限；模态、能力、思考档位进悬浮详情。
      cell: (row) => <ModelParamsCell row={row} />,
    },
    {
      key: "targets",
      label: "被引用",
      className: "text-right tnum",
      headerClassName: "whitespace-nowrap",
      cell: (row) => <span className="text-2sm">{fmtInt(row.target_count ?? 0)}</span>,
    },
    ...(canWrite ? [{
      key: "actions",
      label: "操作",
      // 操作列 = 最后一列 + 尾部冻结（W5 D1）：sticky 由 lib/table-columns 同时上 th 与 td。
      sticky: "right",
      hideable: false,
      headerClassName: "min-w-64",
      cell: (row: UpstreamModel) => (
        <div className="flex gap-1">
          <ActionButton action="edit" size="dense" onClick={() => setDrawer({ open: true, initial: row })}>
            编辑
          </ActionButton>
          {row.enabled ? (
            <ActionButton
              action="disable"
              size="dense"
              onClick={() => availability.mutate({ id: row.id, action: "disable" })}
            >
              关闭
            </ActionButton>
          ) : (
            <ActionButton
              action="enable"
              size="dense"
              onClick={() => availability.mutate({ id: row.id, action: "enable" })}
            >
              启用
            </ActionButton>
          )}
          {/* ADR-025 + ticket 02：冷却中行内只保留一个「解除」（不再同时出现「冷却」），
              单次规则删除；命中周期窗口时后端只跳过本窗口并保留周期规则。
              ticket 11：设置冷却收进编辑抽屉，行内只保留「解除」快捷入口。 */}
          {isCooling(row) ? (
            <ActionButton
              action="releaseCooldown"
              size="dense"
              onClick={() => availability.mutate({ id: row.id, action: "release" })}
            >
              解除
            </ActionButton>
          ) : null}
          <ActionButton
            action="delete"
            size="dense"
            disabled={(row.target_count ?? 0) > 0}
            title={(row.target_count ?? 0) > 0 ? "被公开模型引用，先移除成员再删除" : undefined}
            onClick={() => setDeleting(row)}
          >
            删除
          </ActionButton>
        </div>
      ),
    } as ModelColumn<UpstreamModel>] : []),
  ];

  const runBatch = (action: "enable" | "disable" | "delete") => {
    batch.mutate({ ids: Array.from(selected), action });
    setSelected(new Set());
    setBatchDelete(false);
  };

  // W4-H：「同步 models.dev」是常驻工具条动作（不依赖勾选），与批量按钮并存。
  const toolbarEnd = canWrite ? (
    <>
      {selected.size > 0 ? (
        <>
          <span className="text-2xs text-faint">已选 <span className="tnum font-medium text-title">{selected.size}</span></span>
          <ActionButton
            action="enable"
            variant="outline"
            disabled={batch.isPending}
            onClick={() => runBatch("enable")}
          >
            批量启用
          </ActionButton>
          <ActionButton
            action="disable"
            variant="outline"
            disabled={batch.isPending}
            onClick={() => runBatch("disable")}
          >
            批量关闭
          </ActionButton>
          {canCost ? (
            <Button variant="outline" size="sm" onClick={() => setBatchPrice(true)}>
              <ACTION_ICONS.batchPrice className="h-3.5 w-3.5" /> 批量改价
            </Button>
          ) : null}
          <ActionButton action="delete" disabled={batch.isPending} onClick={() => setBatchDelete(true)}>
            批量删除
          </ActionButton>
          <Button variant="ghost" size="sm" disabled={batch.isPending} onClick={() => setSelected(new Set())}>
            <ACTION_ICONS.clear className="h-3.5 w-3.5" /> 清除选择
          </Button>
        </>
      ) : null}
      <span className="text-2xs text-faint">
        {modelsDevStatus.data?.fetched_at_ms
          ? "上次同步 " + fmtMs(modelsDevStatus.data.fetched_at_ms)
          : "尚未同步 models.dev"}
        {modelsDevStatus.data?.models
          ? " · " + fmtInt(modelsDevStatus.data.models) + " 条快照"
          : ""}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={syncModelsDev.isPending}
        title="拉取 models.dev 快照并为所有上游模型填空键（手改值不覆盖）"
        onClick={() => syncModelsDev.mutate()}
      >
        <ACTION_ICONS.refresh className="h-3.5 w-3.5" />
        {syncModelsDev.isPending ? "同步中…" : "同步 models.dev"}
      </Button>
    </>
  ) : null;

  return (
    <div className="space-y-3">
      <p className="text-2xs text-faint">
        关闭是人工长期措施，冷却到期自动恢复。
        {ENABLE_SEMANTICS_NOTE}
      </p>
      <ModelsTable<UpstreamModel>
        columns={columns}
        rows={rows}
        totalCount={allItems.length}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        // W6 ticket 10：关闭行微灰且默认置尾；冷却行微黄位置不变（modelRowTone/modelRowRank）。
        rowTone={modelRowTone}
        closedLast={modelRowRank}
        storageKey="slipstream.cols.models"
        tabKey="upstream"
        searchText={search}
        onSearchChange={setSearch}
        searchPlaceholder="搜索模型名、上游或类型"
        typeFilter={{
          value: typeValue,
          onChange: setTypeValue,
          options: MODEL_TYPES,
        }}
        toolbarEnd={toolbarEnd}
        emptyText="还没有登记上游模型"
        emptyAction={canWrite ? (
          <Button size="sm" disabled={(qUpstreams.data?.items.length ?? 0) === 0} onClick={() => setDrawer({ open: true, initial: null })}>登记模型</Button>
        ) : undefined}
        onClearFilters={clearFilters}
      />
      {drawer.open ? (
        <UpstreamModelDrawer
          initial={drawer.initial}
          upstreams={qUpstreams.data?.items ?? []}
          canCost={canCost}
          onClose={() => setDrawer({ open: false, initial: null })}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title={"删除上游模型 " + (deleting?.name ?? "") + "？"}
        description="被公开模型引用的模型不能删除；历史计费流水保留。此操作不可逆。"
        confirmLabel="确认删除"
        destructive
        onConfirm={() => { if (deleting !== null) del.mutate(deleting.id); }}
      />
      {batchDelete ? (
        <BatchDeleteDialog
          count={selected.size}
          subject="上游模型"
          pending={batch.isPending}
          onConfirm={() => runBatch("delete")}
          onClose={() => setBatchDelete(false)}
        />
      ) : null}
      {batchPrice ? (
        <BatchPriceDialog
          ids={Array.from(selected)}
          onDone={() => setSelected(new Set())}
          onClose={() => setBatchPrice(false)}
        />
      ) : null}
    </div>
  );
}

/** 批量删除红色确认；超过 10 条需手动输入「删除」二字（DESIGN-AUDIT §4 三档确认）。 */
function BatchDeleteDialog({
  count, subject, pending, onConfirm, onClose,
}: {
  count: number; subject: string; pending: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const needTyping = count > 10;
  const ready = !needTyping || typed.trim() === "删除";
  return (
    <AlertDialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>批量删除 {count} 个{subject}？</AlertDialogTitle>
          <AlertDialogDescription>
            此操作不可逆：{subject === "上游模型" ? "被公开模型引用的条目会逐条删除失败，其余仍会执行" : "成员引用关系级联删除"}；历史计费流水保留。
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

// ---------------------------------------------------------------- 公开模型 Tab

/** 新建公开模型弹窗（简化版，W4-C）：编辑走整页编辑器 /models/public/:id，这里只管创建。 */
function PublicModelCreateDialog({
  upstreamModels, onClose,
}: {
  upstreamModels: UpstreamModel[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    routing_mode: "failover" as RoutingMode,
    note: "",
    enabled: true,
  });
  const [members, setMembers] = useState<MemberDraft[]>([]);
  // W4-G 弹窗草稿守卫（D11 统一实现）：填了名称/备注/成员或改了默认项后，Esc/遮罩/取消先确认「放弃修改？」。
  const dirty = form.name !== "" || form.note !== "" || !form.enabled || form.routing_mode !== "failover" || members.length > 0;
  const guard = useDialogDraftGuard({
    dirty,
    onClose,
    description: "弹窗内已填的公开模型草稿（名称、策略、成员）不会写入，关闭后将丢失。",
  });
  const suggestions = useMemo(() => {
    const needle = form.name.trim().toLowerCase();
    if (!needle) return [];
    const scored = upstreamModels
      .map((model) => ({ model, score: similarity(needle, model.name.toLowerCase()) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    return scored;
  }, [form.name, upstreamModels]);
  const errors = validateMembers(members, form.routing_mode);
  const save = useMutation({
    mutationFn: () => api.post<PublicModel>(ENDPOINTS.publicModels, {
      name: form.name.trim(),
      routing_mode: form.routing_mode,
      note: form.note.trim(),
      enabled: form.enabled,
      targets: targetsPayload(members),
    }),
    onSuccess: () => {
      toast.success("公开模型已创建");
      void qc.invalidateQueries({ queryKey: ["public-models"] });
      onClose();
    },
    onError: (e: Error) => toast.error("保存失败", { description: e.message }),
  });
  const toggleMember = (modelId: string, checked: boolean) => {
    if (checked) {
      if (members.some((member) => member.upstream_model_id === modelId)) return;
      setMembers([...members, { upstream_model_id: modelId, priority: String(nextPriority(members)), weight: "", when: "" }]);
      return;
    }
    setMembers(members.filter((member) => member.upstream_model_id !== modelId));
  };
  return (
    <>
    <Dialog open onOpenChange={(v) => { if (!v) guard.requestClose(); }}>
      <DialogContent className="max-w-2xl" onSubmit={() => save.mutate()} submitDisabled={save.isPending || form.name.trim() === "" || errors.length > 0}>
        <DialogHeader>
          <DialogTitle>新建公开模型</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-auto pr-1">
          <Field label="名称" hint="用户请求时使用的模型名">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 glm-5.3" />
          </Field>
          {suggestions.length > 0 ? (
            <div className="rounded-md border border-border bg-surface-2 p-2">
              <div className="mb-1 text-2xs text-faint">相似上游模型（勾选即成为成员）</div>
              <div className="space-y-1">
                {suggestions.map(({ model }) => (
                  <label key={model.id} className="flex items-center gap-2 text-2sm text-body">
                    <Checkbox
                      checked={members.some((member) => member.upstream_model_id === model.id)}
                      onCheckedChange={(checked) => toggleMember(model.id, checked === true)}
                    />
                    <span className="font-mono">{model.name}</span>
                    <span className="text-2xs text-faint">{model.upstream_name ?? ""}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <Field label="策略" hint="strategy 与 priority/weight 的渲染语义一致；旧系统 priority 已翻转为数值小优先">
            <RadioGroup value={form.routing_mode} onValueChange={(v) => setForm({ ...form, routing_mode: v as RoutingMode })} className="gap-2">
              {(Object.keys(ROUTING_LABELS) as RoutingMode[]).map((mode) => (
                <label key={mode} className="flex items-start gap-2 rounded-md border border-border p-2 text-2sm">
                  <RadioGroupItem value={mode} className="mt-0.5" />
                  <span>
                    <span className="font-medium text-body">{ROUTING_LABELS[mode].label}</span>
                    <span className="block text-2xs text-faint">{ROUTING_LABELS[mode].desc}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </Field>
          <Field label="成员编排">
            <MemberEditor members={members} upstreamModels={upstreamModels} mode={form.routing_mode} onChange={setMembers} />
          </Field>
          {errors.length > 0 ? <p className="text-2xs text-danger-text">{errors.join("；")}</p> : null}
          <Field label="备注">
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="选填" />
          </Field>
          <label className="flex items-center gap-2 text-2sm text-body">
            <Checkbox checked={form.enabled} onCheckedChange={(checked) => setForm({ ...form, enabled: checked === true })} />
            启用
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={guard.requestClose}>取消</Button>
          <Button disabled={save.isPending || form.name.trim() === "" || errors.length > 0} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {guard.confirmNode}
    </>
  );
}

function PublicTab() {
  const { can } = usePermissions();
  const canWrite = can("public_models:write");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["public-models"],
    queryFn: () => apiList<PublicModel>(ENDPOINTS.publicModels),
    refetchInterval: 30_000,
  });
  const qModels = useQuery({ queryKey: ["upstream-models"], queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels) });
  const availability = useAvailabilityMutation("public");
  const batch = useBatchMutation("public");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<PublicModel | null>(null);
  const [batchDelete, setBatchDelete] = useState(false);

  const allItems = q.data?.items ?? [];
  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () => allItems.filter((row) => {
      if (needle === "") return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        (row.note ?? "").toLowerCase().includes(needle) ||
        (row.targets ?? []).some((t) => (t.upstream_model_name || "").toLowerCase().includes(needle))
      );
    }),
    [allItems, needle],
  );

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));

  const del = useMutation({
    mutationFn: (id: string) => api.del<void>(ENDPOINTS.publicModelUpdate(id)),
    onSuccess: () => {
      toast.success("公开模型已删除");
      void qc.invalidateQueries({ queryKey: ["public-models"] });
      setDeleting(null);
    },
    onError: (e: Error) => toast.error("删除失败", { description: e.message }),
  });

  const openEditor = (row: PublicModel) => navigate("/models/public/" + row.id);

  const selectColumn: ModelColumn<PublicModel> = {
    key: "select",
    label: "选择",
    hideable: false,
    headerClassName: "w-10",
    header: (
      <Checkbox
        checked={allSelected ? true : someSelected ? "indeterminate" : false}
        onCheckedChange={() => toggleAll()}
        aria-label="全选当前列表"
      />
    ),
    cell: (row) => (
      <Checkbox
        checked={selected.has(row.id)}
        onCheckedChange={() => toggleRow(row.id)}
        aria-label={"选择 " + row.name}
      />
    ),
  };

  const columns: ModelColumn<PublicModel>[] = [
    ...(canWrite ? [selectColumn] : []),
    {
      key: "name",
      label: "公开名 / 备注",
      cell: (row) => (
        <div>
          {/* W7 t10：与上游模型同一口径——关闭的公开模型在名字旁出状态图标。 */}
          <div className="flex items-center gap-1.5">
            <span className="tnum font-medium text-title">{row.name}</span>
            <StatusIcon kind={modelStatusKind(row)} cooldownUntilMs={coolingUntil(row)} />
          </div>
          <div className="text-2xs text-faint">{row.note || "-"}</div>
        </div>
      ),
    },
    {
      key: "routing",
      label: "策略",
      cell: (row) => (
        <div>
          <Badge tone="primary">{ROUTING_LABELS[row.routing_mode].label}</Badge>
          <div className="mt-1 max-w-64 text-2xs text-faint">{ROUTING_LABELS[row.routing_mode].desc}</div>
        </div>
      ),
    },
    {
      key: "members",
      label: "成员",
      // 数值列右对齐（对齐镜像：className 头身同用，DESIGN-AUDIT 四期 §2）。
      className: "text-right tnum",
      cell: (row) => {
        const targets = row.targets ?? [];
        const names = targets.slice(0, 3).map((t) => t.upstream_model_name || t.upstream_model_id).filter((name) => Boolean(name));
        return (
          <div>
            <span className="tnum text-2sm">{fmtInt(row.target_count ?? targets.length)}</span>
            <div className="text-2xs text-faint">{names.length > 0 ? names.join(" · ") + (targets.length > 3 ? " …" : "") : "-"}</div>
          </div>
        );
      },
    },
    ...(canWrite ? [{
      key: "actions",
      label: "操作",
      // 操作列 = 最后一列 + 尾部冻结（W5 D1）：sticky 由 lib/table-columns 同时上 th 与 td。
      sticky: "right",
      hideable: false,
      headerClassName: "min-w-56",
      cell: (row: PublicModel) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="dense"
            className="h-7 w-7 px-0"
            aria-label={"复制公开名 " + row.name}
            title="复制公开名"
            onClick={() => void copyText(row.name)}
          >
            <ACTION_ICONS.copy className="h-3.5 w-3.5" />
          </Button>
          {/* ADR-025：编辑+成员合并为整页编辑器入口；新建仍走简化弹窗。 */}
          <ActionButton action="edit" size="dense" onClick={() => openEditor(row)}>
            编辑
          </ActionButton>
          {row.enabled ? (
            <ActionButton
              action="disable"
              size="dense"
              onClick={() => availability.mutate({ id: row.id, action: "disable" })}
            >
              关闭
            </ActionButton>
          ) : (
            <ActionButton
              action="enable"
              size="dense"
              onClick={() => availability.mutate({ id: row.id, action: "enable" })}
            >
              启用
            </ActionButton>
          )}
          <ActionButton action="delete" size="dense" onClick={() => setDeleting(row)}>
            删除
          </ActionButton>
        </div>
      ),
    } as ModelColumn<PublicModel>] : []),
  ];

  const runBatch = (action: "enable" | "disable" | "delete") => {
    batch.mutate({ ids: Array.from(selected), action });
    setSelected(new Set());
    setBatchDelete(false);
  };

  const toolbarEnd = canWrite && selected.size > 0 ? (
    <>
      <span className="text-2xs text-faint">已选 <span className="tnum font-medium text-title">{selected.size}</span></span>
      <ActionButton
        action="enable"
        variant="outline"
        disabled={batch.isPending}
        onClick={() => runBatch("enable")}
      >
        批量启用
      </ActionButton>
      <ActionButton
        action="disable"
        variant="outline"
        disabled={batch.isPending}
        onClick={() => runBatch("disable")}
      >
        批量关闭
      </ActionButton>
      <ActionButton action="delete" disabled={batch.isPending} onClick={() => setBatchDelete(true)}>
        批量删除
      </ActionButton>
      <Button variant="ghost" size="sm" disabled={batch.isPending} onClick={() => setSelected(new Set())}>
        <ACTION_ICONS.clear className="h-3.5 w-3.5" /> 清除选择
      </Button>
    </>
  ) : null;

  return (
    <div className="space-y-3">
      <p className="text-2xs text-faint">
        公开模型是运营对外发放的别名：策略 + 成员（priority / weight）+ 启停。可用性措施（冷却/周期）只作用于上游模型（ADR-025），行内「编辑」进入整页编辑器合并维护成员。
      </p>
      <ModelsTable<PublicModel>
        columns={columns}
        rows={rows}
        totalCount={allItems.length}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        // W6 ticket 10：公开模型只有启停（ADR-025），关闭行微灰且默认置尾。
        rowTone={modelRowTone}
        closedLast={modelRowRank}
        storageKey="slipstream.cols.models"
        tabKey="public"
        searchText={search}
        onSearchChange={setSearch}
        searchPlaceholder="搜索公开名、备注或成员"
        toolbarEnd={toolbarEnd}
        emptyText="还没有公开模型"
        emptyAction={canWrite ? <Button size="sm" onClick={() => setCreateOpen(true)}>新建公开模型</Button> : undefined}
        onClearFilters={() => setSearch("")}
        onRowClick={canWrite ? openEditor : undefined}
      />
      {createOpen ? (
        <PublicModelCreateDialog upstreamModels={qModels.data?.items ?? []} onClose={() => setCreateOpen(false)} />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title={"删除公开模型 " + (deleting?.name ?? "") + "？"}
        description="成员关系会级联删除；历史计费流水保留。此操作不可逆。"
        confirmLabel="确认删除"
        destructive
        onConfirm={() => { if (deleting !== null) del.mutate(deleting.id); }}
      />
      {batchDelete ? (
        <BatchDeleteDialog
          count={selected.size}
          subject="公开模型"
          pending={batch.isPending}
          onConfirm={() => runBatch("delete")}
          onClose={() => setBatchDelete(false)}
        />
      ) : null}
    </div>
  );
}

export function ModelsPage() {
  // W4-C：/models/public/:id 也挂在本页面模块（PAGE_MODULES 按文件懒加载），按路径分流到整页编辑器。
  const editorMatch = useMatch("/models/public/:id");
  const [params] = useSearchParams();
  if (editorMatch) return <PublicModelEditor id={editorMatch.params.id ?? ""} />;
  const initialKey = params.get("tab") === "public" ? "public" : "upstream";
  return (
    <div className="space-y-4">
      <PageHeader
        title="模型管理"
        description="上游模型是技术记录；公开模型是对外别名，通过成员引用上游模型。"
      />
      <Tabs
        initialKey={initialKey}
        items={[
          { key: "upstream", label: "上游模型", content: <UpstreamTab /> },
          { key: "public", label: "公开模型", content: <PublicTab /> },
        ]}
      />
    </div>
  );
}
