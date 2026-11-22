/**
 * Playground 对话参数的唯一一张表（W5 票05）。
 *
 * 每行同时描述：面板输入字段 → 控制面 PlaygroundRequest 字段的映射、留空语义
 * （undefined = 不发送）、前端内联校验与摘要展示。新增一个可转发参数只改这张表；
 * 后端 relay 由 api/src/l06_api/playground.py 的同一张表驱动。参数说明文案
 * （PARAM_HINTS）是纯 UI 文案，见文件后半。
 */

import type {
  ChatRequestParams,
  ReasoningEffort,
  ReasoningLevel,
  ResponseFormatType,
} from "./types";

/** 参数面板的状态：数字一律以字符串保存，空串表示「不发送、用上游默认」。 */
export interface ChatParamInput {
  temperature?: string;
  topP?: string;
  topK?: string;
  frequencyPenalty?: string;
  presencePenalty?: string;
  seed?: string;
  maxTokens?: string;
  maxCompletionTokens?: string;
  /** stop 多值：单行逗号分隔；旧换行输入在解析时折算成同一语义（票19）。 */
  stop?: string;
  n?: string;
  responseFormat?: ResponseFormatType;
  logprobs?: boolean;
  topLogprobs?: string;
  user?: string;
  /** 思考控件：default 不发送 reasoning_effort，其余档位按值转发（票18）。 */
  thinkingMode?: ReasoningLevel;
  /** 额外请求字段（JSON 对象）；厂商私有字段的兜底透传。 */
  extraFields?: string;
}

/** 参数面板 label 下方那行小字的文案：取值范围 + 一句话用途。 */
export interface ParamHint {
  /** OpenAI 兼容口径的取值区间；注明「上游未校验」表示越界由上游自行决定。 */
  range: string;
  /** 一句话用途，写给第一次用这个参数的人。 */
  usage: string;
}

export interface ChatParamValidation {
  valid: boolean;
  message?: string;
}

export interface ChatParamValidationOptions {
  /** 所选上游模型登记的 parameters.max_output_tokens；0/缺省表示未登记。 */
  maxOutputTokens?: number | null;
}

/** 模型没登记 max_output_tokens 时沿用旧页的输出上限。 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32768;

/** 输出上限：优先用上游模型登记的 parameters.max_output_tokens，0=未登记则回退。 */
export function maxOutputTokensFor(registered: number | null | undefined): number {
  return registered && registered > 0 ? registered : DEFAULT_MAX_OUTPUT_TOKENS;
}

// ---------------------------------------------------------------- 思考档位

/** 档位全集：default 表示不发送 reasoning_effort，其余档位控制面按值转发。 */
export type ReasoningEffortLevel = ReasoningEffort;

/** 档位既定顺序；与后端 model_params.REASONING_LEVELS 同源。 */
export const REASONING_LEVELS: ReasoningLevel[] = [
  "default",
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** 思考控件的标签；面板、对话框与摘要共用一处。 */
export const REASONING_LEVEL_LABELS: Record<ReasoningLevel, string> = {
  default: "默认（不发送）",
  none: "none",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/** 模型声明的档位集合 → 选择器可选项：未声明回退全部，未知值过滤，空则回退。 */
export function reasoningLevelOptions(declared?: string[] | null): ReasoningLevel[] {
  if (!declared || declared.length === 0) return [...REASONING_LEVELS];
  const known = declared.filter((value): value is ReasoningLevel =>
    (REASONING_LEVELS as string[]).includes(value),
  );
  return known.length > 0 ? known : [...REASONING_LEVELS];
}

/** 模型声明的默认档 → 选择器初始值；未声明或非法回退 default（不发送）。 */
export function normalizeDeclaredDefault(declared?: string | null): ReasoningLevel {
  return declared && (REASONING_LEVELS as string[]).includes(declared)
    ? (declared as ReasoningLevel)
    : "default";
}

/** 仅 chat 类模型显示思考档位控件；无能力数据时按未声明处理（隐藏）。 */
export function isChatModel(modelInfo: { model_type: string } | null | undefined): boolean {
  return modelInfo?.model_type === "chat";
}

// ---------------------------------------------------------------- 解析辅助

/** 空串 → undefined；非数字 → undefined（由 validateChatParams 报错）。 */
export function parseOptionalNumber(raw: string | undefined): number | undefined {
  const text = (raw ?? "").trim();
  if (!text) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * stop 的分隔符（票19）：主用逗号；旧多行输入的换行在解析时折算成同一语义
 * （一次性迁移，存量换行写法继续工作）。分号从来不是分隔符，保持为内容。
 * 注意是单字符集、不带 +：连续逗号必须各自成段，空条目才检测得出来。
 */
const STOP_SEPARATORS = /[\n,]/;

/** stop 多值输入 → 真正发出去的数组；逗号/换行拆分，trim，去空，保序。 */
export function parseStopSequences(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(STOP_SEPARATORS)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 空条目检测（票19 行内校验）：「a,,b」「a,」这类写法会产生空 stop 条目，
 * 上游会拒绝，发送前拦下并提示。与 parseStopSequences 共用同一份分隔符定义。
 */
export function stopHasEmptyItems(raw: string | undefined): boolean {
  const text = raw ?? "";
  if (!text.trim()) return false;
  return text.split(STOP_SEPARATORS).some((item) => item.trim().length === 0);
}

export interface ExtraFieldsResult {
  ok: boolean;
  value: Record<string, unknown>;
  error?: string;
}

/** 「额外请求字段（JSON）」框：空=不发送；非对象或非法 JSON 直接拦下。 */
export function parseExtraFields(raw: string | undefined): ExtraFieldsResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, value: {} };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, value: {}, error: "额外请求字段需是一个 JSON 对象。" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, value: {}, error: "额外请求字段不是合法 JSON。" };
  }
}

// ---------------------------------------------------------------- 参数表

interface ParamContext {
  maxOutputTokens: number;
}

/** 参数表一行：面板字段 ↔ 线上字段 + 校验 + 转发 + 摘要，新增参数只加一行。 */
interface ParamRow {
  /** 面板 state / ChatParamInput 的字段名。 */
  inputKey: keyof ChatParamInput;
  /** 控制面 PlaygroundRequest 的字段名（唯一转发名）。 */
  wireKey: keyof ChatRequestParams;
  /** 参与输入区摘要时的字段名；缺省 = 不参与摘要。 */
  summaryLabel?: string;
  /** 校验：返回错误文案；null = 通过。 */
  check(input: ChatParamInput, ctx: ParamContext): string | null;
  /** 输入 → 线上值；undefined = 本次不发送。 */
  toWire(input: ChatParamInput, ctx: ParamContext): unknown;
  /** 摘要里的展示值；undefined = 不列入摘要。 */
  summary?(input: ChatParamInput): string | undefined;
}

interface NumericRowSpec {
  inputKey: keyof ChatParamInput;
  wireKey: keyof ChatRequestParams;
  summaryLabel?: string;
  min?: number;
  /** 上界；函数用于按所选模型动态收敛（max_tokens）。 */
  max?: number | ((ctx: ParamContext) => number);
  /** true = 必须严格大于 min（top_p）。 */
  exclusiveMin?: boolean;
  integer?: boolean;
  message: string | ((ctx: ParamContext) => string);
}

/** 数字 / 整数参数行：空 = 不发送；非空必须是合法数字并在区间内。 */
function numericRow(spec: NumericRowSpec): ParamRow {
  const messageFor = (ctx: ParamContext) =>
    typeof spec.message === "function" ? spec.message(ctx) : spec.message;
  return {
    inputKey: spec.inputKey,
    wireKey: spec.wireKey,
    summaryLabel: spec.summaryLabel,
    check(input, ctx) {
      const raw = input[spec.inputKey] as string | undefined;
      if (!raw?.trim()) return null;
      const value = parseOptionalNumber(raw);
      if (value === undefined) return messageFor(ctx);
      if (spec.integer && !Number.isInteger(value)) return messageFor(ctx);
      const min = spec.min ?? -Infinity;
      const max = typeof spec.max === "function" ? spec.max(ctx) : (spec.max ?? Infinity);
      if (spec.exclusiveMin ? value <= min : value < min) return messageFor(ctx);
      if (value > max) return messageFor(ctx);
      return null;
    },
    toWire(input) {
      return parseOptionalNumber(input[spec.inputKey] as string | undefined);
    },
    summary: spec.summaryLabel
      ? (input) => {
          const raw = input[spec.inputKey] as string | undefined;
          return raw?.trim() ? raw.trim() : undefined;
        }
      : undefined,
  };
}

/**
 * 参数表的唯一事实源。顺序同时决定：校验的报错优先级、请求体字段顺序与摘要顺序；
 * wireKey 必须与控制面 PlaygroundRequest 的字段名一致（生成类型保证拼写）。
 */
const PARAM_TABLE: readonly ParamRow[] = [
  numericRow({
    inputKey: "temperature",
    wireKey: "temperature",
    summaryLabel: "temperature",
    min: 0,
    max: 2,
    message: "temperature 需在 0 至 2 之间。",
  }),
  numericRow({
    inputKey: "topP",
    wireKey: "top_p",
    summaryLabel: "top_p",
    min: 0,
    exclusiveMin: true,
    max: 1,
    message: "top_p 需大于 0 且不超过 1。",
  }),
  numericRow({
    inputKey: "topK",
    wireKey: "top_k",
    summaryLabel: "top_k",
    min: 0,
    integer: true,
    message: "top_k 需是 ≥0 的整数。",
  }),
  numericRow({
    inputKey: "frequencyPenalty",
    wireKey: "frequency_penalty",
    min: -2,
    max: 2,
    message: "frequency_penalty 需在 −2 至 2 之间。",
  }),
  numericRow({
    inputKey: "presencePenalty",
    wireKey: "presence_penalty",
    min: -2,
    max: 2,
    message: "presence_penalty 需在 −2 至 2 之间。",
  }),
  numericRow({
    inputKey: "seed",
    wireKey: "seed",
    min: Number.MIN_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
    integer: true,
    message: "seed 需是整数。",
  }),
  numericRow({
    inputKey: "maxTokens",
    wireKey: "max_tokens",
    summaryLabel: "max_tokens",
    min: 1,
    max: (ctx) => ctx.maxOutputTokens,
    integer: true,
    message: (ctx) => `max_tokens 需是 1 至 ${ctx.maxOutputTokens} 的整数（上限取自所选模型）。`,
  }),
  numericRow({
    inputKey: "maxCompletionTokens",
    wireKey: "max_completion_tokens",
    min: 1,
    max: (ctx) => ctx.maxOutputTokens,
    integer: true,
    message: (ctx) =>
      `max_completion_tokens 需是 1 至 ${ctx.maxOutputTokens} 的整数（上限取自所选模型）。`,
  }),
  numericRow({
    inputKey: "n",
    wireKey: "n",
    min: 1,
    max: 128,
    integer: true,
    message: "n 需是 1 至 128 的整数。",
  }),
  {
    inputKey: "stop",
    wireKey: "stop",
    summaryLabel: "stop",
    check(input) {
      if (parseStopSequences(input.stop).length > 4) {
        return "stop 最多 4 条，逗号分隔。";
      }
      if (stopHasEmptyItems(input.stop)) {
        return "stop 含空条目，请去掉多余或连续的逗号。";
      }
      return null;
    },
    toWire(input) {
      const stop = parseStopSequences(input.stop);
      return stop.length ? stop : undefined;
    },
    summary(input) {
      const count = parseStopSequences(input.stop).length;
      return count ? count + " 条" : undefined;
    },
  },
  {
    inputKey: "topLogprobs",
    wireKey: "top_logprobs",
    check(input) {
      if (!input.topLogprobs?.trim()) return null;
      if (!input.logprobs) return "top_logprobs 需要先打开 logprobs。";
      const value = parseOptionalNumber(input.topLogprobs);
      if (value === undefined || !Number.isInteger(value) || value < 0 || value > 20) {
        return "top_logprobs 需是 0 至 20 的整数。";
      }
      return null;
    },
    toWire(input) {
      return input.logprobs ? parseOptionalNumber(input.topLogprobs) : undefined;
    },
  },
  {
    inputKey: "user",
    wireKey: "user",
    check(input) {
      const text = input.user?.trim();
      if (text && text.length > 256) return "user 最多 256 个字符。";
      return null;
    },
    toWire(input) {
      return input.user?.trim() || undefined;
    },
  },
  {
    inputKey: "responseFormat",
    wireKey: "response_format",
    check: () => null,
    toWire(input) {
      return input.responseFormat === "json_object"
        ? ({ type: "json_object" } as const)
        : undefined;
    },
  },
  {
    inputKey: "logprobs",
    wireKey: "logprobs",
    check: () => null,
    toWire(input) {
      return input.logprobs ? true : undefined;
    },
  },
  {
    inputKey: "thinkingMode",
    wireKey: "reasoning_effort",
    summaryLabel: "思考",
    check: () => null,
    toWire(input) {
      const mode = input.thinkingMode ?? "default";
      return mode === "default" ? undefined : mode;
    },
    summary(input) {
      const mode = input.thinkingMode ?? "default";
      return mode === "default" ? undefined : "reasoning_effort=" + mode;
    },
  },
  {
    inputKey: "extraFields",
    wireKey: "extra_fields",
    summaryLabel: "额外字段",
    check(input) {
      const extra = parseExtraFields(input.extraFields);
      return extra.ok ? null : (extra.error ?? "额外请求字段不合法。");
    },
    toWire(input) {
      const extra = parseExtraFields(input.extraFields);
      return Object.keys(extra.value).length ? extra.value : undefined;
    },
    summary(input) {
      const count = Object.keys(parseExtraFields(input.extraFields).value).length;
      return count ? count + " 个" : undefined;
    },
  },
];

function contextOf(options: ChatParamValidationOptions = {}): ParamContext {
  return { maxOutputTokens: maxOutputTokensFor(options.maxOutputTokens) };
}

/**
 * 请求前的内联校验：按参数表顺序，只要有一条不合法就拦住发送，
 * 错误文案直接显示在输入区。输出上限来自所选模型（见 maxOutputTokensFor）。
 */
export function validateChatParams(
  input: ChatParamInput,
  options: ChatParamValidationOptions = {},
): ChatParamValidation {
  const ctx = contextOf(options);
  for (const row of PARAM_TABLE) {
    const message = row.check(input, ctx);
    if (message) return { valid: false, message };
  }
  return { valid: true };
}

/** 输入框里的字符串 → 控制面 PlaygroundRequest 的参数部分；留空的一律不发送。 */
export function toRequestParams(
  input: ChatParamInput,
  options: ChatParamValidationOptions = {},
): ChatRequestParams {
  const ctx = contextOf(options);
  const params: Record<string, unknown> = {};
  for (const row of PARAM_TABLE) {
    const value = row.toWire(input, ctx);
    if (value !== undefined) params[row.wireKey] = value;
  }
  return params as unknown as ChatRequestParams;
}

/** 输入区顶部的一句话摘要：只列这次真正会发送的字段（参数表决定顺序）。 */
export function summarizeChatParams(input: ChatParamInput): string {
  const parts: string[] = [];
  for (const row of PARAM_TABLE) {
    if (!row.summaryLabel) continue;
    const value = row.summary?.(input)?.trim();
    if (value) parts.push(row.summaryLabel + " " + value);
  }
  return parts.length ? parts.join(" · ") : "全部默认";
}

// ---------------------------------------------------------------- 说明文案

/**
 * 参数说明文案：面板只负责排版，文案集中在这里，和参数表的区间一起校对
 * （改口径先改这里）。systemPrompt/apiKey/streamMode/reasoningLevel 不是
 * 转发参数，只是 UI 字段的说明。
 */
export const PARAM_HINTS = {
  temperature: { range: "0.0 至 2.0", usage: "越高输出越随机，越低越确定" },
  topP: { range: "0.0 至 1.0（> 0）", usage: "与 temperature 二选一调整，越小候选越少" },
  topK: { range: "≥ 0 的整数", usage: "只从概率最高的前 k 个候选里挑；上游未校验" },
  frequencyPenalty: { range: "−2.0 至 2.0", usage: "按出现次数压低重复词，越高越不容易复读" },
  presencePenalty: { range: "−2.0 至 2.0", usage: "按是否出现过压低，越高越愿意换话题" },
  seed: { range: "整数", usage: "固定随机种子便于复现；上游未校验，可能被忽略" },
  maxTokens: { range: "1 至模型上限", usage: "本次回复最多生成的词元数" },
  maxCompletionTokens: { range: "1 至模型上限", usage: "与 max_tokens 二选一，新版接口用它替代" },
  n: { range: "1 至 128", usage: "一次生成几份候选回复；多数上游只支持 1" },
  stop: { range: "最多 4 条，逗号分隔", usage: "命中任一条就停止生成，停止词不进回复" },
  responseFormat: { range: "text / json_object", usage: "json_object 要求提示词里明确要求 JSON" },
  logprobs: { range: "开 / 关", usage: "返回每个生成词元的对数概率，用于排查" },
  topLogprobs: { range: "0 至 20", usage: "返回前 k 个候选词的概率；需先打开 logprobs" },
  user: { range: "≤ 256 字符", usage: "给上游的稳定用户标识，用于滥用追踪" },
  thinkingMode: {
    range: "default / none / low / medium / high / xhigh / max",
    usage: "default 表示不发送该参数；其余档位控制面按值转发到上游",
  },
  extraFields: {
    range: "顶层 JSON 对象",
    usage: "厂商私有字段原样合并进请求体；与标准参数同名时以标准参数为准",
  },
  systemPrompt: { range: "可选", usage: "作为 system 消息置顶，本会话每次请求都带" },
  apiKey: { range: "留空用登录凭证", usage: "只留在浏览器内存，随请求发 Authorization" },
  streamMode: { range: "开 / 关", usage: "开=逐条收 SSE；关=等完整回复一次返回" },
  reasoningLevel: {
    range: "只读",
    usage: "当前选择的思考档位；在模型对话框或高级参数里调整",
  },
} satisfies Record<string, ParamHint>;

export type ParamHintKey = keyof typeof PARAM_HINTS;

/** 组装面板那行小字：取值范围 · 用途；range 可覆盖（如 max_tokens 的实际上限）。 */
export function paramHintText(key: ParamHintKey, range?: string): string {
  const hint = PARAM_HINTS[key];
  return (range ?? hint.range) + " · " + hint.usage;
}

/**
 * 页面/面板只依赖这一组参数命令（内部实现全部来自上面的参数表）：
 * 校验、摘要、转发、上限、思考档位与提示文案。
 */
export const chatParams = {
  validate: validateChatParams,
  summarize: summarizeChatParams,
  toRequest: toRequestParams,
  maxOutputTokens: maxOutputTokensFor,
  defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  hint: paramHintText,
  isChatModel,
  thinkingOptions: reasoningLevelOptions,
  thinkingLabel: (level: ReasoningLevel): string => REASONING_LEVEL_LABELS[level],
  normalizeThinking: normalizeDeclaredDefault,
} as const;
