/**
 * 报表时间窗状态（F1 看板定案，F2b 日志复用）：
 *   { kind: "range", value }  走后端 range 枚举（桶边界按报表时区切，前端不自算毫秒）；
 *   { kind: "custom", fromMs, toMs }  显式毫秒窗（本周/本月/自定义），成对传 from_ms/to_ms，
 *     后端 F 契约：成对生效，payload range 回显 "custom"。
 */
export type TimeWindowRange = "today" | "24h" | "7d" | "30d";

export type TimeWindow =
  | { kind: "range"; value: TimeWindowRange }
  | { kind: "custom"; fromMs: number; toMs: number };

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
    `${pad2(at.getMonth() + 1)}/${pad2(at.getDate())} ` +
    `${pad2(at.getHours())}:${pad2(at.getMinutes())}`
  );
}

/** 触发按钮/副标题用的区间文本：预设名或毫秒窗起止。 */
export function timeWindowLabel(window: TimeWindow): string {
  if (window.kind === "range") return TIME_WINDOW_LABEL[window.value];
  return `${stamp(window.fromMs)} 至 ${stamp(window.toMs)}`;
}
