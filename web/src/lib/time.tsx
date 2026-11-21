export type TimezoneMode = "local" | "utc";

interface TimezoneContextValue {
  mode: TimezoneMode;
}

// 时区切换随 TimezoneProvider 一并移除（W6 死代码清理）：无 UI 可切换时区，
// useTimezone 恒返回本地时区；将来要加切换时再引入 Provider + context。
const LOCAL_MODE: TimezoneContextValue = { mode: "local" };

export function useTimezone(): TimezoneContextValue {
  return LOCAL_MODE;
}

export const TIMEZONE_LABEL: Record<TimezoneMode, string> = {
  local: "本地",
  utc: "UTC",
};

interface DateTimeParts {
  date: string;
  time: string;
}

// Intl.DateTimeFormat construction is the expensive part; a 100-row log table
// used to create one formatter per cell. Cache one per timezone mode.
const dateTimeFormatters = new Map<TimezoneMode, Intl.DateTimeFormat>();

function dateTimeFormatter(mode: TimezoneMode): Intl.DateTimeFormat {
  const cached = dateTimeFormatters.get(mode);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: mode === "utc" ? "UTC" : undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
  dateTimeFormatters.set(mode, formatter);
  return formatter;
}

export function formatDateTimeParts(
  ms: number | null | undefined,
  mode: TimezoneMode,
): DateTimeParts | null {
  if (!ms) return null;
  const parts = dateTimeFormatter(mode).formatToParts(new Date(ms));
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`,
  };
}

export function formatDateTime(ms: number | null | undefined, mode: TimezoneMode): string {
  const parts = formatDateTimeParts(ms, mode);
  if (!parts) return "-";
  return `${parts.date} ${parts.time}`;
}
