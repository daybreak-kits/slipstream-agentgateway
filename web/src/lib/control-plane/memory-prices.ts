import type { UpstreamPrice } from "@/types";

import { clone } from "./memory-adapter";
import { derivePublicModelPrices, upstreamModels, upstreamPrices } from "./memory/fixtures";
import type { PriceExportFile, PricesOperations, UpstreamPriceRow } from "./operations/prices";

let priceSeq = upstreamPrices.length;

/** 内存价目域：缓存价追加版本；导出/导入与 models 行的成本字段同源。 */
export function createMemoryPrices(): PricesOperations {
  return {
    upstreamPrices: async () => clone(upstreamPrices) as UpstreamPriceRow[],
    addUpstreamPrice: async (body) => {
      const sameScope = upstreamPrices.filter(
        (row) => row.upstream_model_id === body.upstream_model_id && row.item === body.item,
      );
      const version = sameScope.reduce((max, row) => Math.max(max, row.version), 0) + 1;
      priceSeq += 1;
      const row: UpstreamPrice = {
        id: "up_" + String(priceSeq).padStart(3, "0"),
        upstream_model_id: body.upstream_model_id,
        item: body.item as UpstreamPrice["item"],
        unit_price_micro: body.unit_price_micro,
        currency: body.currency,
        effective_from_ms: Date.now(),
        version,
      };
      upstreamPrices.push(row);
      return clone(row) as UpstreamPriceRow;
    },
    publicModelPrices: async () => derivePublicModelPrices(),
    exportPrices: async (): Promise<PriceExportFile> => ({
      schema_version: 1,
      exported_at_ms: Date.now(),
      meta: { cache_prices: "out-of-scope-v1" },
      upstream_models: upstreamModels.map((model) => ({
        id: model.id,
        name: model.name,
        model_type: model.model_type,
        cost_input_per_1m: model.cost_input_per_1m ?? null,
        cost_output_per_1m: model.cost_output_per_1m ?? null,
        markup: model.markup ?? null,
      })),
    }),
    importPrices: async (body) => {
      let changed = 0;
      let skipped = 0;
      for (const item of body.upstream_models) {
        const row = upstreamModels.find((model) =>
          item.id ? model.id === item.id : model.name === item.name,
        );
        if (!row) continue;
        const patch: Partial<typeof row> = {};
        if (typeof item.cost_input_per_1m === "string") patch.cost_input_per_1m = item.cost_input_per_1m;
        if (typeof item.cost_output_per_1m === "string") patch.cost_output_per_1m = item.cost_output_per_1m;
        if (typeof item.markup === "string") patch.markup = item.markup;
        if (Object.keys(patch).length === 0) {
          skipped += 1;
          continue;
        }
        Object.assign(row, patch);
        changed += 1;
      }
      return { changed, skipped };
    },
  };
}
