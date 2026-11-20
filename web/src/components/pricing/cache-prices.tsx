import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PriceTable, type PriceColumn } from "@/components/pricing/table";
import { UNIT_HINT, priceMicro } from "@/components/pricing/money";
import { invalidatePricing, pricingKeys, useUpstreamModels, useUpstreams, useVendors } from "@/components/pricing/queries";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { fmtUnitPriceMicro } from "@/lib/format";
import { formatDateTime, useTimezone } from "@/lib/time";
import { usePermissions } from "@/lib/permissions";
import type { UpstreamModel } from "@/types";

/**
 * /admin/prices/upstream 的行形状（l06_api/routers_billing.py）：vendor_id + 模型名字符串
 * + item 枚举 + 整数微单位单价，版本化追加。兼容旧 mock 的 vendor_name / effective_from。
 */
interface UpstreamPriceRow {
  id: string;
  vendor_id?: string;
  vendor_name?: string;
  upstream_model: string;
  item: string;
  unit_price_micro: number;
  currency: string;
  effective_from_ms?: number;
  effective_from?: string;
  version: number;
}

/** 一行展示：同一（上游渠道厂商, 模型）下缓存读/写的最新版本。 */
interface CachePair {
  vendorId: string;
  vendorName: string;
  model: string;
  read: UpstreamPriceRow | null;
  write: UpstreamPriceRow | null;
  effectiveMs: number | null;
}

function effectiveMs(row: UpstreamPriceRow | null | undefined): number | null {
  if (!row) return null;
  if (typeof row.effective_from_ms === "number") return row.effective_from_ms;
  if (row.effective_from) {
    const parsed = Date.parse(row.effective_from);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** page_size 档位限制 25/50/100/200：取 200 尽量覆盖全部版本行。 */
function useCachePrices(enabled: boolean) {
  return useQuery({
    queryKey: pricingKeys.cachePrices,
    queryFn: () => apiList<UpstreamPriceRow>(ENDPOINTS.pricesUpstream + "?page_size=200"),
    enabled,
  });
}

export function CachePricesSection() {
  const { mode } = useTimezone();
  const { can, isPending: permissionsPending } = usePermissions();
  const canReadPrices = can("prices:read");
  const canReadModels = can("upstream_models:read");
  const canReadUpstreams = can("upstreams:read");
  const canReadVendors = can("vendors:read");
  const canWrite = can("prices:write");
  // 新建入口依赖 vendor 定位数据（模型→上游→厂商），三者任一不可读就不提供
  const canCreate = canWrite && canReadModels && canReadUpstreams;

  const pricesQuery = useCachePrices(!permissionsPending && canReadPrices);
  const modelsQuery = useUpstreamModels(!permissionsPending && canReadModels);
  const upstreamsQuery = useUpstreams(!permissionsPending && canReadUpstreams);
  const vendorsQuery = useVendors(!permissionsPending && canReadVendors);

  const [searchText, setSearchText] = useState("");
  const [editing, setEditing] = useState<CachePair | null>(null);
  const [creating, setCreating] = useState(false);

  const vendorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const vendor of vendorsQuery.data?.items ?? []) map.set(vendor.id, vendor.name);
    return map;
  }, [vendorsQuery.data]);

  const upstreamVendor = useMemo(() => {
    const map = new Map<string, string>();
    for (const upstream of upstreamsQuery.data?.items ?? []) {
      map.set(upstream.id, upstream.vendor_id);
    }
    return map;
  }, [upstreamsQuery.data]);

  const pairs = useMemo<CachePair[]>(() => {
    const rows = [...(pricesQuery.data?.items ?? [])];
    // 每个范围（厂商, 模型, item）版本号最大者为现行价：先按版本倒序，折叠时首见即最新
    rows.sort(
      (a, b) => b.version - a.version || (effectiveMs(b) ?? 0) - (effectiveMs(a) ?? 0),
    );
    const map = new Map<string, { vendorId: string; vendorName: string; model: string; read: UpstreamPriceRow | null; write: UpstreamPriceRow | null }>();
    for (const row of rows) {
      if (row.item !== "cache_read" && row.item !== "cache_write") continue;
      const vendorId = row.vendor_id ?? "";
      const key = vendorId + "\u0000" + row.upstream_model;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          vendorId,
          vendorName: vendorNames.get(vendorId) ?? row.vendor_name ?? (vendorId || "—"),
          model: row.upstream_model,
          read: null,
          write: null,
        };
        map.set(key, entry);
      }
      if (row.item === "cache_read" && !entry.read) entry.read = row;
      if (row.item === "cache_write" && !entry.write) entry.write = row;
    }
    return [...map.values()].map((entry) => ({
      ...entry,
      effectiveMs: Math.max(effectiveMs(entry.read) ?? 0, effectiveMs(entry.write) ?? 0) || null,
    })).sort(
      (a, b) =>
        a.vendorName.localeCompare(b.vendorName, "zh") || a.model.localeCompare(b.model, "zh"),
    );
  }, [pricesQuery.data, vendorNames]);

  const filtered = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return pairs;
    return pairs.filter((pair) =>
      (pair.model + " " + pair.vendorName).toLowerCase().includes(query),
    );
  }, [pairs, searchText]);

  const cacheError = pricesQuery.error instanceof Error
    ? pricesQuery.error.message
    : pricesQuery.error
      ? "缓存价加载失败"
      : null;

  const columns: PriceColumn<CachePair>[] = [
    {
      key: "model",
      label: "模型",
      sortable: true,
      sortValue: (pair) => pair.model,
      cell: (pair) => (
        <div>
          <div className="font-medium text-title">{pair.model}</div>
          <div className="text-2xs text-faint">{pair.vendorName}</div>
        </div>
      ),
    },
    {
      key: "cache_read",
      label: "缓存读价",
      header: (
        <span className="flex flex-col leading-tight">
          <span>缓存读价</span>
          <span className="font-normal text-faint">{UNIT_HINT}</span>
        </span>
      ),
      sortable: true,
      sortValue: (pair) => pair.read?.unit_price_micro ?? null,
      className: "text-right",
      headerClassName: "text-right",
      cell: (pair) => (
        <span className="tnum text-body">
          {fmtUnitPriceMicro(pair.read?.unit_price_micro ?? null, pair.read?.currency ?? "CNY")}
        </span>
      ),
    },
    {
      key: "cache_write",
      label: "缓存写价",
      header: (
        <span className="flex flex-col leading-tight">
          <span>缓存写价</span>
          <span className="font-normal text-faint">{UNIT_HINT}</span>
        </span>
      ),
      sortable: true,
      sortValue: (pair) => pair.write?.unit_price_micro ?? null,
      className: "text-right",
      headerClassName: "text-right",
      cell: (pair) => (
        <span className="tnum text-body">
          {fmtUnitPriceMicro(pair.write?.unit_price_micro ?? null, pair.write?.currency ?? "CNY")}
        </span>
      ),
    },
    {
      key: "effective",
      label: "生效时间",
      sortable: true,
      sortValue: (pair) => pair.effectiveMs,
      cell: (pair) => <span className="tnum text-body">{formatDateTime(pair.effectiveMs, mode)}</span>,
    },
    {
      key: "actions",
      label: "操作",
      hideable: false,
      headerClassName: "text-right",
      className: "text-right",
      cell: (pair) =>
        canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(pair)}>
            编辑
          </Button>
        ) : (
          <span className="text-2xs text-faint">只读</span>
        ),
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-title">缓存价</h2>
          <p className="mt-1 text-2xs text-faint">
            上游渠道的缓存读 / 写单价按版本管理（upstream_prices）：编辑即追加新版本，历史保留；JSON 导入导出（v1）不含缓存价。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">缓存价模型 {pairs.length}</Badge>
          <span className="text-2xs text-faint">单位：{UNIT_HINT}</span>
          {canCreate ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              新建缓存价
            </Button>
          ) : null}
        </div>
      </div>

      <PriceTable
        columns={columns}
        rows={filtered}
        totalCount={pairs.length}
        loading={pricesQuery.isLoading}
        error={cacheError}
        onRetry={() => void pricesQuery.refetch()}
        sectionKey="cache"
        searchText={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="筛选模型 / 厂商"
        emptyText="还没有缓存价（cache_read / cache_write）"
        emptyAction={
          canCreate ? (
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              新建缓存价
            </Button>
          ) : undefined
        }
        onClearFilters={() => setSearchText("")}
        rowKey={(pair) => pair.vendorId + "\u0000" + pair.model}
      />

      {editing ? (
        <CachePriceDialog
          mode="edit"
          vendorId={editing.vendorId}
          vendorName={editing.vendorName}
          modelName={editing.model}
          currency={(editing.read ?? editing.write)?.currency ?? "CNY"}
          currentRead={editing.read?.unit_price_micro ?? null}
          currentWrite={editing.write?.unit_price_micro ?? null}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {creating ? (
        <CachePriceDialog
          mode="create"
          models={modelsQuery.data?.items ?? []}
          upstreamVendor={upstreamVendor}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </section>
  );
}

/** 新建 / 编辑缓存价：写现有 POST /admin/prices/upstream（版本化追加，按厂商 + 模型名 + item 定位）。 */
function CachePriceDialog({
  mode,
  vendorId = "",
  vendorName = "",
  modelName = "",
  currency = "CNY",
  currentRead = null,
  currentWrite = null,
  models = [],
  upstreamVendor,
  onClose,
}: {
  mode: "create" | "edit";
  vendorId?: string;
  vendorName?: string;
  modelName?: string;
  currency?: string;
  currentRead?: number | null;
  currentWrite?: number | null;
  models?: UpstreamModel[];
  upstreamVendor?: Map<string, string>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [modelId, setModelId] = useState("");
  const [read, setRead] = useState("");
  const [write, setWrite] = useState("");
  // W4-G 弹窗草稿守卫：填了内容/选了模型后 Esc、遮罩、取消不放行，先确认「放弃修改？」。
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const selectedModel = models.find((model) => model.id === modelId) ?? null;
  const targetVendorId = mode === "edit" ? vendorId : selectedModel ? (upstreamVendor?.get(selectedModel.upstream_id) ?? "") : "";
  const targetModel = mode === "edit" ? modelName : (selectedModel?.name ?? "");

  const readMicro = priceMicro(read);
  const writeMicro = priceMicro(write);
  const invalid =
    (read.trim() !== "" && readMicro === null) ||
    (write.trim() !== "" && writeMicro === null);
  const nothingFilled = read.trim() === "" && write.trim() === "";
  const canSubmit =
    !invalid && !nothingFilled && (mode === "edit" || (selectedModel && targetVendorId));

  const dirty = !nothingFilled || (mode === "create" && modelId !== "");
  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const save = useMutation({
    mutationFn: async () => {
      // 编辑 = 各 item 追加一个新版本；currency 沿用该范围现行价（无历史时 CNY）
      const items: Array<{ item: "cache_read" | "cache_write"; micro: number | null }> = [
        { item: "cache_read", micro: readMicro },
        { item: "cache_write", micro: writeMicro },
      ];
      const results = await Promise.allSettled(
        items
          .filter((entry): entry is { item: "cache_read" | "cache_write"; micro: number } => entry.micro !== null)
          .map((entry) =>
            api.post(ENDPOINTS.pricesUpstream, {
              vendor_id: targetVendorId,
              upstream_model: targetModel,
              item: entry.item,
              unit_price_micro: entry.micro,
              currency,
            }),
          ),
      );
      const failed = results.filter((item) => item.status === "rejected").length;
      const firstError = results.find(
        (item): item is PromiseRejectedResult => item.status === "rejected",
      );
      return { total: results.length, failed, firstError: firstError?.reason as Error | undefined };
    },
    onSuccess: async ({ total, failed, firstError }) => {
      if (failed === 0) {
        toast.success("缓存价已保存", { description: "追加 " + total + " 个新版本，从当前时间生效" });
      } else {
        toast.warning("缓存价部分保存", {
          description:
            "成功 " + (total - failed) + " 个；失败 " + failed + " 个" +
            (firstError ? "：" + firstError.message : ""),
        });
      }
      await invalidatePricing(queryClient);
      onClose();
    },
  });

  return (
    <>
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "编辑缓存价 · " + vendorName + " / " + modelName : "新建缓存价"}
          </DialogTitle>
        </DialogHeader>
        {mode === "create" ? (
          <label className="space-y-1">
            <span className="text-2xs text-faint">上游模型（厂商随模型所属上游）</span>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger aria-label="选择上游模型" className="w-full">
                <SelectValue placeholder="选择上游模型" />
              </SelectTrigger>
              <SelectContent>
                {(models ?? []).map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name + (model.upstream_name ? " · " + model.upstream_name : "")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : (
          <p className="text-2xs text-faint">
            现价：读 {fmtUnitPriceMicro(currentRead, currency)} · 写 {fmtUnitPriceMicro(currentWrite, currency)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-2xs text-faint">缓存读价 {UNIT_HINT}</span>
            <Input
              value={read}
              onChange={(event) => setRead(event.target.value)}
              placeholder={mode === "edit" ? "留空不动" : "留空不创建"}
              inputMode="decimal"
              aria-label="缓存读价"
              className="tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-2xs text-faint">缓存写价 {UNIT_HINT}</span>
            <Input
              value={write}
              onChange={(event) => setWrite(event.target.value)}
              placeholder={mode === "edit" ? "留空不动" : "留空不创建"}
              inputMode="decimal"
              aria-label="缓存写价"
              className="tabular-nums"
            />
          </label>
        </div>
        <p className="text-2xs text-faint">
          缓存价按版本追加：保存生成新版本并从当前时间生效，历史版本保留，不计入 JSON 导入导出（v1）。
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={requestClose}>取消</Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!canSubmit || save.isPending}
          >
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmDiscard ? (
      <ConfirmDialog
        open
        onOpenChange={(open) => { if (!open) setConfirmDiscard(false); }}
        title="放弃修改？"
        description="弹窗内已填的缓存价不会写入，关闭后将丢失。"
        confirmLabel="放弃修改"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    ) : null}
    </>
  );
}
