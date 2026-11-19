import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Field } from "@/components/models/field";
import { MODEL_TYPES, parametersOf, toInt, TYPE_SOURCE_LABELS } from "@/components/models/model-vocab";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ENDPOINTS } from "@/lib/api";
import type { ModelParameters, ModelTypeSource, Upstream, UpstreamModel } from "@/types";

const INPUT_TYPES = ["text", "image", "audio", "video", "file"] as const;
const OUTPUT_TYPES = ["text", "image", "audio", "embedding"] as const;

/** 能力参数编辑块（旧系统 channel_models.parameters：两态布尔全量写入，0 表示未声明）。 */
function ParameterFields({ value, onChange }: { value: ModelParameters; onChange: (next: ModelParameters) => void }) {
  const toggle = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="最大输入词元" hint="0 = 未声明">
          <Input inputMode="numeric" value={String(value.max_input_tokens)} onChange={(e) => onChange({ ...value, max_input_tokens: toInt(e.target.value) })} />
        </Field>
        <Field label="最大输出词元" hint="0 = 未声明">
          <Input inputMode="numeric" value={String(value.max_output_tokens)} onChange={(e) => onChange({ ...value, max_output_tokens: toInt(e.target.value) })} />
        </Field>
      </div>
      <Field label="推理档位" hint="如 low / medium / high，留空表示不声明">
        <Input value={value.reasoning_level} onChange={(e) => onChange({ ...value, reasoning_level: e.target.value })} placeholder="留空 = 不声明" />
      </Field>
      <Field label="输入类型" hint="至少选择 1 个">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {INPUT_TYPES.map((item) => (
            <label key={item} className="flex items-center gap-1.5 text-2sm text-body">
              <Checkbox
                checked={value.input_types.includes(item)}
                onCheckedChange={() => onChange({ ...value, input_types: toggle(value.input_types, item) })}
              />
              {item}
            </label>
          ))}
        </div>
      </Field>
      <Field label="输出类型" hint="至少选择 1 个">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {OUTPUT_TYPES.map((item) => (
            <label key={item} className="flex items-center gap-1.5 text-2sm text-body">
              <Checkbox
                checked={value.output_types.includes(item)}
                onCheckedChange={() => onChange({ ...value, output_types: toggle(value.output_types, item) })}
              />
              {item}
            </label>
          ))}
        </div>
      </Field>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {([
          ["tool_call", "工具调用"],
          ["reasoning", "推理"],
          ["attachment", "附件"],
          ["structured_output", "结构化输出"],
        ] as Array<[keyof ModelParameters, string]>).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 text-2sm text-body">
            <Checkbox
              checked={value[key] === true}
              onCheckedChange={(checked) => onChange({ ...value, [key]: checked === true })}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

interface UpstreamFormState {
  upstream_id: string;
  name: string;
  model_type: string;
  model_type_source: ModelTypeSource;
  parameters: ModelParameters;
  enabled: boolean;
  cost_input_per_1m: string;
  cost_output_per_1m: string;
  markup: string;
}

/**
 * 上游模型编辑弹窗（W4-C 归一：模型管理页与上游详情页共用同一实现，字段全集）：
 * 所属上游 / 模型名 / 类型 / 类型来源 / 能力参数 / 入出进价与倍率（billing:cost 才可见）/ 启用。
 * 成功后统一失效 ["upstream-models"]；调用方还有页面专属缓存要失效时用 onSaved。
 */
export function UpstreamModelDialog({
  initial, upstreams, canCost, onClose, onSaved,
}: {
  initial: UpstreamModel | null;
  /** 只用到 id/name（上游详情页的 UpstreamRow 也能直接传入）。 */
  upstreams: Array<Pick<Upstream, "id" | "name">>;
  canCost: boolean; onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<UpstreamFormState>({
    upstream_id: initial?.upstream_id ?? (upstreams[0]?.id ?? ""),
    name: initial?.name ?? "",
    model_type: initial?.model_type ?? "chat",
    model_type_source: initial?.model_type_source ?? "default",
    parameters: parametersOf(initial ?? {}),
    enabled: initial?.enabled ?? true,
    cost_input_per_1m: initial?.cost_input_per_1m ?? "",
    cost_output_per_1m: initial?.cost_output_per_1m ?? "",
    markup: initial?.markup ?? "1.0000",
  });
  const markupNum = Number(form.markup.trim());
  const markupInvalid = form.markup.trim() !== "" && (!Number.isFinite(markupNum) || markupNum <= 0 || markupNum > 100);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        model_type: form.model_type,
        model_type_source: form.model_type_source,
        parameters: form.parameters,
        enabled: form.enabled,
      };
      if (canCost) {
        body.cost_input_per_1m = form.cost_input_per_1m.trim() === "" ? null : form.cost_input_per_1m.trim();
        body.cost_output_per_1m = form.cost_output_per_1m.trim() === "" ? null : form.cost_output_per_1m.trim();
        if (initial === null || form.markup.trim() !== "") body.markup = form.markup.trim();
      }
      if (initial !== null) return api.patch<UpstreamModel>(ENDPOINTS.upstreamModelUpdate(initial.id), body);
      body.upstream_id = form.upstream_id;
      return api.post<UpstreamModel>(ENDPOINTS.upstreamModelCreate, body);
    },
    onSuccess: () => {
      toast.success(initial !== null ? "上游模型已更新" : "上游模型已登记");
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      onSaved?.();
      onClose();
    },
    onError: (e: Error) => toast.error("保存失败", { description: e.message }),
  });
  const invalid = form.name.trim() === "" || (initial === null && form.upstream_id === "") || markupInvalid;
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial !== null ? "编辑上游模型" : "登记上游模型"}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            <Field label="所属上游">
              <Select value={form.upstream_id} disabled={initial !== null} onValueChange={(v) => setForm({ ...form, upstream_id: v })}>
                <SelectTrigger><SelectValue placeholder="选择上游" /></SelectTrigger>
                <SelectContent>
                  {upstreams.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="模型名">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 glm-5.3" className="font-mono" />
            </Field>
            <Field label="类型">
              <Select value={form.model_type} onValueChange={(v) => setForm({ ...form, model_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODEL_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="类型来源" hint="旧系统 default / upstream / manual">
              <Select value={form.model_type_source} onValueChange={(v) => setForm({ ...form, model_type_source: v as ModelTypeSource })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_SOURCE_LABELS) as ModelTypeSource[]).map((key) => (
                    <SelectItem key={key} value={key}>{TYPE_SOURCE_LABELS[key]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="能力参数" hint="旧系统 channel_models.parameters：两态布尔全量写入，0 表示未声明">
            <ParameterFields value={form.parameters} onChange={(next) => setForm({ ...form, parameters: next })} />
          </Field>
          {canCost ? (
            <div className="grid grid-cols-3 gap-2 rounded-md border border-border p-2">
              <Field label="输入成本 / 1M" hint="元，留空 = 未定价">
                <Input value={form.cost_input_per_1m} onChange={(e) => setForm({ ...form, cost_input_per_1m: e.target.value })} placeholder="如 2.0000" className="tnum" />
              </Field>
              <Field label="输出成本 / 1M" hint="元，留空 = 未定价">
                <Input value={form.cost_output_per_1m} onChange={(e) => setForm({ ...form, cost_output_per_1m: e.target.value })} placeholder="如 8.0000" className="tnum" />
              </Field>
              <Field label="倍率" hint={markupInvalid ? "必须是 (0, 100] 的数字" : "如 1.2000 = 1.2 倍"}>
                <Input value={form.markup} onChange={(e) => setForm({ ...form, markup: e.target.value })} placeholder="1.0000" className="tnum" />
              </Field>
            </div>
          ) : (
            <p className="text-2xs text-faint">成本与倍率需要 billing:cost 权限；当前账号不可见也不可改。</p>
          )}
          <label className="flex items-center gap-2 text-2sm text-body">
            <Checkbox checked={form.enabled} onCheckedChange={(checked) => setForm({ ...form, enabled: checked === true })} />
            启用（关闭是人工长期措施；启用会同时清掉冷却）
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
