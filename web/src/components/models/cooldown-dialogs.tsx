import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  COOLDOWN_PRESETS, DEFAULT_COOLDOWN_MINUTES, WEEKDAY_OPTIONS, buildScheduleJson, ruleSummary,
} from "@/components/models/availability";
import { api, ENDPOINTS } from "@/lib/api";
import type { AvailabilityRule, CooldownRecurrence } from "@/types";

/** 弹窗表单字段：标签 + 控件 + 可选说明（models 各编辑弹窗共用）。 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-2xs text-faint">{hint}</p> : null}
    </div>
  );
}

/** 一次性冷却：时长快捷档 / 自定义截止 + 选填原因（原因写入规则表备注）。 */
export function CooldownDialog({
  title, pending, onConfirm, onClose,
}: {
  title: string; pending: boolean;
  onConfirm: (deadline: number, note: string) => void; onClose: () => void;
}) {
  const [preset, setPreset] = useState<number | null>(DEFAULT_COOLDOWN_MINUTES);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const deadline = preset === null
    ? (custom ? new Date(custom).getTime() : 0)
    : Date.now() + (preset ?? 0) * 60_000;
  const invalid = !Number.isFinite(deadline) || deadline <= Date.now();
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-2xs text-faint">
          冷却到期后自动恢复（读取时自愈），无需排期。关闭才是人工长期措施；启用会同时清掉冷却。
        </p>
        <Field label="时长">
          <Select
            value={preset === null ? "custom" : String(preset)}
            onValueChange={(value) => setPreset(value === "custom" ? null : Number(value))}
          >
            <SelectTrigger aria-label="冷却时长"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COOLDOWN_PRESETS.map((item) => (
                <SelectItem key={item.label} value={item.minutes === null ? "custom" : String(item.minutes)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {preset === null ? (
          <Field label="冷却截止时间" hint={invalid && custom !== "" ? "必须是将来时间" : "到期后路由自动恢复"}>
            <Input type="datetime-local" value={custom} onChange={(event) => setCustom(event.target.value)} />
          </Field>
        ) : null}
        <Field label="原因" hint="选填，写入冷却规则备注，供其他管理员查看">
          <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="如：上游厂商例行维护" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={invalid || pending} onClick={() => onConfirm(deadline, note)}>
            {pending ? "设置中…" : "设置冷却"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 周期冷却紧凑编辑：重复方式 + 时间窗（完整排期日历不做，按 ADR-004 规则表存储）。 */
export function PeriodicCooldownDialog({
  title, scope, scopeId, rules, onClose,
}: {
  title: string;
  scope: string;
  scopeId: string;
  rules: AvailabilityRule[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
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
    onError: (e: Error) => toast.error("设置失败", { description: e.message }),
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
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-2xs text-faint">
          周期冷却按 ADR-004 的时间窗循环生效：窗口内该对象退出路由，窗口结束自动恢复，不需要人工解除。
          单次冷却与周期冷却可并存；启用/解除会清掉该对象的周期规则。
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
        <Field label="重复方式" hint="单次冷却请用「冷却」操作；这里设置按天/周/月循环的窗口">
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={invalid || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "设置中…" : "设置周期冷却"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
