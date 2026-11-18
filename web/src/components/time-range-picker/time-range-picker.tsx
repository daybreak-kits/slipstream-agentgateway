import { zhCN } from "date-fns/locale";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import {
  TIME_WINDOW_RANGES,
  dayStartMs,
  nextDayStartMs,
  startOfMonthMs,
  startOfWeekMs,
  timeWindowLabel,
  type TimeWindow,
  type TimeWindowRange,
} from "./window";

/** 日历可回看的天数：与后端自定义窗上限（366 天）对齐。 */
const LOOKBACK_DAYS = 365;
const DEFAULT_START_TIME = "00:00";
const DEFAULT_END_TIME = "23:59";

const PRESET_CHIP =
  "h-7 rounded-control px-2 text-2xs text-body data-[state=on]:bg-primary-soft data-[state=on]:text-primary";

export interface TimeRangePickerProps {
  value: TimeWindow;
  onChange: (next: TimeWindow) => void;
  className?: string;
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
export function TimeRangePicker({ value, onChange, className }: TimeRangePickerProps) {
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

  /** 起止齐且结束晚于开始才上抛；否则保留上一次生效区间。 */
  const publish = (nextDays: DateRange | undefined, nextStart: string, nextEnd: string) => {
    if (!nextDays?.from || !nextDays.to || !nextStart || !nextEnd) return;
    const fromMs = toMs(nextDays.from, nextStart);
    const toMsValue = toMs(nextDays.to, nextEnd);
    if (toMsValue > fromMs) onChange({ kind: "custom", fromMs, toMs: toMsValue });
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
    setStartTime("00:00");
    setEndTime(msToTime(now));
    onChange({ kind: "custom", fromMs: dayStartMs(days.from), toMs: now });
  };

  /** 「零点」：开始日 00:00 → 结束日次日 00:00（未选结束日时按开始日）。 */
  const pickMidnight = () => {
    if (!days?.from) return;
    const endDay = days.to ?? days.from;
    setStartTime("00:00");
    setEndTime("00:00");
    onChange({
      kind: "custom",
      fromMs: dayStartMs(days.from),
      toMs: nextDayStartMs(endDay),
    });
  };

  const draftInvalid = (() => {
    if (!days?.from) return false;
    if (!days.to) return false;
    const fromMs = toMs(days.from, startTime);
    const toMsValue = toMs(days.to, endTime);
    return toMsValue <= fromMs;
  })();

  // 自定义窗起点恰为本周一/本月 1 日 00:00 时，把对应预设按钮点亮（起点锚定，不看易漂移的终点）。
  const weekActive = value.kind === "custom" && value.fromMs === startOfWeekMs();
  const monthActive = value.kind === "custom" && value.fromMs === startOfMonthMs();

  const today = new Date();
  const earliest = new Date(today);
  earliest.setDate(earliest.getDate() - LOOKBACK_DAYS);

  return (
    <div className={cn("min-w-0", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="md"
            aria-haspopup="dialog"
            aria-label={`时间区间：${timeWindowLabel(value)}`}
            className="max-w-full gap-2 px-3"
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
        <PopoverContent align="end" sideOffset={8} aria-label="选择时间区间" className="w-auto p-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Calendar
              mode="range"
              selected={days}
              onSelect={chooseDays}
              numberOfMonths={1}
              locale={zhCN}
              startMonth={earliest}
              endMonth={today}
              disabled={{ after: today }}
              className="bg-transparent p-0"
            />
            <div className="flex flex-col gap-2 sm:w-56 sm:border-l sm:border-border sm:pl-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-2xs text-faint">预设区间</span>
                <ToggleGroup
                  type="single"
                  aria-label="预设区间"
                  value={value.kind === "range" ? value.value : ""}
                  onValueChange={(next) => {
                    if (!next) return;
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
                </ToggleGroup>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="dense"
                    className={cn(weekActive && "border-primary/70 text-primary")}
                    onClick={() => {
                      onChange({ kind: "custom", fromMs: startOfWeekMs(), toMs: Date.now() });
                      setOpen(false);
                    }}
                  >
                    本周
                  </Button>
                  <Button
                    variant="outline"
                    size="dense"
                    className={cn(monthActive && "border-primary/70 text-primary")}
                    onClick={() => {
                      onChange({ kind: "custom", fromMs: startOfMonthMs(), toMs: Date.now() });
                      setOpen(false);
                    }}
                  >
                    本月
                  </Button>
                </div>
              </div>

              <div className="rounded-control border border-border bg-surface-2 p-2">
                <p className="text-2xs text-faint">起止时刻</p>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-7 shrink-0 text-2xs text-faint">开始</span>
                    <Input
                      type="time"
                      aria-label="开始时刻"
                      value={startTime}
                      onChange={(event) => chooseTime(event.target.value, endTime)}
                      className="h-8 flex-1 px-2 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-7 shrink-0 text-2xs text-faint">结束</span>
                    <Input
                      type="time"
                      aria-label="结束时刻"
                      value={endTime}
                      onChange={(event) => chooseTime(startTime, event.target.value)}
                      className="h-8 flex-1 px-2 text-xs"
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
                {draftInvalid && (
                  <p className="mt-1.5 text-2xs text-danger-text">结束时刻需晚于开始时刻。</p>
                )}
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
