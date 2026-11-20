/**
 * 语义色单一来源（spec §7）：成功绿 / 警示琥珀 / 信息蓝 / 危险红 / 中性灰。
 *
 * 所有「状态」相关颜色只能从这里取 tone 再映射到 token 类，禁止页面自拼
 * text-red-500 之类的裸色值。文字色 + 浅底 + 描边三件套在 index.css 的
 * @theme inline 里映射到 --color-*-text / --color-*-soft / --color-*。
 */
export const SEMANTIC_TONES = ["success", "warning", "info", "danger", "neutral"] as const;

export type SemanticTone = (typeof SEMANTIC_TONES)[number];

/** 主文字色（图标 + 文字共用）：状态语义靠它，不只靠底色。 */
export const TONE_TEXT: Record<SemanticTone, string> = {
  success: "text-success-text",
  warning: "text-warning-text",
  info: "text-info-text",
  danger: "text-danger-text",
  neutral: "text-neutral-text",
};

/** 浅底（alert/badge/脏标记的浅色背景）。 */
export const TONE_SOFT_BG: Record<SemanticTone, string> = {
  success: "bg-success-soft",
  warning: "bg-warning-soft",
  info: "bg-info-soft",
  danger: "bg-danger-soft",
  neutral: "bg-neutral-soft",
};

/** 描边（需要边界的提示块/色条）。 */
export const TONE_BORDER: Record<SemanticTone, string> = {
  success: "border-success",
  warning: "border-warning",
  info: "border-info",
  danger: "border-danger",
  neutral: "border-neutral",
};

export function toneText(tone: SemanticTone): string {
  return TONE_TEXT[tone];
}

export function toneSoftBg(tone: SemanticTone): string {
  return TONE_SOFT_BG[tone];
}

export function toneBorder(tone: SemanticTone): string {
  return TONE_BORDER[tone];
}
