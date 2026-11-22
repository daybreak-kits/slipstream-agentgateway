/**
 * 变换规则文档（wire schema v2 的单一事实源）：中文展示词表、空白占位行、逐条校验与
 * JSON 文档解析/序列化。可视化与 JSON 两个视图都读写同一份 UpstreamTransforms 文档，
 * 这里不引入第二套规则模型——只把 docs/contracts/transforms-compiler.md §5 的 wire
 * 形状原样描述出来（动作值保持英文枚举，仅展示用中文 label）。
 *
 * canonical wire 字段（与后端 transforms_codec.py 对齐）：
 * - 头规则：op / name / value / source_name / target_name / regex / replacement / conditions
 * - 体规则：op / path / value / source_path / target_path / regex / replacement / conditions
 * 注意后端 copy 的源/目标字段在头与体上不同名；旧前端把头 copy 写成 source_path、
 * 体 copy 只写 path，后端要么 422 要么编译成空目标，这里统一收敛到 canonical 形状。
 */

import type {
  ConditionMode,
  RewriteCondition,
  TransformOp,
  TransformRule,
  TransformSection,
  UpstreamTransforms,
} from "@/types";

export interface TransformOpMeta {
  value: TransformOp;
  /** 仅展示；wire 值仍是 value 的英文枚举 */
  label: string;
  hint: string;
}

/** 契约 v2：头与体共用同一套动作词表（ADR-009），顺序即下拉顺序。 */
export const TRANSFORM_OPS: readonly TransformOpMeta[] = [
  { value: "create", label: "新增", hint: "不存在才写，已存在保持不变" },
  { value: "update", label: "覆盖", hint: "写入目标值（头按编译后的 set 语义生效）" },
  { value: "delete", label: "删除", hint: "删除；不存在视为成功" },
  { value: "copy", label: "复制", hint: "从源复制到目标（头填源头名 / 体填源路径）" },
  { value: "prepend", label: "前缀", hint: "字符串开头插入" },
  { value: "append", label: "后缀", hint: "字符串结尾追加" },
  { value: "regex_replace", label: "正则替换", hint: "按正则替换；填写正则与替换文本（CEL regexReplaceAll）" },
  { value: "to_upper", label: "转大写", hint: "转大写" },
  { value: "to_lower", label: "转小写", hint: "转小写" },
];

const OP_VALUES = TRANSFORM_OPS.map((op) => op.value);

export function isTransformOp(value: unknown): value is TransformOp {
  return typeof value === "string" && (OP_VALUES as readonly string[]).includes(value);
}

export function transformOpLabel(op: TransformOp): string {
  return TRANSFORM_OPS.find((item) => item.value === op)?.label ?? op;
}

export interface ConditionModeMeta {
  value: ConditionMode;
  label: string;
}

export const CONDITION_MODES: readonly ConditionModeMeta[] = [
  { value: "full", label: "等于" },
  { value: "regex", label: "正则匹配" },
  { value: "gt", label: "大于" },
  { value: "gte", label: "大于等于" },
  { value: "lt", label: "小于" },
  { value: "lte", label: "小于等于" },
];

const CONDITION_MODE_VALUES = CONDITION_MODES.map((mode) => mode.value);

export function isConditionMode(value: unknown): value is ConditionMode {
  return typeof value === "string" && (CONDITION_MODE_VALUES as readonly string[]).includes(value);
}

export interface TransformSectionMeta {
  section: TransformSection;
  title: string;
  kind: "header" | "body";
  fixedNotice?: string;
}

export const TRANSFORM_SECTIONS: readonly TransformSectionMeta[] = [
  { section: "request_headers", title: "请求头改写", kind: "header" },
  { section: "request_body", title: "请求体改写", kind: "body" },
  { section: "response_headers", title: "响应头改写", kind: "header" },
  {
    section: "response_body",
    title: "响应体改写",
    kind: "body",
    fixedNotice: "仅非流式生效：流式请求跳过改写并记录 rewrite_skipped=stream",
  },
];

/** 契约不变量 1：保护头 UI 侧直接拦截，不等后端报错。 */
const PROTECTED_HEADERS = new Set([
  "authorization", "api-key", "x-api-key", "cookie", "set-cookie",
  "content-type", "content-length", "host", "x-request-id",
]);

export function isProtectedHeader(name: string): boolean {
  return PROTECTED_HEADERS.has(name.trim().toLowerCase());
}

export function sectionKind(section: TransformSection): "header" | "body" {
  return section.endsWith("_headers") ? "header" : "body";
}

/** 新建规则行＝空白占位行：不算无效，也不参与预览/保存。 */
export function emptyTransformRule(kind: "header" | "body"): TransformRule {
  return kind === "header"
    ? { op: "update", name: "", conditions: [] }
    : { op: "update", path: "", conditions: [] };
}

const RULE_TEXT_FIELDS = [
  "name", "path", "value", "source_path", "source_name", "target_path", "target_name", "regex", "replacement",
] as const satisfies readonly (keyof TransformRule)[];

/** 空白占位行：没有规则内容（op 缺省或仍是默认 update）且没有条件。 */
export function isBlankRule(rule: Partial<TransformRule> | null | undefined): boolean {
  if (!rule) return true;
  if ((rule.conditions ?? []).length > 0) return false;
  if (rule.op && rule.op !== "update") return false;
  return RULE_TEXT_FIELDS.every((field) => String(rule[field] ?? "").trim() === "");
}

/** 预览/保存前按段过滤空白占位行；不改动传入的文档。 */
export function withoutBlankRules(document: UpstreamTransforms): UpstreamTransforms {
  const next = {} as UpstreamTransforms;
  for (const meta of TRANSFORM_SECTIONS) {
    next[meta.section] = (document[meta.section] ?? []).filter((rule) => !isBlankRule(rule));
  }
  return next;
}

export interface RuleValidation {
  /** 非条件问题；空串表示这一行没有错误。 */
  message: string;
  /** 与 rule.conditions 一一对应；null 表示该条件合法。 */
  conditionMessages: Array<string | null>;
}

function conditionMessage(condition: Partial<RewriteCondition> | null | undefined, index: number): string | null {
  const prefix = "第 " + String(index + 1) + " 条条件：";
  if (!condition || typeof condition !== "object") return prefix + "缺字段";
  if (!String(condition.field ?? "").trim()) return prefix + "缺字段";
  if (!isConditionMode(condition.mode)) return prefix + "模式无效";
  if (!String(condition.value ?? "").trim()) return prefix + "缺值";
  return null;
}

/** 体 copy 的目标是 target_path（path 不参与编译）；其余体动作的目标是 path。 */
function ruleTarget(rule: TransformRule, kind: "header" | "body"): string {
  if (kind === "header") return rule.name ?? "";
  return rule.op === "copy" ? (rule.target_path ?? "") : (rule.path ?? "");
}

function ruleSource(rule: TransformRule, kind: "header" | "body"): string {
  return kind === "header" ? (rule.source_name ?? "") : (rule.source_path ?? "");
}

/** 逐条校验一行规则（含每个 condition），预览/保存/JSON 三个入口共用。 */
export function ruleValidation(rule: TransformRule, section: TransformSection): RuleValidation {
  const kind = sectionKind(section);
  const conditionMessages = (rule.conditions ?? []).map((condition, index) => conditionMessage(condition, index));
  if (isBlankRule(rule)) return { message: "", conditionMessages };
  if (kind === "header" && isProtectedHeader(rule.name ?? "")) {
    return { message: "保护头禁止改写", conditionMessages };
  }
  if (!ruleTarget(rule, kind).trim()) {
    return { message: kind === "header" ? "缺头名称" : "缺目标路径", conditionMessages };
  }
  if (rule.op === "copy") {
    return ruleSource(rule, kind).trim()
      ? { message: "", conditionMessages }
      : { message: kind === "header" ? "缺源头名" : "缺源路径", conditionMessages };
  }
  if (rule.op === "regex_replace") {
    // replacement 允许为空（删除匹配）；regex 必填。
    return (rule.regex ?? "").trim()
      ? { message: "", conditionMessages }
      : { message: "缺正则", conditionMessages };
  }
  if (rule.op === "delete" || rule.op === "to_upper" || rule.op === "to_lower") {
    return { message: "", conditionMessages };
  }
  return (rule.value ?? "").length > 0 ? { message: "", conditionMessages } : { message: "缺值", conditionMessages };
}

export interface TransformIssue {
  /** 文档级问题没有段；规则级问题带段与原始行号（0-based，含空白行）。 */
  section?: TransformSection;
  index?: number;
  message: string;
}

/** 整份文档校验：忽略空白占位行，返回所有非空白行的问题。 */
export function documentIssues(document: UpstreamTransforms): TransformIssue[] {
  const issues: TransformIssue[] = [];
  for (const meta of TRANSFORM_SECTIONS) {
    (document[meta.section] ?? []).forEach((rule, index) => {
      if (isBlankRule(rule)) return;
      const validation = ruleValidation(rule, meta.section);
      if (validation.message) issues.push({ section: meta.section, index, message: validation.message });
      validation.conditionMessages.forEach((message) => {
        if (message) issues.push({ section: meta.section, index, message });
      });
    });
  }
  return issues;
}

const SEGMENT_KEYS = TRANSFORM_SECTIONS.map((meta) => meta.section);

const HEADER_RULE_KEYS = new Set([
  "op", "name", "value", "source_name", "target_name", "regex", "replacement", "conditions",
]);
const BODY_RULE_KEYS = new Set([
  "op", "path", "value", "source_path", "target_path", "regex", "replacement", "conditions",
]);
const CONDITION_KEYS = new Set(["field", "mode", "value"]);

const HEADER_TEXT_FIELDS = ["name", "value", "source_name", "target_name", "regex", "replacement"] as const;
const BODY_TEXT_FIELDS = ["path", "value", "source_path", "target_path", "regex", "replacement"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ParseTransformsResult {
  /** 有任何问题时为 null：视图继续保留上一份合法文档，不把半截数据写进共用状态。 */
  document: UpstreamTransforms | null;
  issues: TransformIssue[];
}

interface JsonIssueSink {
  issues: TransformIssue[];
  push: (message: string, section?: TransformSection, index?: number) => void;
}

function parseConditions(
  raw: unknown,
  sink: JsonIssueSink,
  section: TransformSection,
  index: number,
): RewriteCondition[] {
  if (raw === undefined) return [];
  const prefix = TRANSFORM_SECTIONS.find((meta) => meta.section === section)?.title ?? section;
  const at = prefix + "第 " + String(index + 1) + " 条：";
  if (!Array.isArray(raw)) {
    sink.push(at + "conditions 必须是数组", section, index);
    return [];
  }
  const conditions: RewriteCondition[] = [];
  raw.forEach((item, conditionIndex) => {
    const conditionAt = at + "条件 " + String(conditionIndex + 1) + " ";
    if (!isPlainObject(item)) {
      sink.push(conditionAt + "必须是对象", section, index);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!CONDITION_KEYS.has(key)) sink.push(conditionAt + "未知字段 " + key, section, index);
    }
    if (typeof item.field !== "string" || item.field.trim() === "") {
      sink.push(conditionAt + "字段 field 必填", section, index);
      return;
    }
    if (!isConditionMode(item.mode)) {
      sink.push(conditionAt + "模式 mode 无效", section, index);
      return;
    }
    if (typeof item.value !== "string" || item.value.trim() === "") {
      sink.push(conditionAt + "值 value 必填", section, index);
      return;
    }
    conditions.push({ field: item.field, mode: item.mode, value: item.value });
  });
  return conditions;
}

function parseRule(
  raw: unknown,
  section: TransformSection,
  index: number,
  sink: JsonIssueSink,
): TransformRule | null {
  const meta = TRANSFORM_SECTIONS.find((item) => item.section === section);
  const kind = meta?.kind ?? "header";
  const prefix = (meta?.title ?? section) + "第 " + String(index + 1) + " 条：";
  if (!isPlainObject(raw)) {
    sink.push(prefix + "规则必须是对象", section, index);
    return null;
  }
  const allowed = kind === "header" ? HEADER_RULE_KEYS : BODY_RULE_KEYS;
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      sink.push(prefix + "未知字段 " + key, section, index);
    }
  }
  // 与可视化视图一致：JSON 里粘贴的空白占位行（{} 或默认 update 空行）静默丢弃。
  if (isBlankRule(raw as Partial<TransformRule>)) return null;
  const textFields = kind === "header" ? HEADER_TEXT_FIELDS : BODY_TEXT_FIELDS;
  for (const field of textFields) {
    const value = raw[field];
    if (value !== undefined && typeof value !== "string") {
      sink.push(prefix + field + " 必须是字符串", section, index);
    }
  }
  const conditions = parseConditions(raw.conditions, sink, section, index);
  if (!isTransformOp(raw.op)) {
    sink.push(prefix + (raw.op === undefined ? "动作 op 必填" : "动作 op 无效"), section, index);
    return null;
  }
  const rule: TransformRule = { op: raw.op, conditions };
  for (const field of textFields) {
    const value = raw[field];
    if (typeof value === "string" && value !== "") {
      rule[field] = value;
    }
  }
  if (isBlankRule(rule)) return null;
  const validation = ruleValidation(rule, section);
  if (validation.message) {
    sink.push(prefix + validation.message, section, index);
    return null;
  }
  validation.conditionMessages.forEach((message) => {
    if (message) sink.push(prefix + message, section, index);
  });
  return rule;
}

/**
 * 解析 JSON 视图文本：schema（顶层/段/规则/条件键）、必填（op、目标、条件字段与值）、
 * 类型（字符串字段）与保护头都在这里校验；空白占位行静默丢弃，与可视化视图一致。
 */
export function parseTransformsJson(text: string): ParseTransformsResult {
  const issues: TransformIssue[] = [];
  const sink: JsonIssueSink = { issues, push: (message, section, index) => issues.push({ section, index, message }) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return { document: null, issues: [{ message: "JSON 解析失败：" + (error instanceof Error ? error.message : String(error)) }] };
  }
  if (!isPlainObject(parsed)) {
    return { document: null, issues: [{ message: "JSON 顶层必须是对象" }] };
  }
  for (const key of Object.keys(parsed)) {
    if (!(SEGMENT_KEYS as readonly string[]).includes(key)) {
      sink.push("未知字段：" + key);
    }
  }
  const document = {} as UpstreamTransforms;
  for (const meta of TRANSFORM_SECTIONS) {
    const segment = parsed[meta.section];
    if (segment === undefined) {
      document[meta.section] = [];
      continue;
    }
    if (!Array.isArray(segment)) {
      sink.push(meta.title + "必须是数组", meta.section);
      document[meta.section] = [];
      continue;
    }
    const rules: TransformRule[] = [];
    segment.forEach((raw, index) => {
      const rule = parseRule(raw, meta.section, index, sink);
      if (rule) rules.push(rule);
    });
    document[meta.section] = rules;
  }
  return issues.length > 0 ? { document: null, issues } : { document, issues };
}

function canonicalRule(rule: TransformRule, kind: "header" | "body"): Record<string, unknown> {
  const out: Record<string, unknown> = { op: rule.op };
  if (kind === "header") out.name = rule.name ?? "";
  const conditions = (rule.conditions ?? []).map((condition) => ({
    field: condition.field,
    mode: condition.mode,
    value: condition.value,
  }));
  out.conditions = conditions;
  if (kind === "header") {
    if (rule.value) out.value = rule.value;
    if (rule.source_name) out.source_name = rule.source_name;
    if (rule.target_name) out.target_name = rule.target_name;
  } else {
    if (rule.path) out.path = rule.path;
    if (rule.value) out.value = rule.value;
    if (rule.source_path) out.source_path = rule.source_path;
    if (rule.target_path) out.target_path = rule.target_path;
  }
  if (rule.regex) out.regex = rule.regex;
  if (rule.replacement) out.replacement = rule.replacement;
  return out;
}

/** 文档 → JSON 视图文本：丢掉空白占位行，按 wire 形状与稳定 key 顺序输出。 */
export function formatTransformsJson(document: UpstreamTransforms): string {
  const normalized = withoutBlankRules(document);
  const payload: Record<string, unknown> = {};
  for (const meta of TRANSFORM_SECTIONS) {
    payload[meta.section] = normalized[meta.section].map((rule) => canonicalRule(rule, meta.kind));
  }
  return JSON.stringify(payload, null, 2);
}
