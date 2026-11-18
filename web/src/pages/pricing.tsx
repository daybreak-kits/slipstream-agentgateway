import { CachePricesSection } from "@/components/pricing/cache-prices";
import { PriceIoActions } from "@/components/pricing/price-io";
import { PublicPricesSection } from "@/components/pricing/public-prices";
import { UpstreamPricesSection } from "@/components/pricing/upstream-prices";
import { usePermissions } from "@/lib/permissions";

/**
 * 价目管理（ADR-020 / ADR-023 三期重做）：三段结构——
 * ① 上游进价（模型行成本 + 倍率是计费的现行权威，行内编辑 + 批量改价 + 未配价筛选）；
 * ② 缓存价（upstream_prices 版本化价目，读/写两列，编辑即追加新版本）；
 * ③ 公开模型售价（成员加权派生，只读）。页头提供价目 JSON 一键导出 / 导入。
 */
export function PricingPage() {
  const { can, isPending } = usePermissions();
  const canReadPrices = can("prices:read");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h1 font-semibold tracking-tight text-title">价目管理</h1>
          <p className="mt-1 text-2sm text-faint">
            上游进价与倍率是计费的现行权威（ADR-020）；公开模型售价按成员加权派生，只读。
          </p>
        </div>
        <PriceIoActions
          canExport={!isPending && can("upstream_models:read")}
          canImport={!isPending && can("upstream_models:write")}
        />
      </header>

      <UpstreamPricesSection />
      {canReadPrices ? (
        <CachePricesSection />
      ) : (
        <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-2sm text-faint">
          当前账号没有 <span className="font-medium text-body">prices:read</span>{" "}
          权限：缓存价与公开模型售价由后端裁剪，不展示。
        </p>
      )}
      {canReadPrices ? <PublicPricesSection /> : null}
    </div>
  );
}
