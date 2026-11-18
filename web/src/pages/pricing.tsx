import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import type { PublicModelPrice, UpstreamModel } from "@/types";

const MODEL_QUERY_KEY = ["upstream-models"] as const;
const PUBLIC_PRICE_QUERY_KEY = ["public-model-prices"] as const;

const ROUTING_LABEL: Record<string, string> = {
  failover: "故障转移",
  weighted: "加权",
  conditional: "条件",
};

const UNIT_HINT = "CNY / 1M 词元";

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

function numeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 与后端 pricing.validate_cost 同口径：空串表示清空，其余必须是非负数。 */
function costValid(text: string): boolean {
  if (text.trim() === "") return true;
  const parsed = numeric(text);
  return parsed !== null && parsed >= 0;
}

/** 与后端 pricing.validate_markup 同口径：0 < 倍率 <= 100。 */
function draftValid(draft: Draft): boolean {
  if (!costValid(draft.input) || !costValid(draft.output)) return false;
  const markup = numeric(draft.markup);
  return markup !== null && markup > 0 && markup <= 100;
}

function isDirty(model: UpstreamModel, draft: Draft): boolean {
  return (
    draft.input !== (model.cost_input_per_1m ?? "") ||
    draft.output !== (model.cost_output_per_1m ?? "") ||
    draft.markup !== (model.markup ?? "1.0000")
  );
}

function money(value: string | null | undefined): string {
  const parsed = numeric(value);
  return parsed === null ? "—" : "¥" + parsed.toFixed(4);
}

/** 花费单价 = 成本单价 × 倍率，与后端 pricing.spend_micro 同口径。 */
function spend(input: string, markup: string): string | null {
  const cost = numeric(input);
  const ratio = numeric(markup);
  if (cost === null || cost < 0 || ratio === null || ratio <= 0) return null;
  return "¥" + (cost * ratio).toFixed(4);
}

/** 待补价：chat/image 需要输入+输出，其余模型只要求输入。 */
function missingItems(model: UpstreamModel): string[] {
  const missing: string[] = [];
  if (!model.cost_input_per_1m) missing.push("输入价");
  if ((model.model_type === "chat" || model.model_type === "image") && !model.cost_output_per_1m) {
    missing.push("输出价");
  }
  return missing;
}

function reasonText(reason: string): string {
  if (reason === "weights_zero") return "权重为 0";
  if (reason === "no_priced_members") return "成员未定价";
  return "不可计算";
}

function focusCostInput(modelId: string): void {
  const input = document.getElementById("cost-input-" + modelId);
  if (input instanceof HTMLInputElement) {
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
  }
}

export function PricingPage() {
  const queryClient = useQueryClient();
  const { can, isPending: permissionsPending } = usePermissions();
  const canCost = can("billing:cost");
  const canReadModels = can("upstream_models:read");
  const canEdit = canCost && can("upstream_models:write");

  const modelsQuery = useQuery({
    queryKey: MODEL_QUERY_KEY,
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
    enabled: !permissionsPending && canReadModels,
  });
  const pricesQuery = useQuery({
    queryKey: PUBLIC_PRICE_QUERY_KEY,
    queryFn: () => apiList<PublicModelPrice>(ENDPOINTS.pricesPublicModels),
    enabled: !permissionsPending && can("prices:read"),
  });

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const models = useMemo(() => {
    const rows = [...(modelsQuery.data?.items ?? [])];
    rows.sort(
      (a, b) =>
        (a.vendor_name ?? "").localeCompare(b.vendor_name ?? "", "zh") ||
        a.name.localeCompare(b.name, "zh"),
    );
    return rows;
  }, [modelsQuery.data]);

  // 稳定引用：每次渲染都 filter 出新数组会让行模型 memo 反复变化，见 DataTable 注释。
  const pending = useMemo(() => models.filter((model) => missingItems(model).length > 0), [models]);
  const availableCount = models.length - pending.length;
  const modelError =
    modelsQuery.error instanceof Error
      ? modelsQuery.error.message
      : modelsQuery.error
        ? "价目加载失败"
        : null;
  const priceError =
    pricesQuery.error instanceof Error
      ? pricesQuery.error.message
      : pricesQuery.error
        ? "公开模型价格加载失败"
        : null;

  const save = useMutation({
    mutationFn: ({ model, draft }: { model: UpstreamModel; draft: Draft }) =>
      api.patch<UpstreamModel>(ENDPOINTS.upstreamModelUpdate(model.id), {
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
      // 价目是派生的单一真相源：模型管理里的公开模型价格、看板与概览都跟着刷新。
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MODEL_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PUBLIC_PRICE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["public-models"] }),
        queryClient.invalidateQueries({ queryKey: ["model-targets"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
      ]);
      toast.success("价目已保存", {
        description: variables.model.name + " 的新价格即时生效，新请求按新价计费",
      });
    },
    onError: (error: Error, variables) => {
      toast.error("保存失败", { description: variables.model.name + "：" + error.message });
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

  /** Enter 直接保存当前行（与表格内嵌编辑的惯例一致），未改动或非法时不动。 */
  function onEnter(event: { key: string; preventDefault: () => void }, model: UpstreamModel) {
    if (event.key !== "Enter") return;
    const draft = drafts[model.id] ?? draftOf(model);
    if (!isDirty(model, draft) || !draftValid(draft) || save.isPending) return;
    event.preventDefault();
    save.mutate({ model, draft });
  }

  /** 成本上下两行：上行成本单价（可编辑），下行派生花费单价，合成一列。 */
  function costCell(model: UpstreamModel) {
    const draft = drafts[model.id] ?? draftOf(model);
    const rows = [
      {
        key: "input" as const,
        label: "输入",
        inputId: "cost-input-" + model.id,
        stored: model.cost_input_per_1m,
        value: draft.input,
        derived: spend(draft.input, draft.markup),
      },
      {
        key: "output" as const,
        label: "输出",
        inputId: "cost-output-" + model.id,
        stored: model.cost_output_per_1m,
        value: draft.output,
        derived: spend(draft.output, draft.markup),
      },
    ];
    return (
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.key} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-2xs text-faint">{row.label}</span>
              <span className="w-8 shrink-0 text-2xs text-faint">成本</span>
              {canEdit ? (
                <Input
                  id={row.inputId}
                  value={row.value}
                  onChange={(event) => setField(model, row.key, event.target.value)}
                  onKeyDown={(event) => onEnter(event, model)}
                  inputMode="decimal"
                  aria-label={model.name + " " + row.label + "成本单价"}
                  placeholder="未配置"
                  className="h-7 w-24 text-right tabular-nums"
                />
              ) : (
                <span className="w-24 text-right text-2sm tabular-nums text-title">
                  {money(row.stored)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0" />
              <span className="w-8 shrink-0 text-2xs text-faint">花费</span>
              <span
                className={
                  "w-24 text-right text-2sm tabular-nums " +
                  (row.derived ? "text-title" : "text-faint")
                }
              >
                {row.derived ?? "待补价"}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const costColumns: ColumnDef<UpstreamModel, unknown>[] = [
    {
      id: "model",
      accessorFn: (row) => [row.name, row.vendor_name, row.upstream_name, row.model_type].filter(Boolean).join(" "),
      header: "模型",
      cell: ({ row }) => {
        const model = row.original;
        const missing = missingItems(model);
        return (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-title">{model.name}</span>
              <Badge tone={model.enabled ? "success" : "neutral"}>
                {model.enabled ? "启用" : "停用"}
              </Badge>
            </div>
            <div className="mt-0.5 text-2xs text-faint">
              {[model.vendor_name, model.upstream_name, model.model_type].filter(Boolean).join(" · ")}
            </div>
            {missing.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {missing.map((item) => (
                  <Badge key={item} tone="warning">
                    {item}未配置
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "cost",
      header: () => (
        <span className="flex flex-col leading-tight">
          <span>成本 / 花费</span>
          <span className="font-normal text-faint">{UNIT_HINT}</span>
        </span>
      ),
      cell: ({ row }) => costCell(row.original),
    },
    {
      id: "markup",
      header: "倍率",
      cell: ({ row }) => {
        const model = row.original;
        const draft = drafts[model.id] ?? draftOf(model);
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-2xs text-faint">×</span>
              {canEdit ? (
                <Input
                  value={draft.markup}
                  onChange={(event) => setField(model, "markup", event.target.value)}
                  onKeyDown={(event) => onEnter(event, model)}
                  inputMode="decimal"
                  aria-label={model.name + " 倍率"}
                  className="h-7 w-20 text-right tabular-nums"
                />
              ) : (
                <span className="text-2sm tabular-nums text-title">{draft.markup}</span>
              )}
            </div>
            <div className="text-2xs text-faint">花费 = 成本 × 倍率</div>
            {canEdit && !draftValid(draft) ? (
              <div className="text-2xs text-danger">倍率需在 0–100，成本不能为负</div>
            ) : null}
          </div>
        );
      },
    },
  ];

  if (canEdit) {
    costColumns.push({
      id: "actions",
      header: () => <span className="block text-right">操作</span>,
      cell: ({ row }) => {
        const model = row.original;
        const draft = drafts[model.id] ?? draftOf(model);
        const dirty = isDirty(model, draft);
        const saving = save.isPending && save.variables?.model.id === model.id;
        return (
          <div className="flex items-center justify-end gap-1">
            {dirty ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => resetDraft(model.id)}
                disabled={saving}
              >
                撤销
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => save.mutate({ model, draft })}
              disabled={!dirty || !draftValid(draft) || saving}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        );
      },
    });
  }

  const publicColumns: ColumnDef<PublicModelPrice, unknown>[] = [
    {
      id: "name",
      accessorFn: (row) => row.name,
      header: "公开模型",
      cell: ({ row }) => {
        const price = row.original;
        return (
          <div className="flex items-center gap-2">
            <span className="font-medium text-title">{price.name}</span>
            <Badge tone="info">{ROUTING_LABEL[price.routing_mode] ?? price.routing_mode}</Badge>
          </div>
        );
      },
    },
    {
      id: "price",
      header: () => (
        <span className="flex flex-col leading-tight">
          <span>花费（加权平均）</span>
          <span className="font-normal text-faint">{UNIT_HINT}</span>
        </span>
      ),
      cell: ({ row }) => {
        const price = row.original;
        return (
          <div className="space-y-0.5 tabular-nums">
            <div>
              <span className="mr-2 text-2xs text-faint">输入</span>
              {money(price.price_input_per_1m)}
            </div>
            <div>
              <span className="mr-2 text-2xs text-faint">输出</span>
              {money(price.price_output_per_1m)}
            </div>
          </div>
        );
      },
    },
    {
      id: "members",
      header: "成员",
      cell: ({ row }) => {
        const price = row.original;
        return (
          <div className="space-y-0.5">
            <div className="text-body">
              {price.priced_members}/{price.total_members} 已定价
            </div>
            <div className="text-2xs text-faint">
              {price.weight_basis === "weight" ? "按成员权重" : "等权"}
            </div>
          </div>
        );
      },
    },
    {
      id: "status",
      header: "状态",
      cell: ({ row }) => {
        const price = row.original;
        return (
          <div className="space-y-1">
            {price.available ? (
              <Badge tone="success">可计算</Badge>
            ) : (
              <Badge tone="warning">{reasonText(price.reason)}</Badge>
            )}
            <div className="text-2xs text-faint">派生值，只读</div>
          </div>
        );
      },
    },
  ];

  const pendingColumns: ColumnDef<UpstreamModel, unknown>[] = [
    {
      id: "name",
      accessorFn: (row) => row.name,
      header: "模型",
      cell: ({ row }) => {
        const model = row.original;
        return (
          <div>
            <span className="font-medium text-title">{model.name}</span>
            <div className="text-2xs text-faint">
              {[model.vendor_name, model.upstream_name].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        );
      },
    },
    {
      id: "missing",
      header: "缺失项",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {missingItems(row.original).map((item) => (
            <Badge key={item} tone="warning">
              {item}未配置
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: "fill",
      header: () => <span className="block text-right">操作</span>,
      cell: ({ row }) =>
        canEdit ? (
          <div className="text-right">
            <Button
              size="sm"
              variant="outline"
              onClick={() => focusCostInput(row.original.id)}
            >
              去补价
            </Button>
          </div>
        ) : (
          <div className="text-right text-2xs text-faint">只读</div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-2sm text-body">
          上游模型按「成本 × 倍率」计费；公开模型价格由成员有效单价加权平均派生，只读，不能单独定价。金额单位为
          CNY / 1M 词元。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {canReadModels ? <Badge tone="neutral">上游模型 {models.length}</Badge> : null}
          {canCost ? (
            <>
              <Badge tone="success">已定价 {availableCount}</Badge>
              <Badge tone={pending.length > 0 ? "warning" : "neutral"}>待补价 {pending.length}</Badge>
            </>
          ) : null}
          <Badge tone="neutral">公开模型 {pricesQuery.data?.total ?? 0}</Badge>
        </div>
      </div>

      {!canCost ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-2sm text-faint">
          当前账号没有 <span className="font-medium text-body">billing:cost</span>{" "}
          权限：后端不会返回成本、倍率与毛利字段，因此成本、待补价与编辑入口都不显示；下方公开模型价格为只读派生值。
        </p>
      ) : null}

      {canCost ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-title">上游成本与倍率</h2>
              <p className="mt-1 text-2xs text-faint">
                成本与花费合并一列上下展示：上行为成本单价，下行为「成本 × 倍率」的花费单价。保存后新请求按新价计费，历史账目不重算。
              </p>
            </div>
            <span className="text-2xs text-faint">单位：{UNIT_HINT}</span>
          </div>

          {canReadModels ? (
            <DataTable
              columns={costColumns}
              data={models}
              loading={modelsQuery.isLoading}
              error={modelError}
              onRetry={() => void modelsQuery.refetch()}
              emptyText={canEdit ? "还没有上游模型" : "还没有可查看的上游模型"}
              filterPlaceholder="筛选模型 / 厂商 / 上游"
            />
          ) : (
            <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-2sm text-faint">
              当前账号没有 <span className="font-medium text-body">upstream_models:read</span>{" "}
              权限，看不到上游成本账；公开模型价格仍可在下方查看。
            </p>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-title">公开模型价格</h2>
            <p className="mt-1 text-2xs text-faint">
              由成员有效单价（成本 × 倍率）派生：weighted 按权重，failover / conditional
              等权；只展示加权平均价，无独立编辑入口。
            </p>
          </div>
          <span className="text-2xs text-faint">单位：{UNIT_HINT}</span>
        </div>
        <DataTable
          columns={publicColumns}
          data={pricesQuery.data?.items}
          loading={pricesQuery.isLoading}
          error={priceError}
          onRetry={() => void pricesQuery.refetch()}
          emptyText="还没有公开模型"
          filterPlaceholder="筛选公开模型"
        />
      </section>

      {canCost ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-title">待补价清单</h2>
              <p className="mt-1 text-2xs text-faint">
                缺少输入或输出成本价的模型；补齐后新请求按新价计费，历史账目不重算。
              </p>
            </div>
            <Badge tone={pending.length > 0 ? "warning" : "success"}>
              {pending.length > 0 ? pending.length + " 个待补价" : "已补齐"}
            </Badge>
          </div>
          {!canReadModels ? (
            <p className="rounded-lg border border-border bg-surface px-3 py-4 text-2sm text-faint">
              当前账号没有 <span className="font-medium text-body">upstream_models:read</span>{" "}
              权限，无法列出待补价模型。
            </p>
          ) : pending.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface px-3 py-4 text-2sm text-faint">
              所有上游模型都已配置成本价。
            </div>
          ) : (
            <DataTable
              columns={pendingColumns}
              data={pending}
              filterPlaceholder="筛选待补价模型"
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
