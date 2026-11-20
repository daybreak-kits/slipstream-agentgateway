import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";

import { Field } from "@/components/models/field";
import { MODEL_TYPES, parametersOf, toInt, TYPE_SOURCE_LABELS } from "@/components/models/model-vocab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import type {
  AdoptModelsDevResult,
  ModelParameters,
  ModelParamsSource,
  ModelTypeSource,
  Upstream,
  UpstreamModel,
} from "@/types";

const INPUT_TYPES = ["text", "image", "audio", "video", "file"] as const;
const OUTPUT_TYPES = ["text", "image", "audio", "embedding"] as const;

/** W4-H：兑入结果的键 → 中文标签（toast 逐键可读）。 */
const ADOPT_KEY_LABELS: Record<string, string> = {
  "parameters.max_input_tokens": "最大输入词元",
  "parameters.max_output_tokens": "最大输出词元",
  "parameters.reasoning_level": "推理档位",
  "parameters.input_types": "输入类型",
  "parameters.output_types": "输出类型",
  "parameters.tool_call": "工具调用",
  "parameters.reasoning": "推理",
  "parameters.attachment": "附件",
  "parameters.structured_output": "结构化输出",
  cost_input_per_1m: "输入成本/1M",
  cost_output_per_1m: "输出成本/1M",
};

function adoptSummary(result: AdoptModelsDevResult): { title: string; description: string } {
  const label = (key: string) => ADOPT_KEY_LABELS[key] ?? key;
  const filled = (result.filled ?? []).map(label);
  const skipped = Object.entries(result.results ?? {})
    .filter(([key, status]) => status !== "filled" && !(result.filled ?? []).includes(key))
    .map(([key, status]) =>
      status === "skipped-no-fx" ? label(key) + "（缺美元汇率）" : label(key),
    );
  return {
    title: filled.length > 0 ? `已兑入 ${filled.length} 项` : "没有需要兑入的空键",
    description: [
      filled.length > 0 ? "已填：" + filled.join("、") : "",
      skipped.length > 0 ? "保留手改：" + skipped.join("、") : "",
    ]
      .filter(Boolean)
      .join("；"),
  };
}

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
 * 所属上游 / 模型名 / 类型 / 类型来源 / 能力参数（W4-H 加「从 models.dev 兑入」与来源徽章）/
 * 入出进价与倍率（billing:cost 才可见）/ 启用。
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
  // W4-H：参数块来源徽章（manual / models.dev），随兑入结果与手改实时更新。
  const [paramsSource, setParamsSource] = useState<ModelParamsSource>(
    initial?.params_source === "models.dev" ? "models.dev" : "manual",
  );
  const initialForm = (): UpstreamFormState => ({
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
  const [form, setForm] = useState<UpstreamFormState>(initialForm);
  // W4-A2 弹窗草稿守卫：基线=挂载时刻的表单（编辑态=服务端行，新建态=空白默认）。
  const [baseline, setBaseline] = useState<UpstreamFormState>(initialForm);
  const markupNum = Number(form.markup.trim());
  const markupInvalid = form.markup.trim() !== "" && (!Number.isFinite(markupNum) || markupNum <= 0 || markupNum > 100);
  // 改了任何字段即视为未保存（parameters 整体替换，序列化后比对）。
  const dirty =
    form.upstream_id !== baseline.upstream_id ||
    form.name !== baseline.name ||
    form.model_type !== baseline.model_type ||
    form.model_type_source !== baseline.model_type_source ||
    form.enabled !== baseline.enabled ||
    form.cost_input_per_1m !== baseline.cost_input_per_1m ||
    form.cost_output_per_1m !== baseline.cost_output_per_1m ||
    form.markup !== baseline.markup ||
    JSON.stringify(form.parameters) !== JSON.stringify(baseline.parameters);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
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
  // W4-H：从 models.dev 兑入——只填空键（0/False/默认单模态/未定价），手改永不覆盖；
  // 成功后取回最新行回填表单并更新来源徽章。
  const adopt = useMutation({
    mutationFn: async () => {
      if (initial === null) throw new Error("新模型请先保存后再兑入");
      const result = await api.post<AdoptModelsDevResult>(ENDPOINTS.upstreamModelAdopt(initial.id));
      const page = await apiList<UpstreamModel>(ENDPOINTS.upstreamModels + "?page_size=200");
      const row = page.items.find((item) => item.id === initial.id);
      return { result, row };
    },
    onSuccess: ({ result, row }) => {
      if (!result.matched) {
        toast.warning("未命中 models.dev", { description: "快照里没有与该模型名匹配的条目（不做模糊猜测）" });
        return;
      }
      if (row) {
        const backfill = (prev: UpstreamFormState): UpstreamFormState => ({
          ...prev,
          parameters: parametersOf(row),
          cost_input_per_1m: row.cost_input_per_1m ?? prev.cost_input_per_1m,
          cost_output_per_1m: row.cost_output_per_1m ?? prev.cost_output_per_1m,
        });
        setForm(backfill);
        // 兑入结果已落库：基线随之前移，Esc 不把兑入结果当未保存草稿。
        setBaseline(backfill);
        setParamsSource(row.params_source === "models.dev" ? "models.dev" : "manual");
      }
      const summary = adoptSummary(result);
      if ((result.filled ?? []).length > 0) toast.success(summary.title, { description: summary.description });
      else toast.info(summary.title, { description: summary.description });
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      onSaved?.();
    },
    onError: (e: Error) => toast.error("兑入失败", { description: e.message }),
  });
  const invalid = form.name.trim() === "" || (initial === null && form.upstream_id === "") || markupInvalid;
  const patchParameters = (next: ModelParameters) => {
    // 弹窗内的人工编辑即时摘掉 models.dev 徽章（服务端以实际是否改动为准）。
    setParamsSource("manual");
    setForm({ ...form, parameters: next });
  };
  return (
    <>
    <Dialog open onOpenChange={(v) => { if (!v) requestClose(); }}>
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
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">能力参数</span>
              <Badge tone={paramsSource === "models.dev" ? "info" : "neutral"}>
                {paramsSource === "models.dev" ? "来源 models.dev" : "来源 手动"}
              </Badge>
              {initial !== null ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-7 px-2 text-2xs"
                  disabled={adopt.isPending}
                  onClick={() => adopt.mutate()}
                >
                  {adopt.isPending ? "兑入中…" : "从 models.dev 兑入"}
                </Button>
              ) : null}
            </div>
            <p className="text-2xs text-faint">旧系统 channel_models.parameters：两态布尔全量写入，0 表示未声明；兑入只填空键，手改值永不覆盖。</p>
            <ParameterFields value={form.parameters} onChange={patchParameters} />
          </div>
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
          <Button variant="outline" onClick={requestClose}>取消</Button>
          <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmDiscard ? (
      <ConfirmDialog
        open
        onOpenChange={(v) => { if (!v) setConfirmDiscard(false); }}
        title="放弃修改？"
        description="弹窗内已改的模型字段（含能力参数与价格）不会写入，关闭后将丢失。"
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
