import { describe, expect, it } from "vitest";

import type { TransformRule, UpstreamTransforms } from "@/types";

import {
  CONDITION_MODES,
  TRANSFORM_OPS,
  TRANSFORM_SECTIONS,
  documentIssues,
  emptyTransformRule,
  formatTransformsJson,
  isBlankRule,
  isProtectedHeader,
  parseTransformsJson,
  ruleValidation,
  withoutBlankRules,
} from "./document";

const headerRule = (patch: Partial<TransformRule> = {}): TransformRule => ({
  op: "update",
  name: "x-trace",
  value: "1",
  conditions: [],
  ...patch,
});

const bodyRule = (patch: Partial<TransformRule> = {}): TransformRule => ({
  op: "update",
  path: "temperature",
  value: "0.2",
  conditions: [],
  ...patch,
});

describe("变换动作词表：中文展示、wire 值不变", () => {
  it("九个动作的 wire 值保持英文枚举，label 全部是中文", () => {
    expect(TRANSFORM_OPS.map((op) => op.value)).toEqual([
      "create",
      "update",
      "delete",
      "copy",
      "prepend",
      "append",
      "regex_replace",
      "to_upper",
      "to_lower",
    ]);
    for (const op of TRANSFORM_OPS) {
      expect(op.label, op.value).toMatch(/[\u4e00-\u9fa5]/);
      expect(op.label, op.value).not.toBe(op.value);
    }
  });

  it("条件模式也提供中文 label，wire 值保持枚举", () => {
    expect(CONDITION_MODES.map((mode) => mode.value)).toEqual(["full", "regex", "gt", "gte", "lt", "lte"]);
    for (const mode of CONDITION_MODES) expect(mode.label).toMatch(/[\u4e00-\u9fa5]/);
  });

  it("四段配置带中文标题与头/体类型", () => {
    expect(TRANSFORM_SECTIONS.map((section) => section.section)).toEqual([
      "request_headers",
      "request_body",
      "response_headers",
      "response_body",
    ]);
    expect(TRANSFORM_SECTIONS.map((section) => section.kind)).toEqual(["header", "body", "header", "body"]);
    for (const section of TRANSFORM_SECTIONS) expect(section.title).toMatch(/[\u4e00-\u9fa5]/);
  });
});

describe("空白规则行＝占位行", () => {
  it("新建的空行是占位，填写任一字段后不再是占位", () => {
    expect(isBlankRule(emptyTransformRule("header"))).toBe(true);
    expect(isBlankRule(emptyTransformRule("body"))).toBe(true);
    expect(isBlankRule({ op: "update", conditions: [] })).toBe(true);
    expect(isBlankRule({} as TransformRule)).toBe(true);
    expect(isBlankRule(headerRule())).toBe(false);
    expect(isBlankRule(bodyRule())).toBe(false);
    expect(isBlankRule(headerRule({ value: "" }))).toBe(false);
    expect(isBlankRule({ op: "delete", conditions: [] } as TransformRule)).toBe(false);
    expect(
      isBlankRule({
        op: "update",
        conditions: [{ field: "model", mode: "full", value: "glm-5.3" }],
      }),
    ).toBe(false);
  });

  it("预览/保存前按段过滤空白行，且不改动原文档", () => {
    const document: UpstreamTransforms = {
      request_headers: [emptyTransformRule("header"), headerRule(), emptyTransformRule("header")],
      request_body: [bodyRule(), emptyTransformRule("body")],
      response_headers: [],
      response_body: [emptyTransformRule("body")],
    };
    const filtered = withoutBlankRules(document);
    expect(filtered.request_headers).toHaveLength(1);
    expect(filtered.request_body).toHaveLength(1);
    expect(filtered.response_headers).toHaveLength(0);
    expect(filtered.response_body).toHaveLength(0);
    expect(document.request_headers).toHaveLength(3);
  });
});

describe("逐条校验：目标、动作字段与 conditions", () => {
  it("合法规则没有错误信息", () => {
    const result = ruleValidation(headerRule(), "request_headers");
    expect(result.message).toBe("");
    expect(result.conditionMessages).toEqual([]);
  });

  it("保护头立即拦截", () => {
    expect(isProtectedHeader("X-Api-Key")).toBe(true);
    expect(ruleValidation(headerRule({ name: "x-api-key" }), "request_headers").message).toContain("保护头");
  });

  it("copy 使用后端 canonical wire 字段：头 source_name、体 source_path/target_path", () => {
    const headerCopy = ruleValidation(
      { op: "copy", name: "x-new", source_name: "x-old", conditions: [] },
      "request_headers",
    );
    expect(headerCopy.message).toBe("");
    // 旧代码写 source_path，后端不认识（会 422），前端必须同样拦截。
    expect(ruleValidation({ op: "copy", name: "x-new", source_path: "x-old", conditions: [] }, "request_headers").message).toContain("源头名");

    const bodyCopy = ruleValidation(
      { op: "copy", source_path: "temperature", target_path: "top_p", conditions: [] },
      "request_body",
    );
    expect(bodyCopy.message).toBe("");
    // 只给 path 时后端编译目标是空的，规则不生效，前端必须报错。
    expect(ruleValidation({ op: "copy", path: "top_p", source_path: "temperature", conditions: [] }, "request_body").message).toContain("目标");
  });

  it("必填字段逐类报错：目标 / 源 / 正则 / 值", () => {
    expect(ruleValidation(headerRule({ name: "" }), "request_headers").message).toContain("头名称");
    expect(ruleValidation(bodyRule({ path: "" }), "request_body").message).toContain("目标路径");
    expect(ruleValidation(bodyRule({ op: "regex_replace", regex: "" }), "request_body").message).toContain("正则");
    expect(ruleValidation(headerRule({ op: "create", value: "" }), "request_headers").message).toContain("值");
    // delete / to_upper / to_lower 不需要值。
    expect(ruleValidation(headerRule({ op: "delete", value: "" }), "request_headers").message).toBe("");
    expect(ruleValidation(bodyRule({ op: "to_upper", value: "" }), "request_body").message).toBe("");
  });

  it("空 conditions 逐条报错，且不影响其他条件的判断", () => {
    const missingField = ruleValidation(
      headerRule({ conditions: [{ field: "", mode: "full", value: "x" }] }),
      "request_headers",
    );
    expect(missingField.message).toBe("");
    expect(missingField.conditionMessages).toEqual(["第 1 条条件：缺字段"]);

    const mixed = ruleValidation(
      bodyRule({
        conditions: [
          { field: "model", mode: "full", value: "glm-5.3" },
          { field: "", mode: "full", value: "" },
          { field: "stream", mode: "full", value: "false" },
        ],
      }),
      "request_body",
    );
    expect(mixed.conditionMessages).toEqual([null, "第 2 条条件：缺字段", null]);
  });

  it("整份文档校验忽略空白行，只报告非空白行的问题（保留原始行号）", () => {
    const document: UpstreamTransforms = {
      request_headers: [emptyTransformRule("header"), headerRule({ name: "" }), headerRule()],
      request_body: [],
      response_headers: [],
      response_body: [],
    };
    const issues = documentIssues(document);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ section: "request_headers", index: 1 });
    expect(issues[0]?.message).toContain("头名称");
  });
});

describe("JSON 文档：schema / 必填 / 条件 / 空字段校验", () => {
  const validJson = JSON.stringify({
    request_headers: [{ op: "update", name: "x-trace", value: "slipstream", conditions: [] }],
    request_body: [
      {
        op: "update",
        path: "temperature",
        value: "0.2",
        conditions: [{ field: "model", mode: "full", value: "glm-5.3" }],
      },
      { op: "copy", source_path: "temperature", target_path: "top_p", conditions: [] },
    ],
    response_headers: [],
    response_body: [],
  });

  it("合法 JSON 解析成与可视化共用的同一 document", () => {
    const result = parseTransformsJson(validJson);
    expect(result.issues).toEqual([]);
    expect(result.document).not.toBeNull();
    expect(result.document?.request_headers[0]).toMatchObject({ op: "update", name: "x-trace" });
    expect(result.document?.request_body[1]).toMatchObject({
      op: "copy",
      source_path: "temperature",
      target_path: "top_p",
    });
    expect(result.document?.request_body[0]?.conditions[0]).toEqual({
      field: "model",
      mode: "full",
      value: "glm-5.3",
    });
  });

  it("非法 JSON 文本不产生 document，只报解析错误", () => {
    const result = parseTransformsJson('{"request_headers": [}');
    expect(result.document).toBeNull();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain("JSON");
  });

  it("schema：顶层必须是对象、段必须是数组、规则必须是对象", () => {
    expect(parseTransformsJson("[]").document).toBeNull();
    expect(parseTransformsJson('{"request_headers": {}}').issues[0]?.message).toContain("数组");
    expect(parseTransformsJson('{"request_headers": [1]}').issues[0]?.message).toContain("对象");
    expect(parseTransformsJson('{"headers": []}').issues[0]?.message).toContain("未知字段");
  });

  it("schema：拒绝未知字段与非 canonical copy 字段", () => {
    const unknown = parseTransformsJson(
      JSON.stringify({ request_headers: [{ op: "update", name: "x", path: "a", conditions: [] }] }),
    );
    expect(unknown.document).toBeNull();
    expect(unknown.issues[0]?.message).toContain("未知字段");

    const legacyCopy = parseTransformsJson(
      JSON.stringify({ request_headers: [{ op: "copy", name: "x", source_path: "y" }] }),
    );
    expect(legacyCopy.document).toBeNull();
    expect(legacyCopy.issues[0]?.message).toContain("未知字段");
  });

  it("必填：op 缺失/非法、value 类型错误都拒绝", () => {
    expect(parseTransformsJson(JSON.stringify({ request_headers: [{ name: "x", value: "1" }] })).issues[0]?.message).toContain("op");
    expect(
      parseTransformsJson(JSON.stringify({ request_headers: [{ op: "explode", name: "x" }] })).issues[0]?.message,
    ).toContain("动作");
    expect(
      parseTransformsJson(JSON.stringify({ request_headers: [{ op: "update", name: "x", value: 1 }] })).issues[0]?.message,
    ).toContain("字符串");
  });

  it("空字段与非空白占位行：空规则静默丢弃，其余规则进入 document", () => {
    const result = parseTransformsJson(
      JSON.stringify({
        request_headers: [{}, { op: "update", name: "", value: "" }, { op: "update", name: "x-ok", value: "1" }],
      }),
    );
    expect(result.issues).toEqual([]);
    expect(result.document?.request_headers).toHaveLength(1);
    expect(result.document?.request_headers[0]?.name).toBe("x-ok");
  });

  it("conditions：必须是数组、字段必填、模式/值必填", () => {
    const notArray = parseTransformsJson(
      JSON.stringify({ request_headers: [{ op: "update", name: "x", value: "1", conditions: "no" }] }),
    );
    expect(notArray.issues[0]?.message).toContain("conditions");

    const badMode = parseTransformsJson(
      JSON.stringify({
        request_headers: [
          { op: "update", name: "x", value: "1", conditions: [{ field: "model", mode: "eq", value: "a" }] },
        ],
      }),
    );
    expect(badMode.issues[0]?.message).toContain("模式");

    const emptyField = parseTransformsJson(
      JSON.stringify({
        request_headers: [
          { op: "update", name: "x", value: "1", conditions: [{ field: "", mode: "full", value: "a" }] },
        ],
      }),
    );
    expect(emptyField.issues[0]?.message).toContain("field");

    const emptyValue = parseTransformsJson(
      JSON.stringify({
        request_headers: [
          { op: "update", name: "x", value: "1", conditions: [{ field: "model", mode: "full", value: "" }] },
        ],
      }),
    );
    expect(emptyValue.issues[0]?.message).toContain("value");
  });

  it("保护头在 JSON 保存前就被拦截", () => {
    const result = parseTransformsJson(
      JSON.stringify({ request_headers: [{ op: "update", name: "Authorization", value: "x", conditions: [] }] }),
    );
    expect(result.document).toBeNull();
    expect(result.issues[0]?.message).toContain("保护头");
  });
});

describe("可视化 ↔ JSON 共用同一 document", () => {
  it("format 后再 parse 得到同一份文档（空白行被丢掉）", () => {
    const document: UpstreamTransforms = {
      request_headers: [
        emptyTransformRule("header"),
        headerRule(),
        { op: "delete", name: "x-old", conditions: [] },
      ],
      request_body: [
        bodyRule({
          conditions: [{ field: "model", mode: "full", value: "glm-5.3" }],
        }),
        { op: "copy", source_path: "temperature", target_path: "top_p", conditions: [] },
        emptyTransformRule("body"),
      ],
      response_headers: [headerRule({ op: "regex_replace", name: "x-out", regex: "a+", replacement: "b" })],
      response_body: [],
    };
    const text = formatTransformsJson(document);
    const parsed = parseTransformsJson(text);
    expect(parsed.issues).toEqual([]);
    expect(parsed.document).toEqual(withoutBlankRules(document));
    expect(formatTransformsJson(parsed.document as UpstreamTransforms)).toBe(text);
  });

  it("format 使用 wire 字段（不做中文化）与稳定 key 顺序", () => {
    const text = formatTransformsJson({
      request_headers: [headerRule()],
      request_body: [],
      response_headers: [],
      response_body: [],
    });
    expect(text).toContain('"op": "update"');
    expect(text.indexOf('"name"')).toBeLessThan(text.indexOf('"value"'));
    expect(text).not.toContain("更新");
  });
});
