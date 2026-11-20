import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock, Check, Snowflake } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field } from "@/components/models/field";
import {
  buildScheduleJson, COOLDOWN_PRESETS, DEFAULT_COOLDOWN_HOURS, ruleSummary, WEEKDAY_OPTIONS,
} from "@/components/models/availability";
import type { CooldownModeState } from "@/components/models/cooldown-state";
import { formatDateTime, useTimezone } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { AvailabilityRule, CooldownRecurrence } from "@/types";

export type CooldownMode = "single" | "periodic";

const MODE_META: Record<CooldownMode, { label: string; hint: string; Icon: typeof Snowflake }> = {
  single: {
    label: "单次冷却",
    hint: "设一个截止时间，到期自动恢复；生效期间不能建或改周期冷却",
    Icon: Snowflake,
  },
  periodic: {
    label: "周期冷却",
    hint: "按天/周/月的固定窗口循环；窗口内退出路由，结束后自动恢复",
    Icon: CalendarClock,
  },
};

export interface CooldownControlPanelProps {
  /** cooldownModeState 的派生结果（互斥/截止/阻塞说明）。 */
  state: CooldownModeState;
  mode: CooldownMode;
  onModeChange: (mode: CooldownMode) => void;
  /** 当前模式的表单内容（由抽屉注入：单次/周期冷却字段）。 */
  singleForm: ReactNode;
  periodicForm: ReactNode;
  /** 冷却写操作进行中：解除入口禁用。 */
  pending?: boolean;
  onRelease: () => void;
  /** 缺 availability:read：无法预判互斥，交给后端 409 兜底。 */
  rulesUnavailable?: boolean;
}

/**
 * 抽屉「状态与冷却」区的双模式控制面板（ticket 11）。
 *
 * - 互斥：单次生效 → 周期模式禁用；周期窗口生效 → 单次模式禁用；说明含阻塞规则与窗口结束时间；
 * - 冷却中始终只给一个「解除」（不出现两个解除入口，ticket 02 语义）；
 * - 选中态=边框主色 + 主色浅底 + 勾选图标（不只靠颜色）；未选中走中性描边。
 * 纯展示组件：数据与动作都由抽屉注入，可直接 SSR 断言。
 */
export function CooldownControlPanel({
  state, mode, onModeChange, singleForm, periodicForm, pending = false, onRelease, rulesUnavailable = false,
}: CooldownControlPanelProps) {
  const conflict = state.blockedSingle || state.blockedPeriodic;
  return (
    <section data-slot="cooldown-panel" aria-label="冷却控制" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-title">冷却控制</span>
          <Badge tone={state.cooling ? "warning" : "neutral"}>
            {state.cooling ? "冷却中" : "无冷却"}
          </Badge>
        </span>
        {state.releaseVisible ? (
          <ActionButton
            action="releaseCooldown"
            data-slot="cooldown-release"
            variant="outline"
            size="sm"
            disabled={pending}
            title="解除冷却：单次规则删除；若命中周期窗口则只跳过本窗口（周期规则保留）"
            onClick={onRelease}
          >
            解除
          </ActionButton>
        ) : null}
      </div>
      {rulesUnavailable ? (
        <p data-slot="cooldown-rules-hint" className="text-2xs text-faint">
          当前账号缺少 availability:read，无法预判冷却规则；若与已有冷却互斥，提交时会返回 409 并给出阻塞规则与窗口结束时间。
        </p>
      ) : null}
      {/* 模式卡用 ToggleGroup type="single" 承担单选语义（aria-pressed/data-state 由原语提供），
          视觉保持与手写卡一致：选中=主色边框+浅底+勾选图标，禁用=降透明+不可用徽标。 */}
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(next) => {
          if (next) onModeChange(next as CooldownMode);
        }}
        aria-label="冷却模式"
        className="grid gap-2 sm:grid-cols-2"
      >
        {(Object.keys(MODE_META) as CooldownMode[]).map((value) => {
          const meta = MODE_META[value];
          const Icon = meta.Icon;
          const selected = mode === value;
          const disabled = value === "single" ? state.blockedSingle : state.blockedPeriodic;
          const reason = value === "single" ? state.singleBlockReason : state.periodicBlockReason;
          return (
            <ToggleGroupItem
              key={value}
              value={value}
              data-mode={value}
              data-selected={selected ? "true" : "false"}
              disabled={disabled}
              className={cn(
                "flex h-auto flex-col items-start gap-1 rounded-control border px-3 py-2 text-left text-2xs font-normal transition-colors",
                "data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:ring-1 data-[state=on]:ring-primary",
                "data-[state=off]:border-border data-[state=off]:bg-surface data-[state=off]:hover:bg-surface-2",
                disabled && "cursor-not-allowed opacity-70",
              )}
            >
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-title">
                <Icon aria-hidden="true" className="h-4 w-4 text-body" />
                {meta.label}
                {selected && !disabled ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-success-text" /> : null}
                {disabled ? <Badge tone="warning">不可用</Badge> : null}
              </span>
              <span className="text-2xs text-faint">{disabled ? reason : meta.hint}</span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      {conflict ? (
        <Alert variant="warning" data-slot="cooldown-conflict">
          <AlertTitle>冷却模式互斥</AlertTitle>
          <AlertDescription>
            {state.blockedSingle ? state.singleBlockReason : null}
            {state.blockedPeriodic ? state.periodicBlockReason : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="rounded-md border border-border bg-surface-2/40 p-3">
        {mode === "single" ? (state.blockedSingle ? null : singleForm) : null}
        {mode === "periodic" ? (state.blockedPeriodic ? null : periodicForm) : null}
        {conflict ? (
          <p className="text-2xs text-faint">先点上方「解除」清掉当前冷却，再设置新的冷却模式。</p>
        ) : null}
      </div>
    </section>
  );
}

/** 单次冷却表单：6 档时长预设 + 自定义截止 + 原因（提交由抽屉注入）。 */
export function SingleCooldownFields({
  pending, onSubmit, onDirtyChange,
}: {
  pending: boolean;
  onSubmit: (deadline: number, note: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { mode: timezone } = useTimezone();
  const [preset, setPreset] = useState<number | null>(DEFAULT_COOLDOWN_HOURS);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const deadline = preset === null
    ? (custom ? new Date(custom).getTime() : 0)
    : Date.now() + (preset ?? 0) * 3_600_000;
  const invalid = !Number.isFinite(deadline) || deadline <= Date.now();
  // 草稿守卫只看自由输入（自定义时刻/原因）：预设一键可恢复，不当作未保存草稿。
  const dirty = custom !== "" || note !== "";
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  return (
    <div className="space-y-3">
      <Field label="时长">
        <div className="flex flex-wrap gap-1.5">
          {COOLDOWN_PRESETS.map((item) => (
            <Button
              key={item.label}
              type="button"
              variant={preset === item.hours ? "secondary" : "outline"}
              size="sm"
              aria-pressed={preset === item.hours}
              onClick={() => setPreset(item.hours)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </Field>
      {preset === null ? (
        <Field label="冷却截止时间" hint={invalid && custom !== "" ? "必须是将来时间" : "到期后路由自动恢复"}>
          <Input type="datetime-local" value={custom} onChange={(event) => setCustom(event.target.value)} />
        </Field>
      ) : null}
      <p className="text-2xs text-faint">
        {invalid && preset === null && custom !== ""
          ? "到期时刻：请选择将来的时间"
          : "到期时刻：" + (invalid ? "—" : formatDateTime(deadline, timezone)) + "（到期后自动恢复，无需排期）"}
      </p>
      <Field label="原因" hint="选填，写入冷却规则备注，供其他管理用户查看">
        <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="如：上游厂商例行维护" />
      </Field>
      <div className="flex items-center justify-end">
        <ActionButton
          action="cooldown"
          variant="outline"
          disabled={invalid || pending}
          onClick={() => onSubmit(deadline, note)}
        >
          {pending ? "设置中…" : "设置冷却"}
        </ActionButton>
      </div>
    </div>
  );
}

export interface PeriodicCooldownInput {
  recurrence: Exclude<CooldownRecurrence, "once">;
  schedule_json: string;
  note: string;
}

/** 周期冷却紧凑编辑（重复方式 + 时间窗 + 备注；完整排期日历不做，ADR-004 规则表存储）。
 *  已有周期规则在表单内列出并给「删除规则」（需抽屉层确认），互斥提示由上层面板负责。 */
export function PeriodicCooldownFields({
  scope, scopeId, rules, pending, onSubmit, onRemoveRule, onDirtyChange,
}: {
  scope: string;
  scopeId: string;
  rules: AvailabilityRule[];
  pending: boolean;
  onSubmit: (input: PeriodicCooldownInput) => void;
  onRemoveRule: (ruleId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [recurrence, setRecurrence] = useState<Exclude<CooldownRecurrence, "once">>("daily");
  const [start, setStart] = useState("02:00");
  const [end, setEnd] = useState("04:00");
  const [days, setDays] = useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [note, setNote] = useState("");
  const existing = rules.filter(
    (rule) => rule.kind === "cooldown" && rule.scope === scope && rule.scope_id === scopeId && rule.recurrence !== "once",
  );
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const monthDay = Number(dayOfMonth);
  const invalid =
    !timePattern.test(start) ||
    !timePattern.test(end) ||
    (recurrence === "weekly" && days.length === 0) ||
    (recurrence === "monthly" && (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31));
  // 守卫口径与 useState 初值一致：改了任何默认项即视为草稿。
  const dirty =
    recurrence !== "daily" ||
    start !== "02:00" ||
    end !== "04:00" ||
    days.length !== 1 || !days.includes(1) ||
    dayOfMonth !== "1" ||
    note !== "";
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const toggleDay = (value: number) => {
    setDays((current) => (current.includes(value) ? current.filter((day) => day !== value) : [...current, value].sort((a, b) => a - b)));
  };
  return (
    <div className="space-y-3">
      <p className="text-2xs text-faint">
        周期冷却按 ADR-004 的时间窗循环生效：窗口内该对象退出路由，窗口结束自动恢复，不需要人工解除。
        单次冷却与周期冷却互斥：单次生效期间不能新增或改期周期规则；周期窗口生效期间也不能设置单次冷却。
      </p>
      {existing.length > 0 ? (
        <div className="space-y-1 rounded-md border border-border bg-surface p-2">
          <div className="text-2xs font-medium text-body">已有周期冷却</div>
          {existing.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 text-2xs">
              <span className="text-title">{ruleSummary(rule)}</span>
              <ActionButton
                action="delete"
                size="dense"
                disabled={pending}
                title="删除该周期规则（需要确认；清掉本条排期）"
                onClick={() => onRemoveRule(rule.id)}
              >
                删除规则
              </ActionButton>
            </div>
          ))}
        </div>
      ) : null}
      <Field label="重复方式" hint="单次冷却请切到「单次冷却」模式；这里设置按天/周/月循环的窗口">
        <Select value={recurrence} onValueChange={(value) => setRecurrence(value as Exclude<CooldownRecurrence, "once">)}>
          <SelectTrigger aria-label="周期冷却重复方式"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">每天</SelectItem>
            <SelectItem value="weekly">每周</SelectItem>
            <SelectItem value="monthly">每月</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="开始时间" hint="HH:MM"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="结束时间" hint="跨午夜会自动顺延；开始=结束表示全天"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      {recurrence === "weekly" ? (
        <Field label="生效星期" hint="按 ISO 周一到周日">
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-1 text-2xs text-body">
                <Checkbox checked={days.includes(option.value)} onCheckedChange={() => toggleDay(option.value)} />
                {option.label}
              </label>
            ))}
          </div>
        </Field>
      ) : null}
      {recurrence === "monthly" ? (
        <Field label="生效日期" hint="每月第几天，1–31">
          <Input type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
        </Field>
      ) : null}
      <Field label="备注" hint="可选，写入规则表"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：每日凌晨例行维护" /></Field>
      <div className="flex items-center justify-end">
        <ActionButton
          action="cooldown"
          variant="outline"
          disabled={invalid || pending}
          onClick={() => onSubmit({
            recurrence,
            schedule_json: buildScheduleJson(recurrence, start, end, days, monthDay),
            note,
          })}
        >
          {pending ? "设置中…" : "设置周期冷却"}
        </ActionButton>
      </div>
    </div>
  );
}
