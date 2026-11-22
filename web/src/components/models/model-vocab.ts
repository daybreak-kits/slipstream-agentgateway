import { fmtInt } from "@/lib/format";
import { REASONING_LEVEL_LABELS } from "@/lib/chat";
import type { ModelParameters, ModelTypeSource, RoutingMode } from "@/types";

/** 路由策略词表：标签 + 说明（列表策略列、编辑弹窗与整页编辑器共用）。 */
export const ROUTING_LABELS: Record<RoutingMode, { label: string; desc: string }> = {
  failover: { label: "failover · 故障转移", desc: "按 priority 层级顺序选择；priority 数值小优先，同层由数据面按健康与延迟选择" },
  weighted: { label: "weighted · 加权分流", desc: "按 weight 整数相对比例分配（1 与 3 = 1:3）；该模式没有跨层兜底" },
  conditional: { label: "conditional · 条件路由", desc: "按 when 表达式匹配成员，只有末位成员可以留空；该模式没有跨层兜底" },
};

/** 旧系统 catalog 的七种模型类型（l02_domain/models.ModelType）。 */
export const MODEL_TYPES: Array<{ value: string; label: string }> = [
  { value: "chat", label: "chat · 对话" },
  { value: "embedding", label: "embedding · 向量化" },
  { value: "rerank", label: "rerank · 重排" },
  { value: "image_generation", label: "image_generation · 图像生成" },
  { value: "audio_tts", label: "audio_tts · 语音合成" },
  { value: "audio_transcription", label: "audio_transcription · 语音转写" },
  { value: "video", label: "video · 视频生成" },
];

/** 旧系统 model_type_source 三值；auto 是指令，不是存储值。 */
export const TYPE_SOURCE_LABELS: Record<ModelTypeSource, string> = {
  default: "默认（按类型推断）",
  upstream: "上游声明",
  manual: "人工指定",
};

export const DEFAULT_PARAMETERS: ModelParameters = {
  max_input_tokens: 0,
  max_output_tokens: 0,
  reasoning_level: "",
  reasoning_levels: [],
  default_reasoning_level: "",
  input_types: ["text"],
  output_types: ["text"],
  tool_call: false,
  reasoning: false,
  attachment: false,
  structured_output: false,
};

/** 自由输入收成非负整数；空/非法回 0（0 = 未声明）。 */
export function toInt(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export function parametersOf(row: { parameters?: ModelParameters }): ModelParameters {
  return { ...DEFAULT_PARAMETERS, ...(row.parameters ?? {}) };
}

/** 参数列只显示输入/输出上限（W7 t09 · D9）：0 = 未声明 → 明确写「未配置」，不留空也不画成输入框。 */
export const PARAM_MISSING = "未配置";

/** 参数列文本：「输入 200,000 / 输出 128,000」（千分位走 fmtInt，与全站数字口径一致）。 */
export function parameterLimitsText(row: { parameters?: ModelParameters }): string {
  const p = parametersOf(row);
  const input = p.max_input_tokens > 0 ? fmtInt(p.max_input_tokens) : PARAM_MISSING;
  const output = p.max_output_tokens > 0 ? fmtInt(p.max_output_tokens) : PARAM_MISSING;
  return "输入 " + input + " / 输出 " + output;
}

/** 档位原值 → 展示文案（与编辑抽屉同一张档位表；未知值原样透出）。 */
function levelLabel(level: string): string {
  return REASONING_LEVEL_LABELS[level as keyof typeof REASONING_LEVEL_LABELS] ?? level;
}

/**
 * 完整参数明细（悬浮详情用）：字段名与编辑抽屉「能力与参数」块一致，
 * 缺失值一律写「未配置」——省略会让「没配」和「配成 0」看起来一样。
 */
export function parameterDetailRows(row: { parameters?: ModelParameters }): Array<{ label: string; value: string }> {
  const p = parametersOf(row);
  const capabilities: string[] = [];
  if (p.tool_call) capabilities.push("工具调用");
  if (p.reasoning) capabilities.push("推理");
  if (p.attachment) capabilities.push("附件");
  if (p.structured_output) capabilities.push("结构化输出");
  const levels = p.reasoning_levels ?? [];
  return [
    { label: "最大输入词元", value: p.max_input_tokens > 0 ? fmtInt(p.max_input_tokens) : PARAM_MISSING },
    { label: "最大输出词元", value: p.max_output_tokens > 0 ? fmtInt(p.max_output_tokens) : PARAM_MISSING },
    { label: "输入类型", value: p.input_types.length > 0 ? p.input_types.join(" / ") : PARAM_MISSING },
    { label: "输出类型", value: p.output_types.length > 0 ? p.output_types.join(" / ") : PARAM_MISSING },
    { label: "能力", value: capabilities.length > 0 ? capabilities.join(" / ") : "无" },
    { label: "推理档位", value: p.reasoning_level ? levelLabel(p.reasoning_level) : PARAM_MISSING },
    {
      label: "思考档位",
      value: levels.length > 0
        ? levels.map(levelLabel).join(" / ") + (p.default_reasoning_level ? "（默认 " + levelLabel(p.default_reasoning_level) + "）" : "")
        : PARAM_MISSING,
    },
  ];
}

/** image 类型在 AG 数据面不记词元，无法计费（E14b 实测）。 */
export function isImageType(modelType: string): boolean {
  return modelType.startsWith("image");
}

/** 名称相似度：子串优先，其次子序列；用于创建公开模型时提示相似上游模型。 */
export function similarity(needle: string, candidate: string): number {
  if (!needle) return 0;
  const normalized = candidate.toLowerCase();
  if (normalized === needle) return 200;
  const index = normalized.indexOf(needle);
  if (index >= 0) return 120 - index + needle.length * 2;
  let pos = 0;
  let gaps = 0;
  for (const ch of needle) {
    if (ch === "-" || ch === "_" || ch === "." || ch === "/") continue;
    const found = normalized.indexOf(ch, pos);
    if (found < 0) return 0;
    gaps += found - pos;
    pos = found + 1;
  }
  return Math.max(1, 60 - gaps - needle.length);
}
