import { zhCN } from "date-fns/locale";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { pushErrorNotificationOnce } from "@/lib/notification-store";
import { cn } from "@/lib/utils";

import {
  TIME_WINDOW_RANGES,
  customWindowSpanError,
  dayStartMs,
  earliestCustomDayMs,
  nextDayStartMs,
  startOfMonthMs,
  startOfWeekMs,
  timeWindowLabel,
  type TimeWindow,
  type TimeWindowRange,
} from "./window";

const DEFAULT_START_TIME = "00:00";
const DEFAULT_END_TIME = "23:59";

const PRESET_CHIP =
  "h-7 rounded-control px-2 text-2xs text-body data-[state=on]:bg-primary-soft data-[state=on]:text-primary";

export interface TimeRangePickerProps {
  value: TimeWindow;
  onChange: (next: TimeWindow) => void;
  className?: string;
  /** 草稿窗口与已生效窗口不同：触发按钮加黄边（W7 日志筛选 dirty 视觉）。 */
  highlighted?: boolean;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Date + HH:mm → 本地时区毫秒。 */
function toMs(day: Date, time: string): number {
  const [hour, minute] = time.split(":");
  const at = new Date(day);
  at.setHours(Number(hour ?? 0), Number(minute ?? 0), 0, 0);
  return at.getTime();
}

function msToTime(ms: number): string {
  const at = new Date(ms);
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/**
 * 报表时间区间选择器（页右上；F2b 日志页复用）。
 * 预设 近24小时/近7天/近30天/今天 走 range 枚举，本周/本月/自定义落成 {kind:"custom",fromMs,toMs}；
 * 弹层内日历选起止日 + HH:mm，两个小按钮：「此刻」= 开始日 00:00 → 当前时刻，「零点」= 开始日 00:00 → 结束日次日 00:00。
 */
export function TimeRangePicker({ value, onChange, className, highlighted = false }: TimeRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<DateRange | undefined>(undefined);
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);

  // 打开弹层时把已生效区间铺回草稿：custom 回填日历与时刻，预设则清空草稿。
  useEffect(() => {
    if (!open) return;
    if (value.kind === "custom") {
      const from = new Date(value.fromMs);
      const to = new Date(value.toMs);
      setDays({ from, to });
      setStartTime(msToTime(value.fromMs));
      setEndTime(msToTime(value.toMs));
    } else {
      setDays(undefined);
      setStartTime(DEFAULT_START_TIME);
      setEndTime(DEFAULT_END_TIME);
    }
  }, [open, value]);

  /** 跨度超界的统一反馈（W6 票 16）：只走通知中心（票 07 语义），不弹逐条 toast。 */
  const notifySpanBlocked = (message: string) => {
    pushErrorNotificationOnce({
      title: "时间范围超出上限",
      description: message,
      dedupeKey: "time-window-span|" + message,
    });
  };

  /** 起止齐且结束晚于开始、且不超 366 天上限才上抛；否则保留上一次生效区间，不发请求。 */
  const publish = (nextDays: DateRange | undefined, nextStart: string, nextEnd: string) => {
    if (!nextDays?.from || !nextDays.to || !nextStart || !nextEnd) return;
    const fromMs = toMs(nextDays.from, nextStart);
    const toMsValue = toMs(nextDays.to, nextEnd);
    if (toMsValue <= fromMs) return;
    const spanError = customWindowSpanError(fromMs, toMsValue);
    if (spanError) {
      notifySpanBlocked(spanError);
      return;
    }
    onChange({ kind: "custom", fromMs, toMs: toMsValue });
  };

  const chooseDays = (next: DateRange | undefined) => {
    setDays(next);
    publish(next, startTime, endTime);
  };

  const chooseTime = (nextStart: string, nextEnd: string) => {
    setStartTime(nextStart);
    setEndTime(nextEnd);
    publish(days, nextStart, nextEnd);
  };

  /** 「此刻」：开始日 00:00 → 当前时刻。 */
  const pickNow = () => {
    if (!days?.from) return;
    const now = Date.now();
    const next: TimeWindow = { kind: "custom", fromMs: dayStartMs(days.from), toMs: now };
    if (next.toMs <= next.fromMs) return;
    const spanError = customWindowSpanError(next.fromMs, next.toMs);
    if (spanError) {
      notifySpanBlocked(spanError);
      return;
    }
    setStartTime("00:00");
    setEndTime(msToTime(now));
    onChange(next);
  };

  /** 「零点」：开始日 00:00 → 结束日次日 00:00（未选结束日时按开始日）。 */
  const pickMidnight = () => {
    if (!days?.from) return;
    const endDay = days.to ?? days.from;
    const next: TimeWindow = {
      kind: "custom",
      fromMs: dayStartMs(days.from),
      toMs: nextDayStartMs(endDay),
    };
    if (next.toMs <= next.fromMs) return;
    const spanError = customWindowSpanError(next.fromMs, next.toMs);
    if (spanError) {
      notifySpanBlocked(spanError);
      return;
    }
    setStartTime("00:00");
    setEndTime("00:00");
    onChange(next);
  };

  /** 草稿错误：结束不晚于开始，或跨度超过契约上限（W6 票 16）。只标红字段 + 行内文案。 */
  const draftError = (() => {
    if (!days?.from) return null;
    if (!days.to) return null;
    const fromMs = toMs(days.from, startTime);
    const toMsValue = toMs(days.to, endTime);
    if (toMsValue <= fromMs) return "结束时刻需晚于开始时刻。";
    return customWindowSpanError(fromMs, toMsValue);
  })();

  // 自定义窗起点恰为本周一/本月 1 日 00:00 时，把对应预设按钮点亮（起点锚定，不看易漂移的终点）。
  const weekActive = value.kind === "custom" && value.fromMs === startOfWeekMs();
  const monthActive = value.kind === "custom" && value.fromMs === startOfMonthMs();
  // W9：本周/本月与其它预设一样走 ToggleGroup 单选 chip，不再用两个独立 outline 按钮。
  const presetValue = value.kind === "range"
    ? value.value
    : weekActive
      ? "week"
      : monthActive
        ? "month"
        : "";

  const today = new Date();
  // 日历硬边界（W6 票 16）：超界日期直接禁用，最早可选日由契约上限推导。
  const earliest = new Date(earliestCustomDayMs());

  return (
    <div className={cn("min-w-0", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="md"
            aria-haspopup="dialog"
            aria-label={`时间区间：${timeWindowLabel(value)}`}
            className={cn(
              "max-w-full gap-2 px-3",
              highlighted && "filter-dirty border-warning",
            )}
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 truncate tabular-nums">{timeWindowLabel(value)}</span>
            <ChevronDown
              className={cn("h-3.5 w-3.5 shrink-0 text-faint transition-transform", open && "rotate-180")}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
        {/* W9：align=start——弹层从触发按钮左缘向右展开，不会盖住左侧导航；触发按钮靠近视口
            右缘时 Radix 会按 collisionPadding（12px）自动向左平移，仍在视口内。 */}
        <PopoverContent align="start" sideOffset={8} collisionPadding={12} aria-label="选择时间区间" className="w-auto p-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Calendar
              mode="range"
              selected={days}
              onSelect={chooseDays}
              numberOfMonths={1}
              locale={zhCN}
              startMonth={earliest}
              endMonth={today}
              disabled={{ before: earliest, after: today }}
              className="bg-transparent p-0"
            />
            <div className="flex flex-col gap-2 sm:w-56 sm:border-l sm:border-border sm:pl-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-2xs text-faint">预设区间</span>
                <ToggleGroup
                  type="single"
                  aria-label="预设区间"
                  value={presetValue}
                  onValueChange={(next) => {
                    if (!next) return;
                    if (next === "week" || next === "month") {
                      const fromMs = next === "week" ? startOfWeekMs() : startOfMonthMs();
                      onChange({ kind: "custom", fromMs, toMs: Date.now() });
                      setOpen(false);
                      return;
                    }
                    onChange({ kind: "range", value: next as TimeWindowRange });
                    setOpen(false);
                  }}
                  className="flex-wrap justify-start"
                >
                  {TIME_WINDOW_RANGES.map((option) => (
                    <ToggleGroupItem key={option.value} value={option.value} className={PRESET_CHIP}>
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                  <ToggleGroupItem value="week" className={PRESET_CHIP}>本周</ToggleGroupItem>
                  <ToggleGroupItem value="month" className={PRESET_CHIP}>本月</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="rounded-control border border-border bg-surface-2 p-2">
                <p className="text-2xs text-faint">起止时刻</p>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-7 shrink-0 text-2xs text-faint">开始</span>
                    <Input
                      type="time"
                      aria-label="开始时刻"
                      aria-invalid={draftError !== null}
                      value={startTime}
                      onChange={(event) => chooseTime(event.target.value, endTime)}
                      className={cn("h-8 flex-1 px-2 text-xs", draftError && "border-danger")}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-7 shrink-0 text-2xs text-faint">结束</span>
                    <Input
                      type="time"
                      aria-label="结束时刻"
                      aria-invalid={draftError !== null}
                      value={endTime}
                      onChange={(event) => chooseTime(startTime, event.target.value)}
                      className={cn("h-8 flex-1 px-2 text-xs", draftError && "border-danger")}
                    />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="dense"
                    onClick={pickNow}
                    disabled={!days?.from}
                    title="开始日 00:00 至当前时刻"
                  >
                    此刻
                  </Button>
                  <Button
                    variant="outline"
                    size="dense"
                    onClick={pickMidnight}
                    disabled={!days?.from}
                    title="开始日 00:00 至结束日次日 00:00"
                  >
                    零点
                  </Button>
                </div>
                {draftError && <p className="mt-1.5 text-2xs text-danger-text">{draftError}</p>}
                {!days?.from && (
                  <p className="mt-1.5 text-2xs text-faint">先在日历选择起止日，再用时刻或按钮收窄。</p>
                )}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
