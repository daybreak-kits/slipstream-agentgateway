import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ResultCell } from "@/components/ui/table";
import { PriceTable, type PriceColumn } from "@/components/pricing/table";
import { UNIT_HINT } from "@/components/pricing/money";
import { usePublicModels, usePublicPrices } from "@/components/pricing/queries";
import { fmtPriceAmount } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import type { PublicModel, PublicModelPrice } from "@/types";

const ROUTING_LABEL: Record<string, string> = {
  failover: "故障转移",
  weighted: "加权",
  conditional: "条件",
};

function reasonText(reason: string): string {
  if (reason === "weights_zero") return "权重为 0";
  if (reason === "no_priced_members") return "成员未定价";
  return "不可计算";
}

/** 只读派生段：公开模型售价 = 成员有效单价（成本 × 倍率）按权重加权平均（ADR-017）。 */
export function PublicPricesSection() {
  const { can, isPending: permissionsPending } = usePermissions();
  const canReadPrices = can("prices:read");
  const canReadPublicModels = can("public_models:read");

  // public-models 列表带 targets 内联成员，供成员构成摘要；key 与模型管理页共享
  const modelsQuery = usePublicModels(!permissionsPending && canReadPublicModels);
  const pricesQuery = usePublicPrices(!permissionsPending && canReadPrices);

  const [searchText, setSearchText] = useState("");

  const memberSummary = useMemo(() => {
    const map = new Map<string, PublicModel>();
    for (const model of modelsQuery.data ?? []) map.set(model.id, model);
    return map;
  }, [modelsQuery.data]);

  const prices = useMemo(() => pricesQuery.data ?? [], [pricesQuery.data]);
  const filtered = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return prices;
    return prices.filter((price) => price.name.toLowerCase().includes(query));
  }, [prices, searchText]);

  const priceError = pricesQuery.error instanceof Error
    ? pricesQuery.error.message
    : pricesQuery.error
      ? "公开模型售价加载失败"
      : null;

  const columns: PriceColumn<PublicModelPrice>[] = [
    {
      key: "name",
      label: "公开模型",
      sortable: true,
      sortValue: (price) => price.name,
      cell: (price) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-title">{price.name}</span>
          <Badge tone="info">{ROUTING_LABEL[price.routing_mode] ?? price.routing_mode}</Badge>
        </div>
      ),
    },
    {
      key: "price",
      label: "加权售价（入·出）",
      width: "9rem",
      header: (
        <span className="flex flex-col leading-tight">
          <span>加权售价（入·出）</span>
          <span className="font-normal text-faint">{UNIT_HINT}</span>
        </span>
      ),
      sortable: true,
      sortValue: (price) =>
        price.price_input_per_1m === null ? null : Number(price.price_input_per_1m),
      className: "text-right",
      headerClassName: "text-right",
      cell: (price) => (
        <div className="space-y-0.5 tabular-nums">
          <div>
            <span className="mr-1.5 text-2xs text-faint">入</span>
            <span className={price.available ? "text-title" : "text-faint"}>
              {fmtPriceAmount(price.price_input_per_1m, price.currency)}
            </span>
          </div>
          <div>
            <span className="mr-1.5 text-2xs text-faint">出</span>
            <span className={price.available ? "text-title" : "text-faint"}>
              {fmtPriceAmount(price.price_output_per_1m, price.currency)}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "members",
      label: "成员构成",
      width: "16rem",
      cell: (price) => {
        const model = memberSummary.get(price.public_model_id);
        const summary = (model?.targets ?? [])
          .map((target) =>
            target.upstream_model_name +
            (target.weight != null && price.weight_basis === "weight" ? " ×" + target.weight : ""),
          )
          .join("、");
        return (
          <ResultCell
            primary={
              <span className="min-w-0 truncate text-body" title={summary || undefined}>
                {summary || "-"}
              </span>
            }
            secondary={
              price.priced_members +
              "/" +
              price.total_members +
              " 已定价 · " +
              (price.weight_basis === "weight" ? "按成员权重" : "等权")
            }
          />
        );
      },
    },
    {
      key: "status",
      label: "状态",
      width: "7rem",
      cell: (price) =>
        price.available ? (
          <Badge tone="success">可计算</Badge>
        ) : (
          <Badge tone="warning">{reasonText(price.reason)}</Badge>
        ),
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-title">公开模型售价</h2>
          <p className="mt-1 text-2xs text-faint">
            按成员加权平均派生，只读；结算以实际命中成员单价为准（ADR-017），公开模型不单独定价。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">公开模型 {prices.length}</Badge>
          <span className="text-2xs text-faint">单位：{UNIT_HINT}</span>
        </div>
      </div>

      <PriceTable
        columns={columns}
        rows={filtered}
        totalCount={prices.length}
        loading={pricesQuery.isLoading}
        error={priceError}
        onRetry={() => void pricesQuery.refetch()}
        sectionKey="public"
        searchText={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="筛选公开模型"
        layout="fixed"
        emptyText="还没有公开模型"
        onClearFilters={() => setSearchText("")}
        rowKey={(price) => price.public_model_id}
      />
    </section>
  );
}
