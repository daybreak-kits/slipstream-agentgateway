import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";

import {
  availabilityText, availabilityTone, conflictDescription, useAvailabilityMutation, useAvailabilityRulesQuery,
} from "@/components/models/availability";
import {
  CooldownControlPanel, PeriodicCooldownFields, SingleCooldownFields,
  type CooldownMode, type PeriodicCooldownInput,
} from "@/components/models/cooldown-panel";
import { cooldownModeState } from "@/components/models/cooldown-state";
import { Field } from "@/components/models/field";
import { MODEL_TYPES, parametersOf, toInt, TYPE_SOURCE_LABELS } from "@/components/models/model-vocab";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DirtyCountBadge, DirtyField, DirtyFooter, DirtySaveButton } from "@/components/ui/dirty-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { sameJson } from "@/lib/dirty-fields";
import { formatDateTime, useTimezone } from "@/lib/time";
import { useDirtyFields } from "@/lib/use-dirty-fields";
import { usePermissions } from "@/lib/permissions";
import type {
  AdoptModelsDevResult,
  AvailabilityRule,
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

/** 抽屉分组标题：标题 + 未保存计数（09 原语）。 */
function DrawerSection({
  title, dirtyCount, description, children,
}: {
  title: string;
  dirtyCount: number;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-slot="drawer-section" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <h3 className="text-sm font-semibold text-title">{title}</h3>
        <DirtyCountBadge count={dirtyCount} />
        {description ? <span className="text-2xs text-faint">{description}</span> : null}
      </div>
      {children}
    </section>
  );
}

interface UpstreamFormState {
  upstream_id: string;
  name: string;
  model_type: string;
  model_type_source: ModelTypeSource;
  parameters: ModelParameters;
  cost_input_per_1m: string;
  cost_output_per_1m: string;
  markup: string;
}

/**
 * 上游模型编辑抽屉（ticket 11，替代旧的小弹窗）：
 * - 右侧满高 100vh（宽 820px：760–860 区间），窄屏全宽；内容区滚动、底部动作条固定；
 * - 分组：基本信息 / 能力与参数 / 价格 / 状态与冷却；启用开关随「保存」写入，冷却即时生效；
 * - 09 脏标记原语：字段级色条 + 未保存计数 + 底部摘要 + 恢复；保存是唯一主按钮（干净时中性禁用）；
 * - 冷却双模式互斥：单次生效禁周期、周期窗口生效禁单次，说明含阻塞规则与窗口结束时间，始终只有一个「解除」。
 */
export function UpstreamModelDrawer({
  initial, upstreams, canCost, onClose, onSaved,
}: {
  initial: UpstreamModel | null;
  /** 只用到 id/name（上游详情页的 UpstreamRow 也能直接传入）。 */
  upstreams: Array<Pick<Upstream, "id" | "name">>;
  canCost: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canReadRules = can("availability:read");
  const { mode: timezone } = useTimezone();
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
    cost_input_per_1m: initial?.cost_input_per_1m ?? "",
    cost_output_per_1m: initial?.cost_output_per_1m ?? "",
    markup: initial?.markup ?? "1.0000",
  });
  const [form, setForm] = useState<UpstreamFormState>(initialForm);
  // 基线=挂载时刻的表单（编辑态=服务端行，新建态=空白默认）；保存成功前的唯一真值。
  const [baseline, setBaseline] = useState<UpstreamFormState>(initialForm);
  const { dirtyFields, dirtyCount, isDirty, isDirtyField } = useDirtyFields(baseline, form, {
    equals: { parameters: sameJson },
  });
  const markupNum = Number(form.markup.trim());
  const markupInvalid = form.markup.trim() !== "" && (!Number.isFinite(markupNum) || markupNum <= 0 || markupNum > 100);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // 冷却草稿（自定义时刻/原因/周期窗口）也算未保存：关闭时一并提示。
  const [cooldownDraftDirty, setCooldownDraftDirty] = useState(false);
  const [cooldownMode, setCooldownMode] = useState<CooldownMode>("single");
  const [removingRule, setRemovingRule] = useState<AvailabilityRule | null>(null);

  // 冷却数据：规则可读才预判互斥；不可读时面板降级，冲突交给后端 409 兜底。
  const rulesQuery = useAvailabilityRulesQuery(initial !== null && canReadRules);
  const rules = rulesQuery.data ?? [];
  // 抽屉打开期间行状态以列表缓存为准：启用/关闭/冷却后 invalidate 会带回最新行。
  const liveQ = useQuery({
    queryKey: ["upstream-models"],
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
    enabled: initial !== null,
  });
  const liveRow = initial === null ? null : (liveQ.data?.items.find((item) => item.id === initial.id) ?? initial);
  const cooldown = cooldownModeState({
    row: liveRow ?? { enabled: true },
    rules: canReadRules ? rules : null,
    scope: "upstream_model",
    scopeId: initial?.id ?? "",
    nowMs: Date.now(),
    formatDeadline: (ms) => formatDateTime(ms, timezone),
  });
  // 当前选中的模式不可用时自动切到可用模式（互斥提示仍常驻显示阻塞模式原因）。
  useEffect(() => {
    if (cooldownMode === "single" && cooldown.blockedSingle && !cooldown.blockedPeriodic) setCooldownMode("periodic");
    if (cooldownMode === "periodic" && cooldown.blockedPeriodic && !cooldown.blockedSingle) setCooldownMode("single");
  }, [cooldownMode, cooldown.blockedSingle, cooldown.blockedPeriodic]);

  const availability = useAvailabilityMutation("upstream");
  const refreshCooldown = () => {
    void qc.invalidateQueries({ queryKey: ["availability-rules"] });
    void qc.invalidateQueries({ queryKey: ["upstream-models"] });
  };
  const setSingleCooldown = (deadline: number, note: string) => {
    if (initial === null) return;
    availability.mutate(
      { id: initial.id, action: "cooldown", cooldown_until_ms: deadline, note },
      { onSuccess: refreshCooldown },
    );
  };
  const createPeriodic = useMutation({
    mutationFn: (input: PeriodicCooldownInput) => {
      if (initial === null) throw new Error("先保存上游模型，再设置周期冷却");
      return api.post<AvailabilityRule>(ENDPOINTS.availabilityRules, {
        kind: "cooldown",
        scope: "upstream_model",
        scope_id: initial.id,
        ...input,
      });
    },
    onSuccess: () => {
      toast.success("周期冷却已设置");
      refreshCooldown();
    },
    onError: (e: Error) => toast.error("设置失败", { description: conflictDescription(e, timezone) }),
  });
  const removePeriodic = useMutation({
    mutationFn: (ruleId: string) => api.del<void>(ENDPOINTS.availabilityRule(ruleId)),
    onSuccess: () => {
      toast.success("周期冷却规则已删除");
      setRemovingRule(null);
      refreshCooldown();
    },
    onError: (e: Error) => toast.error("删除失败", { description: e.message }),
  });
  const releaseCooldown = () => {
    if (initial === null) return;
    availability.mutate({ id: initial.id, action: "release" });
  };

  const requestClose = () => {
    if (isDirty || cooldownDraftDirty) setConfirmDiscard(true);
    else onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        model_type: form.model_type,
        model_type_source: form.model_type_source,
        parameters: form.parameters,
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
  // 成功后取回最新行回填表单并更新来源徽章（兑入已落库，基线随之前移）。
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
  const resetField = <K extends keyof UpstreamFormState>(key: K) => setForm({ ...form, [key]: baseline[key] });
  const resetAll = () => setForm(baseline);
  const patchParameters = (next: ModelParameters) => {
    // 抽屉内的人工编辑即时摘掉 models.dev 徽章（服务端以实际是否改动为准）。
    setParamsSource("manual");
    setForm({ ...form, parameters: next });
  };
  const basicDirtyCount = (["upstream_id", "name", "model_type", "model_type_source"] as const)
    .filter((key) => dirtyFields.has(key)).length;
  const capabilityDirtyCount = isDirtyField("parameters") ? 1 : 0;
  const priceDirtyCount = (["cost_input_per_1m", "cost_output_per_1m", "markup"] as const)
    .filter((key) => dirtyFields.has(key)).length;
  const upstreamName = upstreams.find((item) => item.id === form.upstream_id)?.name ?? "—";
  const statusBadge = liveRow !== null ? (
    <Badge tone={availabilityTone(liveRow)}>{availabilityText(liveRow)}</Badge>
  ) : (
    <Badge tone="neutral">未保存</Badge>
  );

  return (
    <>
      <Sheet open onOpenChange={(v) => { if (!v) requestClose(); }}>
        <SheetContent
          side="right"
          data-slot="upstream-model-drawer"
          className="flex h-screen w-full flex-col gap-0 border-l bg-surface p-0 sm:w-[820px] sm:min-w-[760px] sm:max-w-[860px]"
        >
          <SheetHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12">
            <SheetTitle>{initial !== null ? "编辑上游模型" : "登记上游模型"}</SheetTitle>
            <SheetDescription>
              {initial !== null
                ? `${form.name.trim() || "未命名模型"} · 上游渠道 ${upstreamName}`
                : "填写基本信息、能力与价格；保存后可在同一抽屉管理状态与冷却"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
            <DrawerSection title="基本信息" dirtyCount={basicDirtyCount}>
              <div className="grid grid-cols-2 gap-3">
                <DirtyField dirty={isDirtyField("upstream_id")} onReset={() => resetField("upstream_id")}>
                  <Field label="所属上游">
                    <Select value={form.upstream_id} disabled={initial !== null} onValueChange={(v) => setForm({ ...form, upstream_id: v })}>
                      <SelectTrigger><SelectValue placeholder="选择上游" /></SelectTrigger>
                      <SelectContent>
                        {upstreams.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                </DirtyField>
                <DirtyField dirty={isDirtyField("name")} onReset={() => resetField("name")}>
                  <Field label="模型名">
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 glm-5.3" className="font-mono" />
                  </Field>
                </DirtyField>
                <DirtyField dirty={isDirtyField("model_type")} onReset={() => resetField("model_type")}>
                  <Field label="类型">
                    <Select value={form.model_type} onValueChange={(v) => setForm({ ...form, model_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MODEL_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                </DirtyField>
                <DirtyField dirty={isDirtyField("model_type_source")} onReset={() => resetField("model_type_source")}>
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
                </DirtyField>
              </div>
            </DrawerSection>

            <DrawerSection title="能力与参数" dirtyCount={capabilityDirtyCount}>
              <div className="flex flex-wrap items-center gap-2">
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
              <DirtyField dirty={isDirtyField("parameters")} onReset={() => resetField("parameters")}>
                <ParameterFields value={form.parameters} onChange={patchParameters} />
              </DirtyField>
            </DrawerSection>

            <DrawerSection title="价格" dirtyCount={canCost ? priceDirtyCount : 0} description="billing:cost 才可见">
              {canCost ? (
                <div className="grid grid-cols-3 gap-3">
                  <DirtyField dirty={isDirtyField("cost_input_per_1m")} onReset={() => resetField("cost_input_per_1m")}>
                    <Field label="输入成本 / 1M" hint="元，留空 = 未定价">
                      <Input value={form.cost_input_per_1m} onChange={(e) => setForm({ ...form, cost_input_per_1m: e.target.value })} placeholder="如 2.0000" className="tnum" />
                    </Field>
                  </DirtyField>
                  <DirtyField dirty={isDirtyField("cost_output_per_1m")} onReset={() => resetField("cost_output_per_1m")}>
                    <Field label="输出成本 / 1M" hint="元，留空 = 未定价">
                      <Input value={form.cost_output_per_1m} onChange={(e) => setForm({ ...form, cost_output_per_1m: e.target.value })} placeholder="如 8.0000" className="tnum" />
                    </Field>
                  </DirtyField>
                  <DirtyField dirty={isDirtyField("markup")} onReset={() => resetField("markup")}>
                    <Field label="倍率" hint={markupInvalid ? "必须是 (0, 100] 的数字" : "如 1.2000 = 1.2 倍"}>
                      <Input value={form.markup} onChange={(e) => setForm({ ...form, markup: e.target.value })} placeholder="1.0000" className="tnum" />
                    </Field>
                  </DirtyField>
                </div>
              ) : (
                <p className="text-2xs text-faint">成本与倍率需要 billing:cost 权限；当前账号不可见也不可改。</p>
              )}
            </DrawerSection>

            <DrawerSection title="状态与冷却" dirtyCount={0} description="启用/关闭与冷却即时生效，不随「保存」写入">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-2">
                <span className="flex flex-wrap items-center gap-2 text-2sm text-body">
                  当前状态 {statusBadge}
                  <span className="text-2xs text-faint">
                    {liveRow === null
                      ? "保存后可在这里启用/关闭与设置冷却"
                      : "关闭是人工长期措施；启用会同时清掉冷却（周期窗口内仅跳过当前窗口）"}
                  </span>
                </span>
                {liveRow !== null ? (
                  <ActionButton
                    action={liveRow.enabled ? "disable" : "enable"}
                    variant="outline"
                    size="sm"
                    disabled={availability.isPending}
                    onClick={() => availability.mutate({
                      id: liveRow.id,
                      action: liveRow.enabled ? "disable" : "enable",
                    })}
                  >
                    {liveRow.enabled ? "关闭" : "启用"}
                  </ActionButton>
                ) : null}
              </div>
              {initial !== null ? (
                <CooldownControlPanel
                  state={cooldown}
                  mode={cooldownMode}
                  onModeChange={setCooldownMode}
                  pending={availability.isPending || createPeriodic.isPending || removePeriodic.isPending}
                  onRelease={releaseCooldown}
                  rulesUnavailable={!canReadRules}
                  singleForm={(
                    <SingleCooldownFields
                      pending={availability.isPending}
                      onSubmit={setSingleCooldown}
                      onDirtyChange={setCooldownDraftDirty}
                    />
                  )}
                  periodicForm={(
                    <PeriodicCooldownFields
                      scope="upstream_model"
                      scopeId={initial.id}
                      rules={rules}
                      pending={createPeriodic.isPending || removePeriodic.isPending}
                      onSubmit={(input) => createPeriodic.mutate(input)}
                      onRemoveRule={(ruleId) => setRemovingRule(rules.find((rule) => rule.id === ruleId) ?? null)}
                      onDirtyChange={setCooldownDraftDirty}
                    />
                  )}
                />
              ) : (
                <p className="text-2xs text-faint">新建模型保存后，才能在这里设置启用/关闭与冷却。</p>
              )}
            </DrawerSection>
          </div>
          <div className="shrink-0 border-t border-border bg-surface px-6 py-3">
            <DirtyFooter count={dirtyCount} onResetAll={resetAll} saving={save.isPending}>
              <Button variant="outline" size="sm" disabled={save.isPending} onClick={requestClose}>
                取消
              </Button>
              <DirtySaveButton
                dirty={isDirty}
                pending={save.isPending}
                savingLabel="保存中…"
                disabled={invalid}
                onClick={() => save.mutate()}
              >
                保存
              </DirtySaveButton>
            </DirtyFooter>
          </div>
        </SheetContent>
      </Sheet>
      {confirmDiscard ? (
        <ConfirmDialog
          open
          onOpenChange={(v) => { if (!v) setConfirmDiscard(false); }}
          title="放弃修改？"
          description="抽屉内已改的模型字段（含能力参数、价格、冷却草稿）不会写入，关闭后将丢失。"
          confirmLabel="放弃修改"
          destructive
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
        />
      ) : null}
      {removingRule !== null ? (
        <ConfirmDialog
          open
          onOpenChange={(v) => { if (!v) setRemovingRule(null); }}
          title="删除周期冷却规则？"
          description="该周期规则会被删除，之后不再按窗口冷却；已生效的当前窗口也会随规则删除而结束。"
          confirmLabel="删除规则"
          destructive
          onConfirm={() => removePeriodic.mutate(removingRule.id)}
        />
      ) : null}
    </>
  );
}
