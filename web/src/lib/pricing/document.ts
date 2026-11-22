import type { PriceExportFile } from "@/lib/control-plane/operations/prices";
import { ApiError } from "@/lib/control-plane/errors";

/**
 * 价目 JSON 文档（ADR-020，W8 ticket 07）：在浏览器里直接编辑整份价目文件的纯 codec。
 *
 * 形状与 GET /admin/prices/export 完全一致，保存走 POST /admin/prices/import；本模块在
 * 发请求前逐字段校验，不把明显非法的整批交给后端。校验口径尽量与后端
 * l05_service/pricing.py 的 import_model_prices / validate_cost / validate_markup 对齐：
 * - 行按 id 优先、name 兜底定位现有上游模型；未知 id、重名歧义、重复条目都是整批错误；
 * - 成本必须是非负数字，倍率必须在 (0, 100]；null/空串表示「不改该字段」；
 * - 行与顶层都不接受未知字段（与后端 extra="forbid" 一致）。
 *
 * 纯函数、不碰 DOM/fetch，便于 node 环境单测；页面只消费 parse/format/错误归一结果。
 */

export const PRICE_DOCUMENT_SCHEMA_VERSION = 1;
/** v1 文件只含模型行进价；缓存价仍在版本化价目里维护（与后端 CACHE_PRICES_SCOPE 一致）。 */
export const CACHE_PRICES_SCOPE = "not_included_v1";
const MAX_MARKUP = 100;

const TOP_LEVEL_FIELDS = ["schema_version", "exported_at_ms", "meta", "upstream_models"] as const;
const ROW_FIELDS = [
  "id",
  "name",
  "model_type",
  "cost_input_per_1m",
  "cost_output_per_1m",
  "markup",
] as const;

/** 定位价目行用的上游模型标识（id 优先、name 兜底）。 */
export interface PriceModelRef {
  id: string;
  name: string;
}

/** 规范化后的价目行：数值字段统一为字符串（后端 Decimal 走字符串 wire 形状）。 */
export interface PriceDocumentRow {
  id: string | null;
  name: string | null;
  model_type: string | null;
  cost_input_per_1m: string | null;
  cost_output_per_1m: string | null;
  markup: string | null;
}

/** 校验通过的价目文档：可直接作为 importPrices 的入参。 */
export interface PriceDocument extends PriceExportFile {
  schema_version: number;
  upstream_models: PriceDocumentRow[];
}

export interface PriceDocumentIssue {
  /** 0 起的行号；顶层问题时缺省。 */
  index?: number;
  id?: string | null;
  name?: string | null;
  message: string;
}

export interface ParsePriceDocumentResult {
  document: PriceDocument | null;
  issues: PriceDocumentIssue[];
}

/** 后端逐行校验错误（422 details.errors 的一项），用于表格展示。 */
export interface PriceImportErrorRow {
  index: number;
  id: string | null;
  name: string | null;
  message: string;
}

const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnownField(field: string, allowed: readonly string[]): boolean {
  return allowed.includes(field);
}

/** 把 null/空白归一为空值；非字符串类型报错。 */
function optionalText(
  value: unknown,
  field: string,
  problems: string[],
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    problems.push(field + " 必须是字符串或 null");
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** 成本字段：null/空白 = 不改；否则必须是非负数字。返回规范化字符串或 null。 */
function costValue(value: unknown, field: string, problems: string[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : null;
  if (text === null || !DECIMAL_TEXT.test(text) || !Number.isFinite(Number(text))) {
    problems.push(field + " 必须是数字");
    return null;
  }
  const parsed = Number(text);
  if (parsed < 0) {
    problems.push(field + " 不能为负数");
    return null;
  }
  return text;
}

/** 倍率：null/空白 = 不改；否则必须是 (0, 100] 的数字。返回规范化字符串或 null。 */
function markupValue(value: unknown, problems: string[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : null;
  if (text === null || !DECIMAL_TEXT.test(text) || !Number.isFinite(Number(text))) {
    problems.push("markup 必须是数字");
    return null;
  }
  const parsed = Number(text);
  if (parsed <= 0) {
    problems.push("markup 必须大于 0（花费 = 成本 × 倍率）");
    return null;
  }
  if (parsed > MAX_MARKUP) {
    problems.push("markup 不能超过 " + MAX_MARKUP);
    return null;
  }
  return text;
}

type LocateResult = { target: PriceModelRef; error: null } | { target: null; error: string };

/** 与后端 _locate_import_target 同规则：id 优先（未知 id 不回落 name），name 兜底且歧义报错。 */
function locateRow(
  id: string | null,
  name: string | null,
  models: readonly PriceModelRef[],
): LocateResult {
  if (id !== null) {
    const byId = models.find((model) => model.id === id);
    return byId ? { target: byId, error: null } : { target: null, error: "未知上游模型 id: " + id };
  }
  if (name !== null) {
    const matches = models.filter((model) => model.name === name);
    if (matches.length > 1) {
      return {
        target: null,
        error:
          "模型名重名歧义: " + name + "（" + matches.length + " 条同名模型，请改用 id 定位）",
      };
    }
    if (matches.length === 0) return { target: null, error: "未知上游模型: " + name };
    const first = matches[0];
    return first ? { target: first, error: null } : { target: null, error: "未知上游模型: " + name };
  }
  return { target: null, error: "缺少 id 或 name，无法定位上游模型" };
}

function parseDocumentBody(raw: Record<string, unknown>, models: readonly PriceModelRef[]): {
  document: PriceDocument | null;
  issues: PriceDocumentIssue[];
} {
  const issues: PriceDocumentIssue[] = [];
  for (const field of Object.keys(raw)) {
    if (!isKnownField(field, TOP_LEVEL_FIELDS)) {
      issues.push({ message: "未知顶层字段：" + field });
    }
  }

  let schemaVersion = PRICE_DOCUMENT_SCHEMA_VERSION;
  if (raw.schema_version !== undefined && raw.schema_version !== null) {
    if (typeof raw.schema_version !== "number" || !Number.isInteger(raw.schema_version)) {
      issues.push({ message: "schema_version 必须是整数" });
    } else if (raw.schema_version !== PRICE_DOCUMENT_SCHEMA_VERSION) {
      issues.push({ message: "不支持的 schema_version，当前仅支持 " + PRICE_DOCUMENT_SCHEMA_VERSION });
    } else {
      schemaVersion = raw.schema_version;
    }
  }

  let exportedAt: number | undefined;
  if (raw.exported_at_ms !== undefined && raw.exported_at_ms !== null) {
    if (typeof raw.exported_at_ms !== "number" || !Number.isInteger(raw.exported_at_ms)) {
      issues.push({ message: "exported_at_ms 必须是整数毫秒时间戳" });
    } else {
      exportedAt = raw.exported_at_ms;
    }
  }

  let meta: Record<string, unknown> | undefined;
  if (raw.meta !== undefined && raw.meta !== null) {
    if (!isPlainObject(raw.meta)) {
      issues.push({ message: "meta 必须是对象或 null" });
    } else {
      meta = raw.meta;
    }
  }

  const rawRows = raw.upstream_models;
  let rows: unknown[] = [];
  if (rawRows === undefined) {
    issues.push({ message: "缺少 upstream_models 数组" });
  } else if (!Array.isArray(rawRows)) {
    issues.push({ message: "upstream_models 必须是数组" });
  } else if (rawRows.length === 0) {
    issues.push({ message: "upstream_models 不能为空（至少一行）" });
  } else {
    rows = rawRows;
  }

  const normalizedRows: PriceDocumentRow[] = [];
  const claimed = new Set<string>();
  rows.forEach((item, index) => {
    if (!isPlainObject(item)) {
      issues.push({ index, message: "行必须是对象" });
      return;
    }
    const problems: string[] = [];
    for (const field of Object.keys(item)) {
      if (!isKnownField(field, ROW_FIELDS)) problems.push("未知字段：" + field);
    }

    const locatorProblems: string[] = [];
    const id = optionalText(item.id, "id", locatorProblems);
    const name = optionalText(item.name, "name", locatorProblems);
    const modelType = optionalText(item.model_type, "model_type", problems);
    const costInput = costValue(item.cost_input_per_1m, "cost_input_per_1m", problems);
    const costOutput = costValue(item.cost_output_per_1m, "cost_output_per_1m", problems);
    const markup = markupValue(item.markup, problems);

    const context = { index, id, name };
    if (locatorProblems.length > 0) {
      issues.push({ ...context, message: locatorProblems.join("；") });
      return;
    }
    const located = locateRow(id, name, models);
    if (located.error !== null) {
      issues.push({ ...context, message: located.error });
      return;
    }
    const target = located.target;
    if (claimed.has(target.id)) {
      issues.push({
        ...context,
        message: "重复条目：模型 " + target.id + "（" + target.name + "）在本批中出现多次",
      });
      return;
    }
    if (problems.length > 0) {
      issues.push({ ...context, message: problems.join("；") });
      return;
    }
    claimed.add(target.id);
    normalizedRows.push({
      id,
      name,
      model_type: modelType,
      cost_input_per_1m: costInput,
      cost_output_per_1m: costOutput,
      markup,
    });
  });

  if (issues.length > 0) return { document: null, issues };
  return {
    document: {
      schema_version: schemaVersion,
      ...(exportedAt !== undefined ? { exported_at_ms: exportedAt } : {}),
      ...(meta !== undefined ? { meta } : {}),
      upstream_models: normalizedRows,
    },
    issues: [],
  };
}

/**
 * 解析价目 JSON 文本并逐行校验；models 传入时按后端定位规则检查未知模型/歧义/重复。
 * 任何一处错误都返回 document=null，页面据此禁用保存并把 issues 逐行展示。
 */
export function parsePriceDocumentJson(
  text: string,
  models: readonly PriceModelRef[] = [],
): ParsePriceDocumentResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      document: null,
      issues: [
        {
          message: "JSON 解析失败：" + (error instanceof Error ? error.message : String(error)),
        },
      ],
    };
  }
  if (!isPlainObject(raw)) {
    return { document: null, issues: [{ message: "JSON 顶层必须是对象" }] };
  }
  return parseDocumentBody(raw, models);
}

/** 行内编辑草稿：空串表示「未配置」（保存时清空为 null），与 upstream-prices 的 Draft 同形。 */
export interface PriceDraftValues {
  input: string;
  output: string;
  markup: string;
}

/** 价目行对应的上游模型（除定位外还提供持久值，供 JSON→表格回填）。 */
export interface PriceDocumentModel extends PriceModelRef {
  model_type?: string | null;
  cost_input_per_1m?: string | null;
  cost_output_per_1m?: string | null;
  markup?: string | null;
}

function draftText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim() === "" ? null : value;
}

/**
 * 由模型列表 + 未保存草稿生成导出文件形状的价目文档；草稿优先于持久值。
 * 空白草稿输出 null（后端语义「不改」），非法草稿保留原文以便 JSON 校验暴露。
 */
export function priceDocumentFromModels(
  models: readonly PriceDocumentModel[],
  drafts: Record<string, PriceDraftValues> = {},
): PriceDocument {
  return {
    schema_version: PRICE_DOCUMENT_SCHEMA_VERSION,
    exported_at_ms: Date.now(),
    meta: { cache_prices: CACHE_PRICES_SCOPE },
    upstream_models: models.map((model) => {
      const draft = drafts[model.id];
      return {
        id: model.id,
        name: model.name,
        model_type: model.model_type ?? null,
        cost_input_per_1m: draftText(draft ? draft.input : model.cost_input_per_1m),
        cost_output_per_1m: draftText(draft ? draft.output : model.cost_output_per_1m),
        markup: draftText(draft ? draft.markup : model.markup) ?? "1.0000",
      };
    }),
  };
}

/** 生成可在页面内直接编辑的价目 JSON 文本（与导出文件同形状）。 */
export function formatPriceDocument(
  models: readonly PriceDocumentModel[],
  drafts: Record<string, PriceDraftValues> = {},
): string {
  return JSON.stringify(priceDocumentFromModels(models, drafts), null, 2);
}

/**
 * 把校验通过的 JSON 文档回写成表格草稿：非空字段覆盖草稿，null/空白字段不改动
 * （保留已有草稿，否则回填持久值）——导入语义是「不改」，这样切换视图不丢未保存编辑。
 */
export function draftsFromPriceDocument(
  document: PriceDocument,
  models: readonly PriceDocumentModel[],
  current: Record<string, PriceDraftValues> = {},
): Record<string, PriceDraftValues> {
  const drafts: Record<string, PriceDraftValues> = {};
  for (const row of document.upstream_models) {
    const located = locateRow(row.id ?? null, row.name ?? null, models);
    if (located.error !== null) continue;
    const target = located.target;
    const existing = current[target.id];
    const model = models.find((item) => item.id === target.id);
    drafts[target.id] = {
      input:
        row.cost_input_per_1m ??
        existing?.input ??
        model?.cost_input_per_1m ??
        "",
      output:
        row.cost_output_per_1m ??
        existing?.output ??
        model?.cost_output_per_1m ??
        "",
      markup: row.markup ?? existing?.markup ?? model?.markup ?? "1.0000",
    };
  }
  return drafts;
}

/** 后端 422 details.errors 归一为逐行错误；形状不符时返回空数组。 */
export function normalizePriceImportErrors(error: ApiError): PriceImportErrorRow[] {
  const raw = error.details.errors;
  if (!Array.isArray(raw)) return [];
  return raw.map((item, position) => {
    const row = isPlainObject(item) ? item : {};
    return {
      index: typeof row.index === "number" ? row.index : position,
      id: row.id === null || row.id === undefined ? null : String(row.id),
      name: row.name === null || row.name === undefined ? null : String(row.name),
      message: String(row.message ?? "未知错误"),
    };
  });
}
