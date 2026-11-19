import { fmtPct } from "@/lib/format";

export type LogBadgeTone = "neutral" | "success" | "warning" | "danger" | "info";


/** 吞吐只展示生成阶段的速度，单位由调用方补「词元/s」；无输出或无法测速时留白。 */
export function fmtThroughput(tps: number | null | undefined): string {
  if (tps === null || tps === undefined || !Number.isFinite(tps) || tps <= 0) return "—";
  return tps >= 100 ? Math.round(tps).toLocaleString("en-US") : tps.toFixed(1);
}

/** 缓存比例按百分数展示；0 与 null 都表示这次请求没有吃到缓存。 */
export function fmtCachePct(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio) || ratio <= 0) return "—";
  return ratio >= 10 ? Math.round(ratio) + "%" : ratio.toFixed(1) + "%";
}

export function statusTone(status: number): LogBadgeTone {
  if (status >= 200 && status < 300) return "success";
  if (status >= 500 || status === 0) return "danger";
  if (status >= 400) return "warning";
  return "neutral";
}

export function statusLabel(status: number): string {
  return status > 0 ? String(status) : "无状态";
}

/** 上游列：优先展示上游模型名，并用 P{n} 标出该目标在公开模型里的层。 */
export function upstreamLabel(row: { upstream_model: string; target_priority: number | null }): string {
  if (row.target_priority === null) return row.upstream_model || "—";
  return (row.upstream_model || "—") + " · P" + row.target_priority;
}

/** 接口类型展示名（GLOSSARY §4 模型类型）：chat 是 OpenAI 兼容面，systemone 是 AG 内置协议。 */
const MODEL_TYPE_LABELS: Record<string, string> = {
  chat: "OpenAI兼容",
  embedding: "Embedding",
  rerank: "Rerank",
  image: "图像",
  video: "视频",
  audio: "音频",
  systemone: "SystemOne",
  custom: "自定义",
};

export function modelTypeLabel(modelType: string | null | undefined): string {
  if (!modelType) return "—";
  return MODEL_TYPE_LABELS[modelType] ?? modelType;
}

/**
 * 净输入词元（GLOSSARY §5 缓存比例口径的分母一半）：input_tokens 折算了缓存，
 * 扣掉缓存读/写才是真正现算的输入；结果夹到 ≥0 防上游回填负值。
 */
export function netInputTokens(input: number, cacheRead: number, cacheWrite: number): number {
  return Math.max(0, input - cacheRead - cacheWrite);
}

/**
 * 缓存比例 = 缓 ÷（净输入 + 缓）（0–1 区间小数，展示走 fmtPct）；
 * input_tokens 为 0（embedding 等）或缓存皆 0 时回 null（显示「无缓存」）。
 */
export function cacheHitFraction(
  input: number,
  cacheRead: number,
  cacheWrite: number,
): number | null {
  const cache = Math.max(0, cacheRead) + Math.max(0, cacheWrite);
  if (cache <= 0 || input <= 0) return null;
  return cache / input;
}

/** 缓存比例的次行文本：无缓存时返回「无缓存」，否则「比例 xx.xx%」。 */
export function cacheRatioText(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return "无缓存";
  return "比例 " + fmtPct(fraction);
}

/** 毛利率 =（花费−成本）÷ 花费（0–1 区间小数）；花费缺失或为 0 时回 null。 */
export function marginFraction(
  marginMicro: number | null | undefined,
  chargeMicro: number | null | undefined,
): number | null {
  if (marginMicro === null || marginMicro === undefined) return null;
  if (chargeMicro === null || chargeMicro === undefined || chargeMicro === 0) return null;
  return marginMicro / chargeMicro;
}
