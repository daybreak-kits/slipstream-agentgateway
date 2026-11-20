import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";

import { conflictDescription, isCooling, availabilityText } from "@/components/models/availability";
import { Field } from "@/components/models/field";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import {
  COOLDOWN_PRESETS, DEFAULT_COOLDOWN_HOURS, WEEKDAY_OPTIONS, buildScheduleJson, ruleSummary,
} from "@/components/models/availability";
import { api, ENDPOINTS } from "@/lib/api";
import { formatDateTime, useTimezone } from "@/lib/time";
import type { AvailabilityRule, CooldownRecurrence, ModelAvailability } from "@/types";

/**
 * 单次冷却表单（弹窗 Tab1，ADR-025 双模式）：1/3/6/12/24/72 小时预设点选，
 * 选中即时显示到期时刻（按 lib/time 的时区语义）；可选自定义截止与原因备注。
 */
function SingleCooldownForm({
  pending, onConfirm, onDirtyChange,
}: {
  pending: boolean;
  onConfirm: (deadline: number, note: string) => void;
  /** 弹窗草稿守卫（W4-A2）：自由输入变化时上报给弹窗层 */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { mode: timezone } = useTimezone();
  const [preset, setPreset] = useState<number | null>(DEFAULT_COOLDOWN_HOURS);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const deadline = preset === null
    ? (custom ? new Date(custom).getTime() : 0)
    : Date.now() + (preset ?? 0) * 3_600_000;
  const invalid = !Number.isFinite(deadline) || deadline <= Date.now();
  // 守卫只看自由输入（自定义时刻/原因）：预设点选一键可恢复，不当作草稿。
  const dirty = custom !== "" || note !== "";
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
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
      <div className="flex items-center justify-end gap-2">
        <Button disabled={invalid || pending} onClick={() => onConfirm(deadline, note)}>
          {pending ? "设置中…" : "设置冷却"}
        </Button>
      </div>
    </div>
  );
}

/** 周期冷却紧凑编辑（弹窗 Tab2）：重复方式 + 时间窗 + IANA 时区解释（完整排期日历不做，按 ADR-004 规则表存储）。 */
function PeriodicCooldownForm({
  scope, scopeId, rules, onClose, onDirtyChange,
}: {
  scope: string;
  scopeId: string;
  rules: AvailabilityRule[];
  onClose: () => void;
  /** 弹窗草稿守卫（W4-A2）：改了任何默认项时上报给弹窗层 */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const { mode: timezone } = useTimezone();
  const [recurrence, setRecurrence] = useState<Exclude<CooldownRecurrence, "once">>("daily");
  const [start, setStart] = useState("02:00");
  const [end, setEnd] = useState("04:00");
  const [days, setDays] = useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [note, setNote] = useState("");
  const existing = rules.filter((rule) => rule.kind === "cooldown" && rule.recurrence !== "once");
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const monthDay = Number(dayOfMonth);
  const invalid =
    !timePattern.test(start) ||
    !timePattern.test(end) ||
    (recurrence === "weekly" && days.length === 0) ||
    (recurrence === "monthly" && (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31));
  // 守卫口径与上方 useState 初值一致：改了任何默认项（重复方式/时间窗/星期/日期/备注）即视为草稿。
  const dirty =
    recurrence !== "daily" ||
    start !== "02:00" ||
    end !== "04:00" ||
    days.length !== 1 || !days.includes(1) ||
    dayOfMonth !== "1" ||
    note !== "";
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["availability-rules"] });
    void qc.invalidateQueries({ queryKey: ["upstream-models"] });
    void qc.invalidateQueries({ queryKey: ["public-models"] });
  };
  const create = useMutation({
    mutationFn: () =>
      api.post<AvailabilityRule>(ENDPOINTS.availabilityRules, {
        kind: "cooldown",
        scope,
        scope_id: scopeId,
        recurrence,
        schedule_json: buildScheduleJson(recurrence, start, end, days, monthDay),
        note,
      }),
    onSuccess: () => {
      toast.success("周期冷却已设置");
      refresh();
      onClose();
    },
    onError: (e: Error) => toast.error("设置失败", { description: conflictDescription(e, timezone) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del<void>(ENDPOINTS.availabilityRule(id)),
    onSuccess: () => {
      toast.success("周期冷却已解除");
      refresh();
    },
    onError: (e: Error) => toast.error("解除失败", { description: e.message }),
  });
  const toggleDay = (value: number) => {
    setDays((current) => (current.includes(value) ? current.filter((d) => d !== value) : [...current, value].sort((a, b) => a - b)));
  };
  return (
    <div className="space-y-3">
      <p className="text-2xs text-faint">
        周期冷却按 ADR-004 的时间窗循环生效：窗口内该对象退出路由，窗口结束自动恢复，不需要人工解除。
        单次冷却与周期冷却互斥：单次生效期间不能新增或改期周期规则；周期窗口生效期间也不能设置单次冷却
        （窗口内可先点「解除」，只跳过本窗口，周期规则保留）。
      </p>
      {existing.length > 0 ? (
        <div className="space-y-1 rounded-md border border-border bg-surface-2 p-2">
          <div className="text-2xs font-medium text-body">已有周期冷却</div>
          {existing.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between gap-2 text-2xs">
              <span className="text-title">{ruleSummary(rule)}</span>
              <Button variant="ghost" size="sm" className="text-danger-text" disabled={remove.isPending} onClick={() => remove.mutate(rule.id)}>解除</Button>
            </div>
          ))}
        </div>
      ) : null}
      <Field label="重复方式" hint="单次冷却请切到「单次冷却」页签；这里设置按天/周/月循环的窗口">
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
      <div className="flex items-center justify-end gap-2">
        <Button disabled={invalid || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "设置中…" : "设置周期冷却"}</Button>
      </div>
    </div>
  );
}

/**
 * 冷却双模式弹窗（W4-C，ADR-025）：「冷却」「周期」两入口合一。
 * 顶部显示当前状态；冷却中提供单个「解除」（ticket 02）；页签切换单次冷却 / 周期冷却。
 * 仅上游模型可用（公开模型没有冷却概念，GLOSSARY §3）。
 */
export function CooldownManageDialog({
  title, row, scope, scopeId, rules, pending, onCooldown, onRelease, onClose,
}: {
  title: string;
  row: { enabled: boolean; cooldown_until_ms?: number; availability?: ModelAvailability };
  scope: string;
  scopeId: string;
  rules: AvailabilityRule[];
  pending: boolean;
  onCooldown: (deadline: number, note: string) => void;
  onRelease: () => void;
  onClose: () => void;
}) {
  const cooling = isCooling(row);
  // W4-A2 弹窗草稿守卫：任一页签表单改了内容后，Esc/遮罩/取消先确认「放弃修改？」。
  const [formDirty, setFormDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const handleFormDirty = useCallback((next: boolean) => setFormDirty(next), []);
  const requestClose = () => {
    if (formDirty) setConfirmDiscard(true);
    else onClose();
  };
  return (
    <>
    <Dialog open onOpenChange={(v) => { if (!v) requestClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5">
          <span className="flex items-center gap-2 text-2sm">
            当前状态
            <Badge tone={cooling ? "warning" : row.enabled ? "success" : "warning"}>{availabilityText(row)}</Badge>
          </span>
          {cooling ? (
            <ActionButton
              action="releaseCooldown"
              variant="outline"
              disabled={pending}
              title="解除单次冷却；若正处周期窗口则只跳过本窗口，周期规则保留"
              onClick={onRelease}
            >
              解除
            </ActionButton>
          ) : null}
        </div>
        <Tabs
          items={[
            {
              key: "single",
              label: "单次冷却",
              content: <SingleCooldownForm pending={pending} onConfirm={onCooldown} onDirtyChange={handleFormDirty} />,
            },
            {
              key: "periodic",
              label: "周期冷却",
              content: <PeriodicCooldownForm scope={scope} scopeId={scopeId} rules={rules} onClose={onClose} onDirtyChange={handleFormDirty} />,
            },
          ]}
        />
      </DialogContent>
    </Dialog>
    {confirmDiscard ? (
      <ConfirmDialog
        open
        onOpenChange={(v) => { if (!v) setConfirmDiscard(false); }}
        title="放弃修改？"
        description="弹窗内已填的冷却草稿（自定义时刻、原因、周期窗口）不会写入，关闭后将丢失。"
        confirmLabel="放弃修改"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    ) : null}
    </>
  );
}
