import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/control-plane/errors";

import {
  draftsFromPriceDocument,
  formatPriceDocument,
  normalizePriceImportErrors,
  parsePriceDocumentJson,
  type PriceModelRef,
} from "./document";

const models: PriceModelRef[] = [
  { id: "m1", name: "gpt-a" },
  { id: "m2", name: "claude-b" },
];

const exported = {
  schema_version: 1,
  exported_at_ms: 1730000000000,
  meta: { cache_prices: "not_included_v1" },
  upstream_models: [
    {
      id: "m1",
      name: "gpt-a",
      model_type: "chat",
      cost_input_per_1m: "1.500000",
      cost_output_per_1m: null,
      markup: "1.2000",
    },
    {
      id: "m2",
      name: "claude-b",
      model_type: "chat",
      cost_input_per_1m: "",
      cost_output_per_1m: "3",
      markup: null,
    },
  ],
};

function documentWith(rows: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ schema_version: 1, upstream_models: rows, ...extra });
}

function issuesOf(text: string, refs: PriceModelRef[] = models) {
  return parsePriceDocumentJson(text, refs).issues.map((issue) => issue.message);
}

describe("价目 JSON 文档：解析与形状校验", () => {
  it("合法导出文件解析为规范化文档（空串归一为 null）", () => {
    const result = parsePriceDocumentJson(JSON.stringify(exported), models);
    expect(result.issues).toEqual([]);
    expect(result.document).not.toBeNull();
    expect(result.document?.schema_version).toBe(1);
    expect(result.document?.exported_at_ms).toBe(1730000000000);
    expect(result.document?.meta).toEqual({ cache_prices: "not_included_v1" });
    expect(result.document?.upstream_models).toHaveLength(2);
    expect(result.document?.upstream_models[0]).toEqual({
      id: "m1",
      name: "gpt-a",
      model_type: "chat",
      cost_input_per_1m: "1.500000",
      cost_output_per_1m: null,
      markup: "1.2000",
    });
    expect(result.document?.upstream_models[1]).toEqual({
      id: "m2",
      name: "claude-b",
      model_type: "chat",
      cost_input_per_1m: null,
      cost_output_per_1m: "3",
      markup: null,
    });
  });

  it("JSON 语法错误逐条报错且不产出文档", () => {
    const result = parsePriceDocumentJson("{", models);
    expect(result.document).toBeNull();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain("JSON 解析失败");
  });

  it("顶层必须是对象，upstream_models 必填且非空", () => {
    expect(issuesOf("[]")).toEqual(["JSON 顶层必须是对象"]);
    expect(issuesOf(JSON.stringify({ schema_version: 1 }))).toEqual([
      "缺少 upstream_models 数组",
    ]);
    expect(
      issuesOf(JSON.stringify({ schema_version: 1, upstream_models: {} })),
    ).toEqual(["upstream_models 必须是数组"]);
    expect(issuesOf(JSON.stringify({ schema_version: 1, upstream_models: [] }))).toEqual([
      "upstream_models 不能为空（至少一行）",
    ]);
  });

  it("未知顶层字段与未知行字段被拒绝", () => {
    const topLevel = issuesOf(JSON.stringify({ ...exported, extra: true }));
    expect(topLevel.some((message) => message.includes("extra"))).toBe(true);

    const rowLevel = issuesOf(
      documentWith([{ id: "m1", name: "gpt-a", enabled: true }]),
    );
    expect(
      rowLevel.some(
        (message) => message.includes("未知字段") && message.includes("enabled"),
      ),
    ).toBe(true);
  });

  it("schema_version / exported_at_ms / meta 类型严格校验", () => {
    expect(issuesOf(JSON.stringify({ ...exported, schema_version: 2 }))).toEqual([
      "不支持的 schema_version，当前仅支持 1",
    ]);
    expect(issuesOf(JSON.stringify({ ...exported, schema_version: "1" }))).toContain(
      "schema_version 必须是整数",
    );
    expect(issuesOf(JSON.stringify({ ...exported, exported_at_ms: 1.5 }))).toContain(
      "exported_at_ms 必须是整数毫秒时间戳",
    );
    expect(issuesOf(JSON.stringify({ ...exported, meta: [] }))).toEqual([
      "meta 必须是对象或 null",
    ]);
  });

  it("缺少 schema_version 时按后端默认值 1 接受", () => {
    const result = parsePriceDocumentJson(
      JSON.stringify({ upstream_models: [{ id: "m1", cost_input_per_1m: "2" }] }),
      models,
    );
    expect(result.issues).toEqual([]);
    expect(result.document?.schema_version).toBe(1);
  });
});

describe("价目 JSON 文档：逐行定位与字段校验", () => {
  it("id/name 至少一个，且按后端规则定位（id 优先）", () => {
    expect(issuesOf(documentWith([{ cost_input_per_1m: "1" }]))).toEqual([
      "缺少 id 或 name，无法定位上游模型",
    ]);
    expect(issuesOf(documentWith([{ id: "", name: "   ", cost_input_per_1m: "1" }]))).toEqual([
      "缺少 id 或 name，无法定位上游模型",
    ]);
    const byId = parsePriceDocumentJson(
      documentWith([{ id: " m1 ", name: "claude-b", cost_input_per_1m: "2" }]),
      models,
    );
    expect(byId.issues).toEqual([]);
    expect(byId.document?.upstream_models[0]?.id).toBe("m1");
    const byName = parsePriceDocumentJson(
      documentWith([{ name: "claude-b", cost_output_per_1m: "2" }]),
      models,
    );
    expect(byName.issues).toEqual([]);
    expect(byName.document?.upstream_models[0]?.cost_output_per_1m).toBe("2");
  });

  it("未知模型、重名歧义、重复条目逐行报错", () => {
    expect(issuesOf(documentWith([{ id: "nope", cost_input_per_1m: "1" }]))).toEqual([
      "未知上游模型 id: nope",
    ]);
    expect(issuesOf(documentWith([{ name: "nope", cost_input_per_1m: "1" }]))).toEqual([
      "未知上游模型: nope",
    ]);
    const ambiguous: PriceModelRef[] = [
      { id: "a1", name: "dup" },
      { id: "a2", name: "dup" },
    ];
    expect(
      issuesOf(documentWith([{ name: "dup", cost_input_per_1m: "1" }]), ambiguous),
    ).toEqual(["模型名重名歧义: dup（2 条同名模型，请改用 id 定位）"]);
    expect(
      issuesOf(
        documentWith([
          { id: "m1", cost_input_per_1m: "1" },
          { name: "gpt-a", cost_input_per_1m: "2" },
        ]),
      ),
    ).toEqual(["重复条目：模型 m1（gpt-a）在本批中出现多次"]);
  });

  it("错误带行号与模型定位信息", () => {
    const result = parsePriceDocumentJson(
      documentWith([
        { id: "m1", cost_input_per_1m: "1" },
        { id: "m2", markup: "abc" },
      ]),
      models,
    );
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ index: 1, id: "m2", name: null });
  });

  it("id/name/model_type 必须是字符串或 null", () => {
    expect(issuesOf(documentWith([{ id: 1, name: "gpt-a" }]))).toEqual([
      "id 必须是字符串或 null",
    ]);
    expect(issuesOf(documentWith([{ name: false }]))).toEqual(["name 必须是字符串或 null"]);
    expect(issuesOf(documentWith([{ id: "m1", model_type: 3 }]))).toEqual([
      "model_type 必须是字符串或 null",
    ]);
  });

  it("行必须是对象", () => {
    expect(issuesOf(documentWith(["m1"]))).toEqual(["行必须是对象"]);
  });

  it("成本必须是有限非负数字，空白表示不改", () => {
    expect(issuesOf(documentWith([{ id: "m1", cost_input_per_1m: "abc" }]))).toEqual([
      "cost_input_per_1m 必须是数字",
    ]);
    expect(issuesOf(documentWith([{ id: "m1", cost_input_per_1m: true }]))).toEqual([
      "cost_input_per_1m 必须是数字",
    ]);
    expect(issuesOf(documentWith([{ id: "m1", cost_input_per_1m: -1 }]))).toEqual([
      "cost_input_per_1m 不能为负数",
    ]);
    expect(issuesOf(documentWith([{ id: "m1", cost_input_per_1m: "" }]))).toEqual([]);
    expect(issuesOf(documentWith([{ id: "m1", cost_input_per_1m: null }]))).toEqual([]);
  });

  it("倍率必须 > 0 且 <= 100", () => {
    expect(issuesOf(documentWith([{ id: "m1", markup: 0 }]))).toEqual([
      "markup 必须大于 0（花费 = 成本 × 倍率）",
    ]);
    expect(issuesOf(documentWith([{ id: "m1", markup: "100.01" }]))).toEqual([
      "markup 不能超过 100",
    ]);
    expect(issuesOf(documentWith([{ id: "m1", markup: "1.5" }]))).toEqual([]);
  });

  it("行内多处错误合并为一条 message，且任何错误都不产出文档", () => {
    const result = parsePriceDocumentJson(
      documentWith([{ id: "m1", cost_input_per_1m: "-1", markup: 0 }]),
      models,
    );
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toBe(
      "cost_input_per_1m 不能为负数；markup 必须大于 0（花费 = 成本 × 倍率）",
    );
    expect(result.document).toBeNull();
  });
});

describe("价目 JSON 文档：格式化与草稿往返（切换保留未保存 draft）", () => {
  const priceModels = [
    {
      id: "m1",
      name: "gpt-a",
      model_type: "chat",
      cost_input_per_1m: "1.500000",
      cost_output_per_1m: null,
      markup: "1.2000",
    },
    {
      id: "m2",
      name: "claude-b",
      model_type: "chat",
      cost_input_per_1m: null,
      cost_output_per_1m: "3.000000",
      markup: "1.0000",
    },
  ];

  it("formatPriceDocument 输出导出文件形状，未保存草稿覆盖持久值", () => {
    const text = formatPriceDocument(priceModels, {
      m1: { input: "2.25", output: "", markup: "1.5" },
    });
    const parsed = parsePriceDocumentJson(text, priceModels);
    expect(parsed.issues).toEqual([]);
    expect(parsed.document?.schema_version).toBe(1);
    expect(parsed.document?.meta).toEqual({ cache_prices: "not_included_v1" });
    expect(typeof parsed.document?.exported_at_ms).toBe("number");
    const [first, second] = parsed.document?.upstream_models ?? [];
    expect(first).toMatchObject({
      id: "m1",
      name: "gpt-a",
      model_type: "chat",
      cost_input_per_1m: "2.25",
      cost_output_per_1m: null,
      markup: "1.5",
    });
    expect(second).toMatchObject({
      cost_input_per_1m: null,
      cost_output_per_1m: "3.000000",
      markup: "1.0000",
    });
  });

  it("表格草稿 → JSON → 表格 往返保留未保存值", () => {
    const drafts = { m2: { input: "4.5", output: "5.5", markup: "2" } };
    const document = parsePriceDocumentJson(
      formatPriceDocument(priceModels, drafts),
      priceModels,
    ).document;
    expect(document).not.toBeNull();
    const roundTrip = draftsFromPriceDocument(document!, priceModels);
    expect(roundTrip.m2).toEqual({ input: "4.5", output: "5.5", markup: "2" });
  });

  it("JSON 中 null/空白字段不改动价格：回填持久值或保留已有草稿", () => {
    const partial = parsePriceDocumentJson(
      JSON.stringify({
        schema_version: 1,
        upstream_models: [{ id: "m1", cost_input_per_1m: "9" }],
      }),
      priceModels,
    ).document;
    expect(draftsFromPriceDocument(partial!, priceModels)).toEqual({
      m1: { input: "9", output: "", markup: "1.2000" },
    });

    const locatorOnly = parsePriceDocumentJson(
      JSON.stringify({ schema_version: 1, upstream_models: [{ id: "m1" }] }),
      priceModels,
    ).document;
    const current = { m1: { input: "", output: "7", markup: "1.0000" } };
    expect(draftsFromPriceDocument(locatorOnly!, priceModels, current)).toEqual(current);
  });

  it("formatPriceDocument 保留非法草稿原文，让 JSON 视图能暴露问题", () => {
    const text = formatPriceDocument(priceModels, {
      m1: { input: "abc", output: "", markup: "1.2000" },
    });
    expect(parsePriceDocumentJson(text, priceModels).issues[0]?.message).toBe(
      "cost_input_per_1m 必须是数字",
    );
  });
});

describe("价目导入失败：后端逐行错误归一", () => {
  it("422 details.errors 映射为行号 + id/name + 原因", () => {
    const error = new ApiError(
      422,
      "validation_error",
      "价目导入校验失败，全部未生效（2 行有误）",
      "req-1",
      {
        errors: [
          { index: 0, id: "m1", name: "gpt-a", message: "markup 必须大于 0（花费 = 成本 × 倍率）" },
          { index: 1, id: null, name: null, message: "未知上游模型: x" },
        ],
      },
    );
    expect(normalizePriceImportErrors(error)).toEqual([
      { index: 0, id: "m1", name: "gpt-a", message: "markup 必须大于 0（花费 = 成本 × 倍率）" },
      { index: 1, id: null, name: null, message: "未知上游模型: x" },
    ]);
  });

  it("details.errors 缺失或形状不符时返回空数组，缺省字段有兜底", () => {
    expect(normalizePriceImportErrors(new ApiError(422, "x", "y"))).toEqual([]);
    expect(
      normalizePriceImportErrors(
        new ApiError(422, "x", "y", "", { errors: [{ id: "m1" }] }),
      ),
    ).toEqual([{ index: 0, id: "m1", name: null, message: "未知错误" }]);
  });
});
