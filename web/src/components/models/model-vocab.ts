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

/** 能力位摘要：输入类型 → 输出类型 · 能力（模型管理页与上游详情页同一口径）。 */
export function parameterSummary(row: { parameters?: ModelParameters }): string {
  const p = parametersOf(row);
  const input = p.input_types.length > 0 ? p.input_types.join("/") : "-";
  const output = p.output_types.length > 0 ? p.output_types.join("/") : "-";
  const caps: string[] = [];
  if (p.tool_call) caps.push("工具");
  if (p.reasoning) caps.push("推理");
  if (p.structured_output) caps.push("结构化");
  return input + " → " + output + (caps.length > 0 ? " · " + caps.join("/") : "");
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
