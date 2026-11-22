import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDialogDraftGuard } from "@/lib/use-dialog-draft-guard";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PriceJsonView } from "@/components/pricing/price-json-view";
import { PriceTable, type PriceColumn } from "@/components/pricing/table";
import { UNIT_HINT, deriveSpendMicro, priceMicro } from "@/components/pricing/money";
import { invalidatePricing, useUpstreamModels } from "@/components/pricing/queries";
import { controlPlane } from "@/lib/control-plane";
import { ApiError } from "@/lib/control-plane/errors";
import { fmtPriceAmount, fmtUnitPriceMicro } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import {
  draftsFromPriceDocument,
  formatPriceDocument,
  normalizePriceImportErrors,
  parsePriceDocumentJson,
  type PriceDocument,
  type PriceDocumentIssue,
  type PriceImportErrorRow,
} from "@/lib/pricing/document";
import { actionColumnWidth } from "@/lib/table-columns";
import { usePermissions } from "@/lib/permissions";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import type { UpstreamModel } from "@/types";

/** 行内编辑草稿：空串表示「未配置」，保存时折算为 null 清空。 */
interface Draft {
  input: string;
  output: string;
  markup: string;
}

function draftOf(model: UpstreamModel): Draft {
  return {
    input: model.cost_input_per_1m ?? "",
    output: model.cost_output_per_1m ?? "",
    markup: model.markup ?? "1.0000",
  };
}

function numeric(text: string): number | null {
  if (text.trim() === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 与后端 pricing.validate_cost 同口径：空串表示清空，其余必须是非负数。 */
function costValid(text: string): boolean {
  const parsed = numeric(text);
  return parsed === null || parsed >= 0;
}

/** 与后端 pricing.validate_markup 同口径：0 < 倍率 <= 100。 */
function markupValid(text: string): boolean {
  const parsed = numeric(text);
  return parsed !== null && parsed > 0 && parsed <= 100;
}

function draftValid(draft: Draft): boolean {
  return costValid(draft.input) && costValid(draft.output) && markupValid(draft.markup);
}

function isDirty(model: UpstreamModel, draft: Draft): boolean {
  return (
    draft.input !== (model.cost_input_per_1m ?? "") ||
    draft.output !== (model.cost_output_per_1m ?? "") ||
    draft.markup !== (model.markup ?? "1.0000")
  );
}

/** 未配价：chat / image 需要输入+输出单价，其余模型只要求输入。 */
function missingItems(model: UpstreamModel): string[] {
  const missing: string[] = [];
  if (!model.cost_input_per_1m) missing.push("入价");
  if ((model.model_type === "chat" || model.model_type === "image") && !model.cost_output_per_1m) {
    missing.push("出价");
  }
  return missing;
}

export function UpstreamPricesSection() {
  const queryClient = useQueryClient();
  const { can, isPending: permissionsPending } = usePermissions();
  const canReadModels = can("upstream_models:read");
  const canCost = can("billing:cost");
  const canEdit = canCost && can("upstream_models:write");

  const modelsQuery = useUpstreamModels(!permissionsPending && canReadModels);
  const models = useMemo(() => {
    const rows = [...(modelsQuery.data ?? [])];
    rows.sort(
      (a, b) =>
        (a.upstream_name ?? "").localeCompare(b.upstream_name ?? "", "zh") ||
        a.name.localeCompare(b.name, "zh"),
    );
    return rows;
  }, [modelsQuery.data]);

  const [searchText, setSearchText] = useState("");
  const [unpricedOnly, setUnpricedOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);

  // W8 ticket 07：同一份价目既有表格视图也有页内 JSON 视图。jsonText 承载「由表格生成」与
  // 用户手改；合法 JSON 立即回写 drafts，非法文本只留 issues、不覆盖已加载草稿（与改写规则
  // 编辑器的视图切换同一模式）。保存复用整批导入端点，任一行失败整批不落库。
  const [view, setView] = useState<"table" | "json">("table");
  const [jsonText, setJsonText] = useState("");
  const [jsonIssues, setJsonIssues] = useState<PriceDocumentIssue[]>([]);
  const [jsonDocument, setJsonDocument] = useState<PriceDocument | null>(null);
  const [jsonTouched, setJsonTouched] = useState(false);
  const [jsonConfirm, setJsonConfirm] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importRowErrors, setImportRowErrors] = useState<PriceImportErrorRow[] | null>(null);

  const filtered = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return models.filter((model) => {
      if (unpricedOnly && missingItems(model).length === 0) return false;
      if (!query) return true;
      return [model.name, model.upstream_name, model.model_type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [models, searchText, unpricedOnly]);

  const unpricedCount = useMemo(
    () => models.filter((model) => missingItems(model).length > 0).length,
    [models],
  );
  // W4-G：任一行有未保存的价目草稿就算页面 dirty，离页（侧栏/刷新）先确认。
  const rowsDirty = useMemo(
    () => models.some((model) => {
      const draft = drafts[model.id];
      return draft !== undefined && isDirty(model, draft);
    }),
    [models, drafts],
  );
  // JSON 里未修正的非法文本尚未应用到表格，也算未保存修改（离页确认沿用同一个 guard）。
  const hasPendingJson = jsonTouched && jsonIssues.length > 0;
  const pageDirty = rowsDirty || hasPendingJson;
  const leaveGuard = useDirtyGuard(pageDirty, "离开将丢失未保存的价目修改；Enter 或「保存」可先落盘。");
  const allSelected = filtered.length > 0 && filtered.every((model) => selected.has(model.id));
  const someSelected = selected.size > 0 && !allSelected;

  const save = useMutation({
    mutationFn: ({ model, draft }: { model: UpstreamModel; draft: Draft }) =>
      controlPlane.models.updateUpstreamModel(model.id, {
        cost_input_per_1m: draft.input.trim() === "" ? null : draft.input.trim(),
        cost_output_per_1m: draft.output.trim() === "" ? null : draft.output.trim(),
        markup: draft.markup.trim(),
      }),
    onSuccess: async (_row, variables) => {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[variables.model.id];
        return next;
      });
      // 模型行进价是派生值的单一真相源（ADR-020）：缓存价、公开模型派生价一并失效。
      await invalidatePricing(queryClient);
      toast.success("价目已保存", {
        description: variables.model.name + " 的新价格即时生效，新请求按新价计费",
      });
    },
    onError: (error: Error, variables) => {
      toast.error("保存失败", { description: variables.model.name + "：" + error.message });
    },
  });

  // 保存 JSON 复用 POST /admin/prices/import（ADR-020）：后端先整批校验再单事务写库，
  // 任一行失败 422 且整批不生效；这里把 details.errors 逐行展示，不逐条 PATCH。
  const importJson = useMutation({
    mutationFn: (body: PriceDocument) => controlPlane.prices.importPrices(body),
    onSuccess: (result, body) => {
      toast.success("价目 JSON 已保存", {
        description:
          "已更新 " + result.changed + " 项" +
          (result.skipped ? "；跳过 " + result.skipped + " 项（无字段变更）" : ""),
      });
      setDrafts({});
      setImportError(null);
      setImportRowErrors(null);
      setJsonDocument(body);
      setJsonIssues([]);
      setJsonText(JSON.stringify(body, null, 2));
      void invalidatePricing(queryClient);
    },
    onError: (error: Error) => {
      if (error instanceof ApiError) {
        setImportError(error.message);
        setImportRowErrors(normalizePriceImportErrors(error));
      } else {
        setImportError(error.message);
        setImportRowErrors([]);
      }
    },
  });

  function setField(model: UpstreamModel, field: keyof Draft, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [model.id]: { ...(prev[model.id] ?? draftOf(model)), [field]: value },
    }));
  }

  function resetDraft(modelId: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
  }

  /** Enter 直接保存当前行（表格内嵌编辑惯例），未改动或非法时不动。 */
  function onEnter(event: { key: string; preventDefault: () => void }, model: UpstreamModel) {
    if (event.key !== "Enter") return;
    const draft = drafts[model.id] ?? draftOf(model);
    if (!isDirty(model, draft) || !draftValid(draft) || save.isPending) return;
    event.preventDefault();
    save.mutate({ model, draft });
  }

  /** 应用 JSON 文本：合法则回写表格草稿（切换保留未保存 edits），非法则只展示问题。 */
  function applyJsonText(text: string) {
    setJsonText(text);
    setJsonTouched(true);
    setImportError(null);
    setImportRowErrors(null);
    const result = parsePriceDocumentJson(text, models);
    setJsonIssues(result.issues);
    setJsonDocument(result.document);
    if (result.document !== null) {
      setDrafts((prev) => ({
        ...prev,
        ...draftsFromPriceDocument(result.document!, models, prev),
      }));
    }
  }

  /** 用当前表格草稿重建 JSON 文本（表格是草稿真相源，JSON 只是同一份数据的另一种视图）。 */
  function reloadJsonFromTable() {
    applyJsonText(formatPriceDocument(models, drafts));
  }

  function changeView(next: "table" | "json") {
    if (next === view) return;
    // 模型还没加载出来时没有可编辑的价目行，不进入 JSON 视图（避免生成空文件报错）。
    if (next === "json" && models.length === 0) return;
    // 首次进入、或上一次 JSON 文本已合法时，以当前草稿为准重建；存在未修正的非法文本时
    // 保留文本与错误，避免切换视图丢掉手改（与 transforms 编辑器一致）。
    if (next === "json" && (!jsonTouched || jsonIssues.length === 0)) reloadJsonFromTable();
    setView(next);
  }

  /** 操作列常驻「编辑」入口：定位并聚焦该行入价输入框（JSX 里 id=price-input-<model.id>）。 */
  function focusPriceInput(modelId: string) {
    const input = document.getElementById("price-input-" + modelId);
    if (!(input instanceof HTMLInputElement)) return;
    input.scrollIntoView({ block: "center", behavior: "smooth" });
    input.focus({ preventScroll: true });
    input.select();
  }

  function toggleRow(model: UpstreamModel, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(model.id);
      else next.delete(model.id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (filtered.length > 0 && filtered.every((model) => prev.has(model.id))) {
        const next = new Set(prev);
        for (const model of filtered) next.delete(model.id);
        return next;
      }
      const next = new Set(prev);
      for (const model of filtered) next.add(model.id);
      return next;
    });
  }

  function priceHeader(label: string) {
    return (
      <span className="flex flex-col leading-tight">
        <span>{label}</span>
        <span className="font-normal text-faint">{UNIT_HINT}</span>
      </span>
    );
  }

  const columns: PriceColumn<UpstreamModel>[] = [
    {
      key: "select",
      label: "选择",
      hideable: false,
      width: "2.5rem",
      headerClassName: "w-9",
      header: (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={() => toggleAll()}
          aria-label="全选当前筛选结果"
        />
      ),
      cell: (model) => (
        <Checkbox
          checked={selected.has(model.id)}
          onCheckedChange={(checked) => toggleRow(model, checked === true)}
          aria-label={"选择 " + model.name}
        />
      ),
    },
    {
      key: "model",
      label: "模型",
      sortable: true,
      sortValue: (model) => model.name,
      cell: (model) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-title">{model.name}</span>
          <Badge tone={model.enabled ? "success" : "neutral"}>
            {model.enabled ? "启用" : "关闭"}
          </Badge>
        </div>
      ),
    },
    {
      key: "upstream",
      label: "所属上游",
      hideable: true,
      width: "8rem",
      sortable: true,
      sortValue: (model) => model.upstream_name ?? "",
      cell: (model) => (
        <span className="text-body">{model.upstream_name ?? "-"}</span>
      ),
    },
    {
      key: "type",
      label: "类型",
      hideable: true,
      width: "6rem",
      cell: (model) => <Badge tone="neutral">{model.model_type}</Badge>,
    },
    {
      key: "input",
      label: "入价",
      header: priceHeader("入价"),
      width: "8.5rem",
      sortable: true,
      sortValue: (model) => priceMicro(model.cost_input_per_1m),
      className: "text-right",
      headerClassName: "text-right",
      cell: (model) => {
        const draft = drafts[model.id] ?? draftOf(model);
        if (!canEdit) {
          return <span className="tnum text-body">{fmtPriceAmount(model.cost_input_per_1m)}</span>;
        }
        return (
          <Input
            id={"price-input-" + model.id}
            value={draft.input}
            onChange={(event) => setField(model, "input", event.target.value)}
            onKeyDown={(event) => onEnter(event, model)}
            inputMode="decimal"
            aria-label={model.name + " 入价成本单价"}
            placeholder="未配价"
            className="h-7 w-28 text-right tabular-nums"
          />
        );
      },
    },
    {
      key: "output",
      label: "出价",
      header: priceHeader("出价"),
      width: "8.5rem",
      sortable: true,
      sortValue: (model) => priceMicro(model.cost_output_per_1m),
      className: "text-right",
      headerClassName: "text-right",
      cell: (model) => {
        const draft = drafts[model.id] ?? draftOf(model);
        if (!canEdit) {
          return <span className="tnum text-body">{fmtPriceAmount(model.cost_output_per_1m)}</span>;
        }
        return (
          <Input
            value={draft.output}
            onChange={(event) => setField(model, "output", event.target.value)}
            onKeyDown={(event) => onEnter(event, model)}
            inputMode="decimal"
            aria-label={model.name + " 出价成本单价"}
            placeholder="未配价"
            className="h-7 w-28 text-right tabular-nums"
          />
        );
      },
    },
    {
      key: "markup",
      label: "倍率",
      width: "7rem",
      sortable: true,
      sortValue: (model) => numeric(model.markup ?? ""),
      className: "text-right",
      headerClassName: "text-right",
      cell: (model) => {
        const draft = drafts[model.id] ?? draftOf(model);
        if (!canEdit) {
          return <span className="tnum text-body">{draft.markup}</span>;
        }
        return (
          <div className="flex flex-col items-end gap-0.5">
            <Input
              value={draft.markup}
              onChange={(event) => setField(model, "markup", event.target.value)}
              onKeyDown={(event) => onEnter(event, model)}
              inputMode="decimal"
              aria-label={model.name + " 倍率"}
              className="h-7 w-20 text-right tabular-nums"
            />
            {!draftValid(draft) ? (
              <span className="text-2xs text-danger-text">倍率需在 (0, 100]，成本非负</span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "derived",
      label: "派生售价（入·出）",
      width: "10rem",
      header: (
        <span className="flex flex-col leading-tight">
          <span>派生售价（入·出）</span>
          <span className="font-normal text-faint">{UNIT_HINT}</span>
        </span>
      ),
      sortable: true,
      sortValue: (model) => deriveSpendMicro(model.cost_input_per_1m, model.markup),
      className: "text-right",
      headerClassName: "text-right",
      cell: (model) => {
        const draft = drafts[model.id] ?? draftOf(model);
        const derivedInput = deriveSpendMicro(draft.input, draft.markup);
        const derivedOutput = deriveSpendMicro(draft.output, draft.markup);
        return (
          <div className="space-y-0.5 tabular-nums">
            <div>
              <span className="mr-1.5 text-2xs text-faint">入</span>
              <span className={derivedInput === null ? "text-faint" : "text-title"}>
                {fmtUnitPriceMicro(derivedInput, "CNY")}
              </span>
            </div>
            <div>
              <span className="mr-1.5 text-2xs text-faint">出</span>
              <span className={derivedOutput === null ? "text-faint" : "text-title"}>
                {fmtUnitPriceMicro(derivedOutput, "CNY")}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key: "actions",
      label: "操作",
      hideable: false,
      align: "right",
      sticky: "right",
      // W8 t03 固定槽位：常驻「编辑」+ 有草稿时的「撤销 / 保存」共 3 个 dense 按钮，
      // 宽度按按钮数固定，行内状态切换不会再挤动其它列。
      width: actionColumnWidth(3, 3.5),
      cell: (model) => {
        if (!canEdit) return <span className="text-2xs text-faint">只读</span>;
        const draft = drafts[model.id] ?? draftOf(model);
        const dirty = isDirty(model, draft);
        const saving = save.isPending && save.variables?.model.id === model.id;
        return (
          <div className="flex items-center justify-end gap-1">
            {/* W8 ticket 07：编辑入口常驻（不再用「-」占位），点击定位到该行入价输入框。 */}
            <Button
              size="dense"
              variant="ghost"
              aria-label={"编辑 " + model.name + " 的价目"}
              title="定位到该行入价输入框"
              onClick={() => focusPriceInput(model.id)}
            >
              <ACTION_ICONS.edit className="h-3.5 w-3.5" />
            </Button>
            {dirty ? (
              <>
                <Button size="dense" variant="ghost" onClick={() => resetDraft(model.id)} disabled={saving}>
                  <ACTION_ICONS.undo className="h-3.5 w-3.5" /> 撤销
                </Button>
                <Button
                  size="dense"
                  onClick={() => save.mutate({ model, draft })}
                  disabled={!draftValid(draft) || saving}
                >
                  <ACTION_ICONS.save className="h-3.5 w-3.5" /> {saving ? "保存中…" : "保存"}
                </Button>
              </>
            ) : null}
          </div>
        );
      },
    },
  ];

  const batchBar = canEdit && selected.size > 0 ? (
    <>
      <span className="text-2xs text-faint">
        已选 <span className="tnum font-medium text-title">{selected.size}</span>
      </span>
      <Button size="sm" disabled={save.isPending} onClick={() => setBatchOpen(true)}>
        <ACTION_ICONS.batchPrice className="h-3.5 w-3.5" /> 批量改价
      </Button>
    </>
  ) : null;

  // JSON 导入语义是「null / 空串 = 不改」，表达不了表格的「清空价格」；有这种待保存草稿时
  // 禁用 JSON 保存并提示切回表格，避免清空意图被静默丢掉。
  const pendingClears = useMemo(
    () =>
      models.filter((model) => {
        const draft = drafts[model.id];
        if (draft === undefined) return false;
        return (
          (draft.input.trim() === "" && (model.cost_input_per_1m ?? "") !== "") ||
          (draft.output.trim() === "" && (model.cost_output_per_1m ?? "") !== "")
        );
      }).length,
    [models, drafts],
  );
  const invalidDraftRows = useMemo(
    () =>
      models.filter((model) => {
        const draft = drafts[model.id];
        return draft !== undefined && !draftValid(draft);
      }).length,
    [models, drafts],
  );
  const jsonSaveBlocker =
    jsonIssues.length > 0
      ? "先修正 JSON 校验未通过的问题"
      : jsonDocument === null
        ? "JSON 尚未通过校验"
        : pendingClears > 0
          ? "表格视图有 " + pendingClears + " 行待清空价格；JSON 导入不能清空价格，请先切回表格保存"
          : invalidDraftRows > 0
            ? "表格视图有 " + invalidDraftRows + " 行非法草稿；请先切回表格修正或撤销"
            : !rowsDirty && !hasPendingJson
              ? "没有未保存的修改"
              : null;

  const viewToggle = canEdit && models.length > 0 ? (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={view}
      onValueChange={(next) => changeView(next === "json" ? "json" : "table")}
      aria-label="价目视图"
    >
      <ToggleGroupItem value="table" aria-label="表格视图">
        表格
      </ToggleGroupItem>
      <ToggleGroupItem value="json" aria-label="JSON 视图">
        <ACTION_ICONS.rawJson className="h-3.5 w-3.5" /> JSON
      </ToggleGroupItem>
    </ToggleGroup>
  ) : null;

  const modelError = modelsQuery.error instanceof Error
    ? modelsQuery.error.message
    : modelsQuery.error
      ? "上游进价加载失败"
      : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-title">上游进价</h2>
          <p className="mt-1 text-2xs text-faint">
            模型行成本与倍率是计费的现行权威（ADR-020）：花费 = 成本 × 倍率；保存后新请求按新价计费，历史账目不重算。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canReadModels ? <Badge tone="neutral">上游模型 {models.length}</Badge> : null}
          {canCost && models.length > 0 ? (
            <>
              <Badge tone="success">已定价 {models.length - unpricedCount}</Badge>
              <Badge tone={unpricedCount > 0 ? "warning" : "neutral"}>未配价 {unpricedCount}</Badge>
            </>
          ) : null}
          <span className="text-2xs text-faint">单位：{UNIT_HINT}</span>
        </div>
      </div>

      {!canReadModels ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-2sm text-faint">
          当前账号没有 <span className="font-medium text-body">upstream_models:read</span> 权限，看不到上游进价账。
        </p>
      ) : !canCost ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-2sm text-faint">
          当前账号没有 <span className="font-medium text-body">billing:cost</span>{" "}
          权限：后端不会返回成本与倍率字段，本段只读；公开模型售价仍可在下方查看。
        </p>
      ) : (
        <>
          {view === "table" && hasPendingJson ? (
            <Alert variant="warning">
              <AlertTitle>JSON 视图还有 {jsonIssues.length} 处未应用的问题</AlertTitle>
              <AlertDescription>
                切回 JSON 修正后才能保存 JSON；表格行内保存不受影响。
              </AlertDescription>
            </Alert>
          ) : null}
          <PriceTable
            columns={columns}
            rows={filtered}
            totalCount={models.length}
            loading={modelsQuery.isLoading}
            error={modelError}
            onRetry={() => void modelsQuery.refetch()}
            sectionKey="upstream"
            searchText={searchText}
            onSearchChange={setSearchText}
            searchPlaceholder="筛选模型 / 上游 / 类型"
            toolbarStart={
              <label className="flex h-8 items-center gap-2 text-2sm text-body">
                <Switch
                  checked={unpricedOnly}
                  onCheckedChange={setUnpricedOnly}
                  aria-label="只看未配价"
                />
                只看未配价
              </label>
            }
            toolbarEnd={batchBar}
            emptyText={unpricedOnly ? "所有上游模型都已配价" : "还没有上游模型"}
            onClearFilters={() => {
              setSearchText("");
              setUnpricedOnly(false);
              setSelected(new Set());
            }}
            rowKey={(model) => model.id}
            view={view}
            viewToggle={viewToggle}
            layout="fixed"
            jsonView={
              <PriceJsonView
                text={jsonText}
                issues={jsonIssues}
                serverMessage={importError}
                serverRows={importRowErrors}
                rowCount={jsonDocument?.upstream_models.length ?? 0}
                saving={importJson.isPending}
                saveBlocker={jsonSaveBlocker}
                onChange={applyJsonText}
                onSave={() => setJsonConfirm(true)}
                onReload={reloadJsonFromTable}
              />
            }
          />
        </>
      )}

      {batchOpen && selected.size > 0 ? (
        <BatchPriceDialog
          ids={[...selected]}
          onClose={() => setBatchOpen(false)}
          onDone={() => setSelected(new Set())}
        />
      ) : null}
      {jsonConfirm && jsonDocument !== null ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setJsonConfirm(false); }}
          title="确认保存价目 JSON？"
          description={
            "文件含 " + jsonDocument.upstream_models.length + " 个上游模型条目：" +
            "校验通过的行将覆盖对应模型的现行成本与倍率，历史账目不重算；" +
            "任一行校验失败则整批不生效。"
          }
          confirmLabel="确认保存"
          onConfirm={() => {
            setJsonConfirm(false);
            importJson.mutate(jsonDocument);
          }}
        />
      ) : null}
      {leaveGuard}
    </section>
  );
}

/** 批量改价（F4a 已验证模式）：入 / 出 / 倍率留空 = 不修改，前端逐条 PATCH 模型行。 */
function BatchPriceDialog({
  ids, onDone, onClose,
}: {
  ids: string[];
  onDone: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [markup, setMarkup] = useState("");
  const numericOf = (raw: string): number | null => {
    const text = raw.trim();
    if (text === "") return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  const inNum = numericOf(input);
  const outNum = numericOf(output);
  const markupNum = numericOf(markup);
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
        ids.map((id) => controlPlane.models.updateUpstreamModel(id, body)),
      );
      const failed = results.filter((item) => item.status === "rejected").length;
      const firstError = results.find(
        (item): item is PromiseRejectedResult => item.status === "rejected",
      );
      return { total: results.length, failed, firstError: firstError?.reason as Error | undefined };
    },
    onSuccess: async ({ total, failed, firstError }) => {
      if (failed === 0) {
        toast.success("批量改价完成", { description: "成功更新 " + total + " 个模型" });
      } else {
        toast.warning("批量改价部分完成", {
          description:
            "成功 " + (total - failed) + " 个；失败 " + failed + " 个" +
            (firstError ? "：" + firstError.message : ""),
        });
      }
      await invalidatePricing(queryClient);
      onDone();
      onClose();
    },
  });

  return (
    <>
    <Dialog open onOpenChange={(open) => { if (!open) guard.requestClose(); }}>
      <DialogContent className="max-w-md" onSubmit={() => apply.mutate()} submitDisabled={invalid || nothingFilled || apply.isPending}>
        <DialogHeader>
          <DialogTitle>批量改价 · {ids.length} 个上游模型</DialogTitle>
        </DialogHeader>
        <p className="text-2xs text-faint">
          逐条写入模型行进价（现行权威，ADR-020）；留空的字段保持每行原值不变。派生售价随「成本 × 倍率」即时更新。
        </p>
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="text-2xs text-faint">入价 {UNIT_HINT}</span>
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="留空不动"
              inputMode="decimal"
              aria-label="批量入价"
              className="tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-2xs text-faint">出价 {UNIT_HINT}</span>
            <Input
              value={output}
              onChange={(event) => setOutput(event.target.value)}
              placeholder="留空不动"
              inputMode="decimal"
              aria-label="批量出价"
              className="tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-2xs text-faint">倍率</span>
            <Input
              value={markup}
              onChange={(event) => setMarkup(event.target.value)}
              placeholder="留空不动"
              inputMode="decimal"
              aria-label="批量倍率"
              className="tabular-nums"
            />
          </label>
        </div>
        {invalid ? (
          <p className="text-2xs text-danger-text">成本必须是非负数，倍率需在 (0, 100]。</p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={guard.requestClose}>取消</Button>
          <Button
            onClick={() => apply.mutate()}
            disabled={invalid || nothingFilled || apply.isPending}
          >
            {apply.isPending ? "保存中…" : "应用到已选模型"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {guard.confirmNode}
    </>
  );
}
