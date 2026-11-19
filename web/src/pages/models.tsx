import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

import { CooldownDialog, Field, PeriodicCooldownDialog } from "@/components/models/cooldown-dialogs";
import {
  availabilityText, availabilityTone, isCooling, periodicByRow, ruleSummary,
  useAvailabilityMutation, useAvailabilityRulesQuery, useBatchMutation,
} from "@/components/models/availability";
import { ModelsTable, type ModelColumn } from "@/components/models/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { fmtCny, formatCount, fmtInt } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import { usePermissions } from "@/lib/permissions";
import { SELECT_ALL_VALUE } from "@/lib/select-sentinels";
import type {
  ModelParameters, ModelTypeSource, PublicModel, RoutingMode, Upstream, UpstreamModel,
} from "@/types";

/** 旧系统 catalog 的七种模型类型（l02_domain/models.ModelType）。 */
const MODEL_TYPES: Array<{ value: string; label: string }> = [
  { value: "chat", label: "chat · 对话" },
  { value: "embedding", label: "embedding · 向量化" },
  { value: "rerank", label: "rerank · 重排" },
  { value: "image_generation", label: "image_generation · 图像生成" },
  { value: "audio_tts", label: "audio_tts · 语音合成" },
  { value: "audio_transcription", label: "audio_transcription · 语音转写" },
  { value: "video", label: "video · 视频生成" },
];

/** 旧系统 model_type_source 三值；auto 是指令，不是存储值。 */
const TYPE_SOURCE_LABELS: Record<ModelTypeSource, string> = {
  default: "默认（按类型推断）",
  upstream: "上游声明",
  manual: "人工指定",
};

const INPUT_TYPES = ["text", "image", "audio", "video", "file"] as const;
const OUTPUT_TYPES = ["text", "image", "audio", "embedding"] as const;

const ROUTING_LABELS: Record<RoutingMode, { label: string; desc: string }> = {
  failover: { label: "failover · 故障转移", desc: "按 priority 层级顺序选择；priority 数值小优先，同层由数据面按健康与延迟选择" },
  weighted: { label: "weighted · 加权分流", desc: "按 weight 整数相对比例分配（1 与 3 = 1:3）；该模式没有跨层兜底" },
  conditional: { label: "conditional · 条件路由", desc: "按 when 表达式匹配成员，只有末位成员可以留空；该模式没有跨层兜底" },
};

const DEFAULT_PARAMETERS: ModelParameters = {
  max_input_tokens: 0,
  max_output_tokens: 0,
  reasoning_level: "",
  input_types: ["text"],
  output_types: ["text"],
  tool_call: false,
  reasoning: false,
  attachment: false,
  structured_output: false,
};

/** 周期冷却窗口语义增强（窗口期内启用=仅跳过当前窗口）待后端合入；本页文案按现行为描述。 */
const ENABLE_SEMANTICS_NOTE =
  "启用为本次启用：解除该行托管冷却；若周期规则正处于窗口期，本次启用仅跳过当前窗口，后续窗口照常冷却（GLOSSARY §3）。";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制");
  } catch {
    toast.error("复制失败", { description: "浏览器拒绝了剪贴板访问" });
  }
}

function toInt(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function parametersOf(row: { parameters?: ModelParameters }): ModelParameters {
  return { ...DEFAULT_PARAMETERS, ...(row.parameters ?? {}) };
}

function parameterSummary(row: UpstreamModel): string {
  const p = parametersOf(row);
  const input = p.input_types.length > 0 ? p.input_types.join("/") : "—";
  const output = p.output_types.length > 0 ? p.output_types.join("/") : "—";
  const caps: string[] = [];
  if (p.tool_call) caps.push("工具");
  if (p.reasoning) caps.push("推理");
  if (p.structured_output) caps.push("结构化");
  return input + " → " + output + (caps.length > 0 ? " · " + caps.join("/") : "");
}

/** 模型行进价是十进制字符串（元 / 1M 词元）；未配价显示「—」。 */
function costText(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return text === "" ? "—" : "¥" + text + "/M";
}

function markupText(value: string | undefined): string {
  const text = (value ?? "").trim();
  return text === "" ? "—" : "×" + text;
}

/** image 类型在 AG 数据面不记词元，无法计费（E14b 实测）。 */
function isImageType(modelType: string): boolean {
  return modelType.startsWith("image");
}

/** 名称相似度：子串优先，其次子序列；用于创建公开模型时提示相似上游模型。 */
function similarity(needle: string, candidate: string): number {
  if (!needle) return 0;
  const normalized = candidate.toLowerCase();
  if (normalized === needle) return 200;
  const index = normalized.indexOf(needle);
  if (index >= 0) return 120 - index + needle.length * 2;
  let pos = 0;
  let gaps = 0;
  for (const ch of needle) {
    if (ch === "-" || ch === "_" || ch === "." || ch === "/") continue;
    const found = normalized.indexOf(ch, pos);
    if (found < 0) return 0;
    gaps += found - pos;
    pos = found + 1;
  }
  return Math.max(1, 60 - gaps - needle.length);
}

/** GET /admin/prices/upstream 行；types.ts 的 UpstreamPrice 与实际返回有出入，这里收窄到用到的字段。 */
interface UpstreamPriceRow {
  id: string;
  upstream_model: string;
  item: string;
  unit_price_micro: number;
  effective_from_ms: number;
}

interface CachePrice {
  micro: number;
  fromMs: number;
}

/** ADR-020：缓存价没有模型行列，只有 /admin/prices/upstream 的 cache_read 版本行；
 * 按模型名取 effective_from_ms 最新的一条。 */
function cacheMapOf(items: UpstreamPriceRow[] | undefined): Map<string, CachePrice> {
  const map = new Map<string, CachePrice>();
  for (const price of items ?? []) {
    if (price.item !== "cache_read") continue;
    const prev = map.get(price.upstream_model);
    if (!prev || price.effective_from_ms >= prev.fromMs) {
      map.set(price.upstream_model, { micro: price.unit_price_micro, fromMs: price.effective_from_ms });
    }
  }
  return map;
}

// ---------------------------------------------------------------- 参数编辑器

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

// ---------------------------------------------------------------- 批量改价

/** 批量改价：入 / 出 / 倍率留空 = 不修改；前端逐条 PATCH 现有
 * PATCH /admin/upstream-models/{id}（该端点接受这三个字段，未提供的字段保持不变）。 */
function BatchPriceDialog({
  ids, onDone, onClose,
}: {
  ids: string[]; onDone: () => void; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [markup, setMarkup] = useState("");
  const numeric = (raw: string): number | null => {
    const text = raw.trim();
    if (text === "") return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : Number.NaN;
  };
  const inNum = numeric(input);
  const outNum = numeric(output);
  const markupNum = numeric(markup);
  const invalid =
    Number.isNaN(inNum) || (inNum !== null && inNum < 0) ||
    Number.isNaN(outNum) || (outNum !== null && outNum < 0) ||
    Number.isNaN(markupNum) || (markupNum !== null && (markupNum <= 0 || markupNum > 100));
  const nothingFilled = input.trim() === "" && output.trim() === "" && markup.trim() === "";

  const apply = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (input.trim() !== "") body.cost_input_per_1m = input.trim();
      if (output.trim() !== "") body.cost_output_per_1m = output.trim();
      if (markup.trim() !== "") body.markup = markup.trim();
      const results = await Promise.allSettled(
        ids.map((id) => api.patch<UpstreamModel>(ENDPOINTS.upstreamModelUpdate(id), body)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      return { total: results.length, failed, firstError: firstError?.reason as Error | undefined };
    },
    onSuccess: ({ total, failed, firstError }) => {
      if (failed === 0) toast.success("批量改价完成", { description: "成功 " + total + " 个" });
      else {
        toast.warning("批量改价部分完成", {
          description: "成功 " + (total - failed) + " 个；失败 " + failed + " 个" + (firstError ? "：" + firstError.message : ""),
        });
      }
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      onDone();
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>批量改价 · {ids.length} 个上游模型</DialogTitle>
        </DialogHeader>
        <p className="text-2xs text-faint">
          逐条写入模型行进价（现行权威，ADR-020）；留空的字段保持每行原值不变。缓存价在价目页维护，不在本弹窗。
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Field label="输入成本 / 1M" hint={Number.isNaN(inNum) || inNum !== null && inNum < 0 ? "必须是非负数字" : "元，留空不动"}>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="留空不动" className="tnum" />
          </Field>
          <Field label="输出成本 / 1M" hint={Number.isNaN(outNum) || outNum !== null && outNum < 0 ? "必须是非负数字" : "元，留空不动"}>
            <Input value={output} onChange={(e) => setOutput(e.target.value)} placeholder="留空不动" className="tnum" />
          </Field>
          <Field label="倍率" hint={markupNum !== null && (markupNum <= 0 || markupNum > 100) ? "必须是 (0, 100]" : "留空不动"}>
            <Input value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder="留空不动" className="tnum" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            disabled={invalid || nothingFilled || apply.isPending}
            onClick={() => apply.mutate()}
          >
            {apply.isPending ? "保存中…" : "应用到所选 " + ids.length + " 个"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 上游模型

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

function UpstreamModelDialog({
  initial, upstreams, canCost, onClose,
}: {
  initial: UpstreamModel | null; upstreams: Upstream[]; canCost: boolean; onClose: () => void;
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

// ---------------------------------------------------------------- 批量删除确认

/** 批量删除红色确认；超过 10 条需手动输入「删除」二字（DESIGN-AUDIT §4 三档确认）。 */
function BatchDeleteDialog({
  count, subject, pending, onConfirm, onClose,
}: {
  count: number; subject: string; pending: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const needTyping = count > 10;
  const ready = !needTyping || typed.trim() === "删除";
  return (
    <AlertDialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>批量删除 {count} 个{subject}？</AlertDialogTitle>
          <AlertDialogDescription>
            此操作不可逆：{subject === "上游模型" ? "被公开模型引用的条目会逐条删除失败，其余仍会执行" : "成员引用关系级联删除"}；历史计费流水保留。
            {needTyping ? "数量超过 10 条，请输入「删除」二字确认。" : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {needTyping ? (
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="输入「删除」以确认"
            aria-label="输入删除以确认"
            autoFocus
          />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className="bg-danger text-white hover:bg-danger/90"
            disabled={!ready || pending}
            onClick={(event) => { event.preventDefault(); onConfirm(); }}
          >
            {pending ? "删除中…" : "确认删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------- 上游模型 Tab

function UpstreamTab() {
  const { can } = usePermissions();
  const canCost = can("billing:cost");
  const canWrite = can("upstream_models:write");
  const canAvailability = can("availability:read") && can("availability:write");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["upstream-models"],
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
    refetchInterval: 30_000,
  });
  const qUpstreams = useQuery({ queryKey: ["upstreams"], queryFn: () => apiList<Upstream>(ENDPOINTS.upstreams) });
  // ADR-020：缓存价不在模型行，只有上游价目表的 cache_read 版本行；有 prices:read 才附显。
  const qPrices = useQuery({
    queryKey: ["upstream-prices"],
    queryFn: () => apiList<UpstreamPriceRow>(ENDPOINTS.pricesUpstream + "?page_size=200"),
    enabled: canCost && can("prices:read"),
    staleTime: 60_000,
  });
  const cachePrices = useMemo(() => cacheMapOf(qPrices.data?.items), [qPrices.data]);

  const availability = useAvailabilityMutation("upstream");
  const batch = useBatchMutation("upstream");
  const rulesQuery = useAvailabilityRulesQuery(can("availability:read"));
  const periodicRules = periodicByRow(rulesQuery.data, "upstream_model");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [typeValue, setTypeValue] = useState<string>(SELECT_ALL_VALUE);
  const [dialog, setDialog] = useState<{ open: boolean; initial: UpstreamModel | null }>({ open: false, initial: null });
  const [deleting, setDeleting] = useState<UpstreamModel | null>(null);
  const [batchDelete, setBatchDelete] = useState(false);
  const [batchPrice, setBatchPrice] = useState(false);
  const [cooldownFor, setCooldownFor] = useState<UpstreamModel | null>(null);
  const [periodicFor, setPeriodicFor] = useState<{ id: string; title: string } | null>(null);

  const allItems = q.data?.items ?? [];
  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () => allItems.filter((row) => {
      if (typeValue !== SELECT_ALL_VALUE && row.model_type !== typeValue) return false;
      if (needle === "") return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        (row.upstream_name ?? "").toLowerCase().includes(needle) ||
        (row.vendor_name ?? "").toLowerCase().includes(needle) ||
        row.model_type.toLowerCase().includes(needle)
      );
    }),
    [allItems, needle, typeValue],
  );

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  const clearFilters = () => {
    setSearch("");
    setTypeValue(SELECT_ALL_VALUE);
  };

  const del = useMutation({
    mutationFn: (id: string) => api.del<void>(ENDPOINTS.upstreamModelUpdate(id)),
    onSuccess: () => {
      toast.success("上游模型已删除");
      void qc.invalidateQueries({ queryKey: ["upstream-models"] });
      void qc.invalidateQueries({ queryKey: ["public-models"] });
      setDeleting(null);
    },
    onError: (e: Error) => toast.error("删除失败", { description: e.message }),
  });

  const priceCell = (row: UpstreamModel) => {
    const cache = cachePrices.get(row.name);
    return (
      <div className="space-y-0.5">
        <div>入 {costText(row.cost_input_per_1m)} · 出 {costText(row.cost_output_per_1m)}</div>
        <div className="text-faint">
          倍率 {markupText(row.markup)} · 缓 {cache ? fmtCny(cache.micro) + "/M" : "—"}
        </div>
      </div>
    );
  };

  const selectColumn: ModelColumn<UpstreamModel> = {
    key: "select",
    label: "选择",
    hideable: false,
    headerClassName: "w-10",
    header: (
      <Checkbox
        checked={allSelected ? true : someSelected ? "indeterminate" : false}
        onCheckedChange={() => toggleAll()}
        aria-label="全选当前列表"
      />
    ),
    cell: (row) => (
      <Checkbox
        checked={selected.has(row.id)}
        onCheckedChange={() => toggleRow(row.id)}
        aria-label={"选择 " + row.name}
      />
    ),
  };

  const columns: ModelColumn<UpstreamModel>[] = [
    ...(canWrite ? [selectColumn] : []),
    {
      key: "name",
      label: "模型 / 上游",
      cell: (row) => (
        <div>
          <div className="tnum font-medium text-title">{row.name}</div>
          <div className="text-2xs text-faint">
            {(row.upstream_name ?? "—") + (row.vendor_name ? " · " + row.vendor_name : "")}
          </div>
        </div>
      ),
    },
    {
      key: "type",
      label: "类型 / 来源",
      cell: (row) => (
        <div className="space-y-1">
          <Badge tone="info">{row.model_type}</Badge>
          <div className="text-2xs text-faint">{TYPE_SOURCE_LABELS[row.model_type_source ?? "default"]}</div>
          {isImageType(row.model_type) ? (
            <div className="text-2xs text-warning-text">AG 不记词元，无法计费</div>
          ) : null}
        </div>
      ),
    },
    ...(canCost ? [{
      key: "price",
      label: "价格（入 / 出 / 倍率）",
      className: "text-right tnum",
      cell: priceCell,
    } as ModelColumn<UpstreamModel>] : []),
    {
      key: "params",
      label: "参数",
      cell: (row) => {
        const p = parametersOf(row);
        return (
          <div className="text-2xs text-body">
            <div>{parameterSummary(row)}</div>
            <div className="text-faint">
              入上限 {p.max_input_tokens > 0 ? fmtInt(p.max_input_tokens) : "未声明"} / 出上限 {p.max_output_tokens > 0 ? fmtInt(p.max_output_tokens) : "未声明"}
            </div>
          </div>
        );
      },
    },
    {
      key: "targets",
      label: "被引用",
      className: "text-right tnum",
      cell: (row) => <span className="text-2sm">{formatCount(row.target_count ?? 0)}</span>,
    },
    {
      key: "status",
      label: "状态",
      cell: (row) => {
        const periodic = periodicRules.get(row.id);
        return (
          <div>
            <Badge tone={availabilityTone(row)}>{availabilityText(row)}</Badge>
            {periodic ? <div className="mt-1 text-2xs text-faint">周期：{ruleSummary(periodic)}</div> : null}
          </div>
        );
      },
    },
    ...(canWrite ? [{
      key: "actions",
      label: "操作",
      hideable: false,
      headerClassName: "min-w-64",
      cell: (row: UpstreamModel) => (
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, initial: row })}>
            <ACTION_ICONS.edit className="h-3.5 w-3.5" /> 编辑
          </Button>
          {row.enabled ? (
            <Button variant="ghost" size="sm" onClick={() => availability.mutate({ id: row.id, action: "disable" })}>
              <ACTION_ICONS.disable className="h-3.5 w-3.5" /> 关闭
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => availability.mutate({ id: row.id, action: "enable" })}>
              <ACTION_ICONS.enable className="h-3.5 w-3.5" /> 启用
            </Button>
          )}
          {isCooling(row) ? (
            <Button variant="ghost" size="sm" onClick={() => availability.mutate({ id: row.id, action: "release" })}>
              <ACTION_ICONS.releaseCooldown className="h-3.5 w-3.5" /> 解除冷却
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setCooldownFor(row)}>
              <ACTION_ICONS.cooldown className="h-3.5 w-3.5" /> 冷却
            </Button>
          )}
          {canAvailability ? (
            <Button variant="ghost" size="sm" onClick={() => setPeriodicFor({ id: row.id, title: "周期冷却 · " + row.name })}>
              <ACTION_ICONS.periodic className="h-3.5 w-3.5" /> 周期
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="text-danger-text"
            disabled={(row.target_count ?? 0) > 0}
            title={(row.target_count ?? 0) > 0 ? "被公开模型引用，先移除成员再删除" : undefined}
            onClick={() => setDeleting(row)}
          >
            <ACTION_ICONS.delete className="h-3.5 w-3.5" /> 删除
          </Button>
        </div>
      ),
    } as ModelColumn<UpstreamModel>] : []),
  ];

  const runBatch = (action: "enable" | "disable" | "delete") => {
    batch.mutate({ ids: Array.from(selected), action });
    setSelected(new Set());
    setBatchDelete(false);
  };

  const toolbarEnd = canWrite && selected.size > 0 ? (
    <>
      <span className="text-2xs text-faint">已选 <span className="tnum font-medium text-title">{selected.size}</span></span>
      <Button variant="outline" size="sm" disabled={batch.isPending} onClick={() => runBatch("enable")}>
        <ACTION_ICONS.enable className="h-3.5 w-3.5" /> 批量启用
      </Button>
      <Button variant="outline" size="sm" disabled={batch.isPending} onClick={() => runBatch("disable")}>
        <ACTION_ICONS.disable className="h-3.5 w-3.5" /> 批量关闭
      </Button>
      {canCost ? (
        <Button variant="outline" size="sm" onClick={() => setBatchPrice(true)}>
          <ACTION_ICONS.batchPrice className="h-3.5 w-3.5" /> 批量改价
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" className="text-danger-text" disabled={batch.isPending} onClick={() => setBatchDelete(true)}>
        <ACTION_ICONS.delete className="h-3.5 w-3.5" /> 批量删除
      </Button>
      <Button variant="ghost" size="sm" disabled={batch.isPending} onClick={() => setSelected(new Set())}>
        <ACTION_ICONS.clear className="h-3.5 w-3.5" /> 清除选择
      </Button>
    </>
  ) : null;

  return (
    <div className="space-y-3">
      <p className="text-2xs text-faint">
        上游模型是技术记录（类型、参数、进价、可用性）；公开模型通过成员引用它。关闭是人工长期措施，冷却到期自动恢复。
        {ENABLE_SEMANTICS_NOTE}
      </p>
      <ModelsTable<UpstreamModel>
        columns={columns}
        rows={rows}
        totalCount={allItems.length}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        storageKey="slipstream.cols.models"
        tabKey="upstream"
        searchText={search}
        onSearchChange={setSearch}
        searchPlaceholder="搜索模型名、上游或类型"
        typeFilter={{
          value: typeValue,
          onChange: setTypeValue,
          options: MODEL_TYPES,
        }}
        toolbarEnd={toolbarEnd}
        emptyText="还没有登记上游模型"
        emptyAction={canWrite ? (
          <Button size="sm" disabled={(qUpstreams.data?.items.length ?? 0) === 0} onClick={() => setDialog({ open: true, initial: null })}>登记模型</Button>
        ) : undefined}
        onClearFilters={clearFilters}
      />
      {dialog.open ? (
        <UpstreamModelDialog
          initial={dialog.initial}
          upstreams={qUpstreams.data?.items ?? []}
          canCost={canCost}
          onClose={() => setDialog({ open: false, initial: null })}
        />
      ) : null}
      {cooldownFor !== null ? (
        <CooldownDialog
          title={"冷却上游模型 · " + cooldownFor.name}
          pending={availability.isPending}
          onConfirm={(deadline, note) => {
            availability.mutate({ id: cooldownFor.id, action: "cooldown", cooldown_until_ms: deadline, note });
            setCooldownFor(null);
          }}
          onClose={() => setCooldownFor(null)}
        />
      ) : null}
      {periodicFor !== null ? (
        <PeriodicCooldownDialog
          title={periodicFor.title}
          scope="upstream_model"
          scopeId={periodicFor.id}
          rules={(rulesQuery.data ?? []).filter((rule) => rule.scope === "upstream_model" && rule.scope_id === periodicFor.id)}
          onClose={() => setPeriodicFor(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title={"删除上游模型 " + (deleting?.name ?? "") + "？"}
        description="被公开模型引用的模型不能删除；历史计费流水保留。此操作不可逆。"
        confirmLabel="确认删除"
        destructive
        onConfirm={() => { if (deleting !== null) del.mutate(deleting.id); }}
      />
      {batchDelete ? (
        <BatchDeleteDialog
          count={selected.size}
          subject="上游模型"
          pending={batch.isPending}
          onConfirm={() => runBatch("delete")}
          onClose={() => setBatchDelete(false)}
        />
      ) : null}
      {batchPrice ? (
        <BatchPriceDialog
          ids={Array.from(selected)}
          onDone={() => setSelected(new Set())}
          onClose={() => setBatchPrice(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- 公开模型

interface MemberDraft {
  upstream_model_id: string;
  priority: string;
  weight: string;
  when: string;
}

function memberDraftsOf(model: PublicModel): MemberDraft[] {
  return (model.targets ?? []).map((t) => ({
    upstream_model_id: t.upstream_model_id ?? "",
    priority: String(t.priority ?? 1),
    weight: t.weight === null || t.weight === undefined ? "" : String(t.weight),
    when: t.when ?? "",
  }));
}

function nextPriority(members: MemberDraft[]): number {
  let max = 0;
  for (const member of members) max = Math.max(max, toInt(member.priority));
  return max + 1;
}

function validateMembers(members: MemberDraft[], mode: RoutingMode): string[] {
  const errors: string[] = [];
  if (members.length === 0) errors.push("至少保留 1 个成员");
  const seen = new Set<string>();
  for (const member of members) {
    if (!member.upstream_model_id) errors.push("成员缺少上游模型");
    if (seen.has(member.upstream_model_id)) errors.push("成员重复");
    seen.add(member.upstream_model_id);
    const priority = Number(member.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) errors.push("priority 必须是 0-100 的整数（数值小优先）");
    if (mode === "weighted") {
      const weight = Number(member.weight);
      if (!Number.isInteger(weight) || weight < 1) errors.push("weighted 模式下 weight 必须是 >= 1 的整数");
    }
  }
  if (mode === "conditional") {
    const sorted = [...members].sort((a, b) => Number(a.priority) - Number(b.priority));
    sorted.forEach((member, index) => {
      if (index < sorted.length - 1 && member.when.trim() === "") errors.push("conditional 模式只有末位成员可以留空 when");
    });
  }
  return Array.from(new Set(errors));
}

function MemberEditor({
  members, upstreamModels, mode, onChange,
}: {
  members: MemberDraft[]; upstreamModels: UpstreamModel[]; mode: RoutingMode;
  onChange: (next: MemberDraft[]) => void;
}) {
  const [pick, setPick] = useState("");
  const available = upstreamModels.filter((m) => !members.some((member) => member.upstream_model_id === m.id));
  const update = (index: number, patch: Partial<MemberDraft>) => {
    onChange(members.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Combobox
          className="max-w-64"
          placeholder="选择上游模型加入成员"
          searchPlaceholder="搜索上游模型名称或标识"
          value={pick}
          options={available.map((m) => ({
            value: m.id,
            label: m.name + (m.upstream_name ? " · " + m.upstream_name : ""),
          }))}
          onChange={setPick}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={pick === ""}
          onClick={() => {
            onChange([...members, { upstream_model_id: pick, priority: String(nextPriority(members)), weight: "", when: "" }]);
            setPick("");
          }}
        >
          <ACTION_ICONS.add className="h-3.5 w-3.5" /> 添加成员
        </Button>
        <span className="text-2xs text-faint">priority 数值小优先；weighted 用 weight 整数比例。</span>
      </div>
      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {members.map((member, index) => {
          const model = upstreamModels.find((m) => m.id === member.upstream_model_id);
          return (
            <div key={member.upstream_model_id + ":" + index} className="grid grid-cols-12 items-center gap-1 rounded-md border border-border p-2">
              <span className="col-span-4 truncate text-2sm text-body">{model ? model.name + " · " + (model.upstream_name ?? "") : member.upstream_model_id}</span>
              <Input className="col-span-2" inputMode="numeric" placeholder="priority" value={member.priority} onChange={(e) => update(index, { priority: e.target.value })} />
              <Input className="col-span-2" inputMode="numeric" placeholder="weight" value={member.weight} disabled={mode !== "weighted"} onChange={(e) => update(index, { weight: e.target.value })} />
              <Input className="col-span-3" placeholder="when 条件" value={member.when} disabled={mode !== "conditional"} onChange={(e) => update(index, { when: e.target.value })} />
              <Button variant="ghost" size="sm" className="col-span-1 text-danger-text" onClick={() => onChange(members.filter((_, i) => i !== index))}>
                <ACTION_ICONS.clear className="h-3.5 w-3.5" /> 移除
              </Button>
            </div>
          );
        })}
        {members.length === 0 ? <p className="text-2xs text-faint">暂无成员；创建公开模型时至少需要一个成员才能路由。</p> : null}
      </div>
    </div>
  );
}

function PublicModelDialog({
  initial, upstreamModels, onClose,
}: {
  initial: PublicModel | null; upstreamModels: UpstreamModel[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    routing_mode: initial?.routing_mode ?? ("failover" as RoutingMode),
    note: initial?.note ?? "",
    enabled: initial?.enabled ?? true,
  });
  const [members, setMembers] = useState<MemberDraft[]>(initial !== null ? memberDraftsOf(initial) : []);
  const suggestions = useMemo(() => {
    const needle = form.name.trim().toLowerCase();
    if (!needle) return [];
    const scored = upstreamModels
      .map((model) => ({ model, score: similarity(needle, model.name.toLowerCase()) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    return scored;
  }, [form.name, upstreamModels]);
  // 成员只在创建时一起提交；编辑走单独的成员编排对话框（PUT .../targets）。
  const errors = initial === null ? validateMembers(members, form.routing_mode) : [];
  const save = useMutation({
    mutationFn: () => {
      const targets = members.map((member) => ({
        upstream_model_id: member.upstream_model_id,
        priority: toInt(member.priority),
        weight: member.weight.trim() === "" ? 0 : toInt(member.weight),
        when: member.when.trim(),
      }));
      if (initial !== null) {
        return api.patch<PublicModel>(ENDPOINTS.publicModelUpdate(initial.id), {
          name: form.name.trim(),
          routing_mode: form.routing_mode,
          note: form.note.trim(),
          enabled: form.enabled,
        });
      }
      return api.post<PublicModel>(ENDPOINTS.publicModels, {
        name: form.name.trim(),
        routing_mode: form.routing_mode,
        note: form.note.trim(),
        enabled: form.enabled,
        targets,
      });
    },
    onSuccess: () => {
      toast.success(initial !== null ? "公开模型已更新" : "公开模型已创建");
      void qc.invalidateQueries({ queryKey: ["public-models"] });
      onClose();
    },
    onError: (e: Error) => toast.error("保存失败", { description: e.message }),
  });
  const toggleMember = (modelId: string, checked: boolean) => {
    if (checked) {
      if (members.some((member) => member.upstream_model_id === modelId)) return;
      setMembers([...members, { upstream_model_id: modelId, priority: String(nextPriority(members)), weight: "", when: "" }]);
      return;
    }
    setMembers(members.filter((member) => member.upstream_model_id !== modelId));
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial !== null ? "编辑公开模型" : "新建公开模型"}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-auto pr-1">
          <Field label="名称" hint="用户请求时使用的模型名">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 glm-5.3" />
          </Field>
          {initial === null && suggestions.length > 0 ? (
            <div className="rounded-md border border-border bg-surface-2 p-2">
              <div className="mb-1 text-2xs text-faint">相似上游模型（勾选即成为成员）</div>
              <div className="space-y-1">
                {suggestions.map(({ model }) => (
                  <label key={model.id} className="flex items-center gap-2 text-2sm text-body">
                    <Checkbox
                      checked={members.some((member) => member.upstream_model_id === model.id)}
                      onCheckedChange={(checked) => toggleMember(model.id, checked === true)}
                    />
                    <span className="font-mono">{model.name}</span>
                    <span className="text-2xs text-faint">{model.upstream_name ?? ""}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <Field label="策略" hint="strategy 与 priority/weight 的渲染语义一致；旧系统 priority 已翻转为数值小优先">
            <RadioGroup value={form.routing_mode} onValueChange={(v) => setForm({ ...form, routing_mode: v as RoutingMode })} className="gap-2">
              {(Object.keys(ROUTING_LABELS) as RoutingMode[]).map((mode) => (
                <label key={mode} className="flex items-start gap-2 rounded-md border border-border p-2 text-2sm">
                  <RadioGroupItem value={mode} className="mt-0.5" />
                  <span>
                    <span className="font-medium text-body">{ROUTING_LABELS[mode].label}</span>
                    <span className="block text-2xs text-faint">{ROUTING_LABELS[mode].desc}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </Field>
          {initial === null ? (
            <Field label="成员编排">
              <MemberEditor members={members} upstreamModels={upstreamModels} mode={form.routing_mode} onChange={setMembers} />
            </Field>
          ) : null}
          {errors.length > 0 ? <p className="text-2xs text-danger-text">{errors.join("；")}</p> : null}
          <Field label="备注">
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="选填" />
          </Field>
          <label className="flex items-center gap-2 text-2sm text-body">
            <Checkbox checked={form.enabled} onCheckedChange={(checked) => setForm({ ...form, enabled: checked === true })} />
            启用
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={save.isPending || form.name.trim() === "" || errors.length > 0} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembersDialog({
  model, upstreamModels, onClose,
}: {
  model: PublicModel; upstreamModels: UpstreamModel[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [members, setMembers] = useState<MemberDraft[]>(memberDraftsOf(model));
  const errors = validateMembers(members, model.routing_mode);
  const save = useMutation({
    mutationFn: () => {
      const targets = members
        .map((member) => ({
          upstream_model_id: member.upstream_model_id,
          priority: toInt(member.priority),
          weight: member.weight.trim() === "" ? 0 : toInt(member.weight),
          when: member.when.trim(),
        }))
        .sort((a, b) => a.priority - b.priority);
      return api.put(ENDPOINTS.publicModelTargets(model.id), { targets });
    },
    onSuccess: () => {
      toast.success("成员已保存");
      void qc.invalidateQueries({ queryKey: ["public-models"] });
      onClose();
    },
    onError: (e: Error) => toast.error("保存失败", { description: e.message }),
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>成员编排 · {model.name}</DialogTitle>
        </DialogHeader>
        <p className="text-2xs text-faint">
          {ROUTING_LABELS[model.routing_mode].desc}。保存是整批替换；后端按 priority 升序校验，被引用的上游模型不能删除。
        </p>
        <MemberEditor members={members} upstreamModels={upstreamModels} mode={model.routing_mode} onChange={setMembers} />
        {errors.length > 0 ? <p className="text-2xs text-danger-text">{errors.join("；")}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={save.isPending || errors.length > 0} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存成员"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 公开模型 Tab

function PublicTab() {
  const { can } = usePermissions();
  const canWrite = can("public_models:write");
  const canAvailability = can("availability:read") && can("availability:write");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["public-models"],
    queryFn: () => apiList<PublicModel>(ENDPOINTS.publicModels),
    refetchInterval: 30_000,
  });
  const qModels = useQuery({ queryKey: ["upstream-models"], queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels) });
  const availability = useAvailabilityMutation("public");
  const batch = useBatchMutation("public");
  const rulesQuery = useAvailabilityRulesQuery(can("availability:read"));
  const periodicRules = periodicByRow(rulesQuery.data, "public_model");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; initial: PublicModel | null }>({ open: false, initial: null });
  const [membersFor, setMembersFor] = useState<PublicModel | null>(null);
  const [deleting, setDeleting] = useState<PublicModel | null>(null);
  const [batchDelete, setBatchDelete] = useState(false);
  const [cooldownFor, setCooldownFor] = useState<PublicModel | null>(null);
  const [periodicFor, setPeriodicFor] = useState<{ id: string; title: string } | null>(null);

  const allItems = q.data?.items ?? [];
  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () => allItems.filter((row) => {
      if (needle === "") return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        (row.note ?? "").toLowerCase().includes(needle) ||
        (row.targets ?? []).some((t) => (t.upstream_model_name || "").toLowerCase().includes(needle))
      );
    }),
    [allItems, needle],
  );

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));

  const del = useMutation({
    mutationFn: (id: string) => api.del<void>(ENDPOINTS.publicModelUpdate(id)),
    onSuccess: () => {
      toast.success("公开模型已删除");
      void qc.invalidateQueries({ queryKey: ["public-models"] });
      setDeleting(null);
    },
    onError: (e: Error) => toast.error("删除失败", { description: e.message }),
  });

  const selectColumn: ModelColumn<PublicModel> = {
    key: "select",
    label: "选择",
    hideable: false,
    headerClassName: "w-10",
    header: (
      <Checkbox
        checked={allSelected ? true : someSelected ? "indeterminate" : false}
        onCheckedChange={() => toggleAll()}
        aria-label="全选当前列表"
      />
    ),
    cell: (row) => (
      <Checkbox
        checked={selected.has(row.id)}
        onCheckedChange={() => toggleRow(row.id)}
        aria-label={"选择 " + row.name}
      />
    ),
  };

  const columns: ModelColumn<PublicModel>[] = [
    ...(canWrite ? [selectColumn] : []),
    {
      key: "name",
      label: "公开名 / 备注",
      cell: (row) => (
        <div>
          <div className="tnum font-medium text-title">{row.name}</div>
          <div className="text-2xs text-faint">{row.note || "—"}</div>
        </div>
      ),
    },
    {
      key: "routing",
      label: "策略",
      cell: (row) => (
        <div>
          <Badge tone="primary">{row.routing_mode}</Badge>
          <div className="mt-1 max-w-64 text-2xs text-faint">{ROUTING_LABELS[row.routing_mode].desc}</div>
        </div>
      ),
    },
    {
      key: "members",
      label: "成员",
      // 数值列右对齐（对齐镜像：className 头身同用，DESIGN-AUDIT 四期 §2）。
      className: "text-right tnum",
      cell: (row) => {
        const targets = row.targets ?? [];
        const names = targets.slice(0, 3).map((t) => t.upstream_model_name || t.upstream_model_id).filter((name) => Boolean(name));
        return (
          <div>
            <span className="tnum text-2sm">{formatCount(row.target_count ?? targets.length)}</span>
            <div className="text-2xs text-faint">{names.length > 0 ? names.join(" · ") + (targets.length > 3 ? " …" : "") : "—"}</div>
          </div>
        );
      },
    },
    {
      key: "status",
      label: "状态",
      cell: (row) => {
        const periodic = periodicRules.get(row.id);
        return (
          <div>
            <Badge tone={availabilityTone(row)}>{availabilityText(row)}</Badge>
            {periodic ? <div className="mt-1 text-2xs text-faint">周期：{ruleSummary(periodic)}</div> : null}
          </div>
        );
      },
    },
    ...(canWrite ? [{
      key: "actions",
      label: "操作",
      hideable: false,
      headerClassName: "min-w-72",
      cell: (row: PublicModel) => (
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0"
            aria-label={"复制公开名 " + row.name}
            title="复制公开名"
            onClick={() => void copyText(row.name)}
          >
            <ACTION_ICONS.copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMembersFor(row)}>
            <ACTION_ICONS.members className="h-3.5 w-3.5" /> 成员
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, initial: row })}>
            <ACTION_ICONS.edit className="h-3.5 w-3.5" /> 编辑
          </Button>
          {row.enabled ? (
            <Button variant="ghost" size="sm" onClick={() => availability.mutate({ id: row.id, action: "disable" })}>
              <ACTION_ICONS.disable className="h-3.5 w-3.5" /> 关闭
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => availability.mutate({ id: row.id, action: "enable" })}>
              <ACTION_ICONS.enable className="h-3.5 w-3.5" /> 启用
            </Button>
          )}
          {isCooling(row) ? (
            <Button variant="ghost" size="sm" onClick={() => availability.mutate({ id: row.id, action: "release" })}>
              <ACTION_ICONS.releaseCooldown className="h-3.5 w-3.5" /> 解除冷却
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setCooldownFor(row)}>
              <ACTION_ICONS.cooldown className="h-3.5 w-3.5" /> 冷却
            </Button>
          )}
          {canAvailability ? (
            <Button variant="ghost" size="sm" onClick={() => setPeriodicFor({ id: row.id, title: "周期冷却 · " + row.name })}>
              <ACTION_ICONS.periodic className="h-3.5 w-3.5" /> 周期
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className="text-danger-text" onClick={() => setDeleting(row)}>
            <ACTION_ICONS.delete className="h-3.5 w-3.5" /> 删除
          </Button>
        </div>
      ),
    } as ModelColumn<PublicModel>] : []),
  ];

  const runBatch = (action: "enable" | "disable" | "delete") => {
    batch.mutate({ ids: Array.from(selected), action });
    setSelected(new Set());
    setBatchDelete(false);
  };

  const toolbarEnd = canWrite && selected.size > 0 ? (
    <>
      <span className="text-2xs text-faint">已选 <span className="tnum font-medium text-title">{selected.size}</span></span>
      <Button variant="outline" size="sm" disabled={batch.isPending} onClick={() => runBatch("enable")}>
        <ACTION_ICONS.enable className="h-3.5 w-3.5" /> 批量启用
      </Button>
      <Button variant="outline" size="sm" disabled={batch.isPending} onClick={() => runBatch("disable")}>
        <ACTION_ICONS.disable className="h-3.5 w-3.5" /> 批量关闭
      </Button>
      <Button variant="ghost" size="sm" className="text-danger-text" disabled={batch.isPending} onClick={() => setBatchDelete(true)}>
        <ACTION_ICONS.delete className="h-3.5 w-3.5" /> 批量删除
      </Button>
      <Button variant="ghost" size="sm" disabled={batch.isPending} onClick={() => setSelected(new Set())}>
        <ACTION_ICONS.clear className="h-3.5 w-3.5" /> 清除选择
      </Button>
    </>
  ) : null;

  return (
    <div className="space-y-3">
      <p className="text-2xs text-faint">
        公开模型是运营对外发放的别名：策略 + 成员（priority / weight）+ 可用性。关闭是人工长期措施，冷却到期自动恢复。
        {ENABLE_SEMANTICS_NOTE}
      </p>
      <ModelsTable<PublicModel>
        columns={columns}
        rows={rows}
        totalCount={allItems.length}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        storageKey="slipstream.cols.models"
        tabKey="public"
        searchText={search}
        onSearchChange={setSearch}
        searchPlaceholder="搜索公开名、备注或成员"
        toolbarEnd={toolbarEnd}
        emptyText="还没有公开模型"
        emptyAction={canWrite ? <Button size="sm" onClick={() => setDialog({ open: true, initial: null })}>新建公开模型</Button> : undefined}
        onClearFilters={() => setSearch("")}
      />
      {dialog.open ? (
        <PublicModelDialog
          initial={dialog.initial}
          upstreamModels={qModels.data?.items ?? []}
          onClose={() => setDialog({ open: false, initial: null })}
        />
      ) : null}
      {membersFor !== null ? (
        <MembersDialog model={membersFor} upstreamModels={qModels.data?.items ?? []} onClose={() => setMembersFor(null)} />
      ) : null}
      {cooldownFor !== null ? (
        <CooldownDialog
          title={"冷却公开模型 · " + cooldownFor.name}
          pending={availability.isPending}
          onConfirm={(deadline, note) => {
            availability.mutate({ id: cooldownFor.id, action: "cooldown", cooldown_until_ms: deadline, note });
            setCooldownFor(null);
          }}
          onClose={() => setCooldownFor(null)}
        />
      ) : null}
      {periodicFor !== null ? (
        <PeriodicCooldownDialog
          title={periodicFor.title}
          scope="public_model"
          scopeId={periodicFor.id}
          rules={(rulesQuery.data ?? []).filter((rule) => rule.scope === "public_model" && rule.scope_id === periodicFor.id)}
          onClose={() => setPeriodicFor(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title={"删除公开模型 " + (deleting?.name ?? "") + "？"}
        description="成员关系会级联删除；历史计费流水保留。此操作不可逆。"
        confirmLabel="确认删除"
        destructive
        onConfirm={() => { if (deleting !== null) del.mutate(deleting.id); }}
      />
      {batchDelete ? (
        <BatchDeleteDialog
          count={selected.size}
          subject="公开模型"
          pending={batch.isPending}
          onConfirm={() => runBatch("delete")}
          onClose={() => setBatchDelete(false)}
        />
      ) : null}
    </div>
  );
}

export function ModelsPage() {
  const [params] = useSearchParams();
  const initialKey = params.get("tab") === "public" ? "public" : "upstream";
  return (
    <Tabs
      initialKey={initialKey}
      items={[
        { key: "upstream", label: "上游模型", content: <UpstreamTab /> },
        { key: "public", label: "公开模型", content: <PublicTab /> },
      ]}
    />
  );
}
