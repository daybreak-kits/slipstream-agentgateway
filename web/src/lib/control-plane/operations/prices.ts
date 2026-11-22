import type { UpstreamPrice, PublicModelPrice } from "@/types";

import type { OperationOptions } from "../types";

/** /admin/prices/upstream 的行形状（ADR-030）：挂 upstream_model_id + item + 整数微单位单价。 */
export interface UpstreamPriceRow {
  id: string;
  upstream_model_id: string;
  item: string;
  unit_price_micro: number;
  currency: string;
  effective_from_ms?: number;
  version: number;
}

/** 追加一个价目版本（缓存读/写价）。 */
export interface UpstreamPriceInput {
  upstream_model_id: string;
  item: "cache_read" | "cache_write" | string;
  unit_price_micro: number;
  currency: string;
}

/** 价目 JSON 导出文件（v1 不含缓存价）。 */
export interface PriceExportFile {
  schema_version?: number;
  exported_at_ms?: number;
  meta?: Record<string, unknown>;
  upstream_models: Array<Record<string, unknown>>;
}

export interface PriceImportResult {
  changed: number;
  skipped?: number;
}

/**
 * 价目操作（ADR-020）：缓存价版本行、公开模型派生价、JSON 导入导出。
 * 模型行成本/倍率的写入归 models 域（updateUpstreamModel），不在本域重复。
 */
export interface PricesOperations {
  /** GET /admin/prices/upstream：全部版本行（页面固定取 200 条）。 */
  upstreamPrices(options?: OperationOptions): Promise<UpstreamPriceRow[]>;
  /** POST /admin/prices/upstream：追加一个版本行。 */
  addUpstreamPrice(body: UpstreamPriceInput): Promise<UpstreamPriceRow>;
  /** GET /admin/prices/public-models：公开模型派生价（只读）。 */
  publicModelPrices(options?: OperationOptions): Promise<PublicModelPrice[]>;
  /** GET /admin/prices/export：导出当前价目文件。 */
  exportPrices(options?: OperationOptions): Promise<PriceExportFile>;
  /** POST /admin/prices/import：整批导入，任一行失败全批 422。 */
  importPrices(body: PriceExportFile): Promise<PriceImportResult>;
}

/** 未定价条目（ticket 17 口径）：成本/花费两侧待补价行。 */
export interface UnpricedList {
  cost: Array<Record<string, unknown>>;
  charge: Array<Record<string, unknown>>;
}

export type { UpstreamPrice };
