/**
 * 报表时间窗状态（F1 看板定案，F2b 日志复用）：
 *   { kind: "range", value }  走后端 range 枚举（桶边界按报表时区切，前端不自算毫秒）；
 *   { kind: "custom", fromMs, toMs }  显式毫秒窗（本周/本月/自定义），成对传 from_ms/to_ms，
 *     后端 F 契约：成对生效，payload range 回显 "custom"。
 */
import { MAX_CUSTOM_SPAN_DAYS, MAX_CUSTOM_SPAN_MS } from "@/generated/contract";

export type TimeWindowRange = "today" | "24h" | "7d" | "30d";

export type TimeWindow =
  | { kind: "range"; value: TimeWindowRange }
  | { kind: "custom"; fromMs: number; toMs: number };

/**
 * 自定义窗上限（W6 票 16）：唯一实义定义在后端 l06_api/deps.py，gen_ts.py 同步进
 * generated/contract.ts，这里只消费契约值并再导出——前端不各写一份，选择器与后端不会漂移。
 */
export const TIME_WINDOW_MAX_SPAN_MS = MAX_CUSTOM_SPAN_MS;
export const TIME_WINDOW_MAX_SPAN_DAYS = MAX_CUSTOM_SPAN_DAYS;

const DAY_MS = 86_400_000;

export const TIME_WINDOW_RANGES: Array<{ value: TimeWindowRange; label: string }> = [
  { value: "24h", label: "近 24 小时" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "today", label: "今天" },
];

export const TIME_WINDOW_LABEL: Record<TimeWindowRange, string> = {
  today: "今天",
  "24h": "近 24 小时",
  "7d": "近 7 天",
  "30d": "近 30 天",
};

/** 本周一 00:00（浏览器本地时区；周从周一开始）。 */
export function startOfWeekMs(now = Date.now()): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

/** 本月 1 日 00:00（浏览器本地时区）。 */
export function startOfMonthMs(now = Date.now()): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(1);
  return day.getTime();
}

/** 某天 00:00；dayMs 可以是任意时刻。 */
export function dayStartMs(at: number | Date): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** 某天次日 00:00（「零点」按钮的结束边界）。 */
export function nextDayStartMs(at: number | Date): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + 1);
  return day.getTime();
}

/**
 * 日历可回看的天数下界（W6 票 16）：最早可选日 = 今天 00:00 −（上限−1）天。
 * 上限来自契约（366 天），因此最宽可选窗（最早日 00:00 → 今天次日 00:00 的「零点」）
 * 恰好等于上限，后端放行；日历不用再各算一份回看天数。
 */
export function earliestCustomDayMs(now: number | Date = Date.now()): number {
  return dayStartMs(now) - (MAX_CUSTOM_SPAN_DAYS - 1) * DAY_MS;
}

/**
 * 显式毫秒窗的跨度校验：超出上限时返回给行内提示的文案（带上限与当前天数），
 * null 表示未超界。发布路径（publish/此刻/零点）先过这里，失败不 onChange、不发请求。
 */
export function customWindowSpanError(fromMs: number, toMs: number): string | null {
  const span = toMs - fromMs;
  if (span > MAX_CUSTOM_SPAN_MS) {
    return `时间范围最多 ${MAX_CUSTOM_SPAN_DAYS} 天（当前 ${Math.ceil(span / DAY_MS)} 天），请缩短区间后再查询。`;
  }
  return null;
}

/** 该时间窗是否允许发聚合请求：预设恒可用；自定义窗必须成对有序且不超上限（W6 票 16）。 */
export function timeWindowUsable(window: TimeWindow): boolean {
  if (window.kind === "range") return true;
  return window.toMs > window.fromMs && customWindowSpanError(window.fromMs, window.toMs) === null;
}

/** 两个时间窗是否同值：dirty 判定的唯一口径（不得用数组/对象引用比较）。 */
export function timeWindowEquals(a: TimeWindow, b: TimeWindow): boolean {
  if (a.kind === "range" || b.kind === "range") {
    return a.kind === "range" && b.kind === "range" && a.value === b.value;
  }
  return a.fromMs === b.fromMs && a.toMs === b.toMs;
}

/** 进 react-query queryKey 的稳定片段：预设与毫秒窗互不混淆。 */
export function timeWindowKey(window: TimeWindow): Array<string | number> {
  return window.kind === "range"
    ? ["range", window.value]
    : ["custom", window.fromMs, window.toMs];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function stamp(ms: number): string {
  const at = new Date(ms);
  return (
    `${at.getFullYear()}/${pad2(at.getMonth() + 1)}/${pad2(at.getDate())} ` +
    `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`
  );
}

/** 触发按钮/副标题用的区间文本：预设名，或完整到「年 + 秒」的毫秒窗起止（W8 票 02）。 */
export function timeWindowLabel(window: TimeWindow): string {
  if (window.kind === "range") return TIME_WINDOW_LABEL[window.value];
  return `${stamp(window.fromMs)} 至 ${stamp(window.toMs)}`;
}
