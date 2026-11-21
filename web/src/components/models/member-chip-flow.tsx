import { useMemo, useState } from "react";

import { Field } from "@/components/models/field";
import {
  conditionalMultiKeyHint,
  memberLabeler,
  memberLayers,
} from "@/components/models/member-chip";
import { type MemberDraft, nextPriority } from "@/components/models/member-drafts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ACTION_ICONS } from "@/lib/icons";
import { useUpstreams } from "@/lib/use-upstreams";
import { cn } from "@/lib/utils";
import type { RoutingMode, UpstreamModel } from "@/types";

/** 分层提示：同层语义随渲染策略变化（failover 平权 / weighted 比例 / conditional 顺序）。 */
const LAYER_NOTES: Record<RoutingMode, string> = {
  failover: "同层 P2C 平权（带偏置随机）",
  weighted: "同层按 weight 整数比例分配",
  conditional: "按 when 顺序 first-match",
};

export interface MemberChipEditorProps {
  member: MemberDraft;
  label: string;
  mode: RoutingMode;
  onChange: (patch: Partial<MemberDraft>) => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * 点击 chip 展开的内联编辑器：priority 永远可改，weight 仅 weighted、when 仅
 * conditional 可改（其余模式禁用，避免误导）。收起由页面层的「完成」触发，
 * 与 ticket 13 的 DraftFields 语义一致：只改草稿，保存仍走整页单 PATCH。
 */
export function MemberChipEditor({
  member,
  label,
  mode,
  onChange,
  onRemove,
  onClose,
}: MemberChipEditorProps) {
  return (
    <div
      data-slot="member-chip-editor"
      className="space-y-2 rounded-md border border-primary/40 bg-surface p-2 shadow-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-2sm text-title" title={label}>
          {label}
        </span>
        <Button variant="secondary" size="dense" onClick={onClose}>
          完成
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="priority" hint="数值小优先；同值即同层">
          <Input
            aria-label="priority"
            inputMode="numeric"
            placeholder="1"
            value={member.priority}
            onChange={(event) => onChange({ priority: event.target.value })}
          />
        </Field>
        <Field label="weight" hint={mode === "weighted" ? "整数比例，如 1 与 3 = 1:3" : "仅 weighted 模式生效"}>
          <Input
            aria-label="weight"
            inputMode="numeric"
            placeholder="0"
            value={member.weight}
            disabled={mode !== "weighted"}
            onChange={(event) => onChange({ weight: event.target.value })}
          />
        </Field>
        <Field label="when 条件" hint={mode === "conditional" ? "CEL 谓词；末位留空即兜底" : "仅 conditional 模式生效"}>
          <Input
            aria-label="when"
            placeholder="request.tier == &quot;pro&quot;"
            value={member.when}
            disabled={mode !== "conditional"}
            onChange={(event) => onChange({ when: event.target.value })}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" size="dense" className="text-danger-text" onClick={onRemove}>
          <ACTION_ICONS.clear aria-hidden="true" className="h-3.5 w-3.5" /> 移除成员
        </Button>
      </div>
    </div>
  );
}

export interface MemberChipFlowProps {
  members: MemberDraft[];
  upstreamModels: UpstreamModel[];
  /** 服务端 targets 的 id → 名称兜底（上游模型列表不含已被删除的引用行时仍可显示）。 */
  fallbackNames: Map<string, string>;
  mode: RoutingMode;
  onChange: (next: MemberDraft[]) => void;
}

/**
 * 成员编排 chip 流（W5 ticket 14）：按 priority 分层展示为「第 N 层」chip，
 * 同层 P2C 平权；conditional 每个 chip 带顺序徽标、末位兜底有独立标签。
 * 点击 chip 展开内联编辑器改 priority/weight/when；候选区用 Combobox 搜索
 * 上游渠道/模型后「加入成员」，已加入的成员不再出现在候选里。
 *
 * 不引入拖拽库：priority 就是层的唯一来源，改 priority 即换层，兜底由
 * 排序 + 末位校验保证（见 member-drafts.validateMembers）。
 */
export function MemberChipFlow({
  members,
  upstreamModels,
  fallbackNames,
  mode,
  onChange,
}: MemberChipFlowProps) {
  const upstreams = useUpstreams();
  const [pick, setPick] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const labelOf = useMemo(() => memberLabeler(upstreamModels, fallbackNames), [upstreamModels, fallbackNames]);
  const layers = useMemo(() => memberLayers(members, labelOf, mode), [members, labelOf, mode]);
  const e20Hint = useMemo(
    () => (mode === "conditional" ? conditionalMultiKeyHint(members, upstreamModels, upstreams) : null),
    [mode, members, upstreamModels, upstreams],
  );
  const joinedIds = useMemo(() => new Set(members.map((member) => member.upstream_model_id)), [members]);
  const candidateOptions = useMemo(
    () =>
      upstreamModels
        .filter((model) => !joinedIds.has(model.id))
        .map((model) => ({
          value: model.id,
          label: labelOf(model.id),
          description: "上游渠道 " + model.upstream_name,
        })),
    [upstreamModels, joinedIds, labelOf],
  );
  const editing = editingIndex === null ? null : members[editingIndex] ?? null;

  const updateByIndex = (index: number, patch: Partial<MemberDraft>) => {
    onChange(members.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  };
  const removeById = (upstreamModelId: string) => {
    onChange(members.filter((member) => member.upstream_model_id !== upstreamModelId));
    setEditingIndex(null);
  };
  const addModel = (upstreamModelId: string) => {
    onChange([
      ...members,
      { upstream_model_id: upstreamModelId, priority: String(nextPriority(members)), weight: "", when: "" },
    ]);
    setEditingIndex(members.length);
  };

  return (
    <div className="space-y-3" data-slot="member-chip-flow">
      {/* W6 ticket 14 容器骨架：桌面左 6 右 6（左=已选成员层，右=候选），窄屏上下堆叠；
       * 两栏各自 max-h min(60vh,560px) 内部滚动，列头固定在滚动区外。行内编辑字段与
       * 候选分组 chip 归下一票；本票保持现有 chip 流与 Combobox 候选可用。 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12" data-slot="member-board-grid">
        <section data-slot="member-board-left" className="min-w-0 lg:col-span-6">
          <div
            data-slot="member-column-head"
            data-column="left"
            className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1"
          >
            <h4 className="text-2sm font-medium text-title">已选成员</h4>
            <span className="text-2xs text-faint">
              共 {members.length} 个成员，{layers.length} 层；{LAYER_NOTES[mode]}
            </span>
          </div>
          <div data-slot="member-scroll" className="max-h-[min(60vh,560px)] overflow-y-auto pr-0.5">
            {layers.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-2xs text-faint" data-slot="member-empty">
                暂无成员；从右侧候选区选择上游模型加入。
              </p>
            ) : null}
            <p className="mb-2 text-2xs text-faint">点击 chip 编辑 priority / weight / when。</p>
            <div className="space-y-2">
              {layers.map((layer) => (
                <section
                  key={layer.priority}
                  data-slot="member-layer"
                  data-priority={layer.priority}
                  className="rounded-md border border-border bg-surface-2/40 p-2"
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <h4 className="text-2sm font-medium text-title">{layer.title}</h4>
                    <Badge tone="neutral" className="tnum">
                      priority {layer.priority}
                    </Badge>
                    <span className="text-2xs text-faint">{layer.chips.length} 个成员</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {layer.chips.map((chip) => (
                      <div key={chip.index} data-slot="member-chip-group" className="inline-flex max-w-full items-stretch">
                        {/* chip 本体就是「编辑该成员」按钮：点名字、顺序徽标、weight/when 都展开编辑器；移除是相邻的独立按钮（避免按钮嵌套）。 */}
                        <Button
                          variant="ghost"
                          data-slot="member-chip"
                          data-upstream-model-id={chip.member.upstream_model_id}
                          data-fallback={chip.fallback ? "true" : "false"}
                          className={cn(
                            "inline-flex h-auto max-w-full min-w-0 items-center justify-start gap-1 overflow-hidden rounded-l-full rounded-r-none border border-r-0 px-2 py-1 text-left text-2sm font-normal",
                            chip.fallback
                              ? "border-info/50 bg-info-soft text-info-text hover:border-info hover:bg-info-soft"
                              : "border-border bg-surface text-body hover:border-border-strong hover:bg-surface-2",
                            editingIndex === chip.index && "ring-1 ring-primary",
                          )}
                          title={"编辑 " + chip.label}
                          aria-label={"编辑成员 " + chip.label}
                          onClick={() => setEditingIndex(chip.index === editingIndex ? null : chip.index)}
                        >
                          {mode === "conditional" ? (
                            <span
                              data-slot="chip-order"
                              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-2 px-1 text-2xs text-faint tnum"
                              title={"顺序 " + chip.order}
                            >
                              {chip.order}
                            </span>
                          ) : null}
                          <span data-slot="member-chip-label" className="min-w-0 truncate font-mono">
                            {chip.label}
                          </span>
                          {mode === "weighted" ? (
                            <span data-slot="chip-weight" className="text-2xs text-faint">
                              weight {chip.member.weight.trim() === "" ? "0" : chip.member.weight}
                            </span>
                          ) : null}
                          {mode === "conditional" && chip.member.when.trim() !== "" ? (
                            <span data-slot="chip-when" className="max-w-[14rem] truncate text-2xs text-faint" title={chip.member.when}>
                              when {chip.member.when}
                            </span>
                          ) : null}
                          {chip.fallback ? (
                            <Badge tone="info" data-slot="chip-fallback">
                              末位兜底
                            </Badge>
                          ) : null}
                        </Button>
                        <Button
                          variant="ghost"
                          data-slot="member-chip-remove"
                          className={cn(
                            "inline-flex h-auto items-center rounded-l-none rounded-r-full border border-l-0 px-1.5 py-1",
                            chip.fallback
                              ? "border-info/50 bg-info-soft/60 text-info-text hover:bg-danger-soft hover:text-danger-text"
                              : "border-border bg-surface text-faint hover:bg-danger-soft hover:text-danger-text",
                          )}
                          title="移除成员"
                          aria-label={"移除 " + chip.label}
                          onClick={() => removeById(chip.member.upstream_model_id)}
                        >
                          <ACTION_ICONS.clear aria-hidden="true" className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {editing !== null && editingIndex !== null ? (
              <div className="mt-2">
                <MemberChipEditor
                  member={editing}
                  label={labelOf(editing.upstream_model_id)}
                  mode={mode}
                  onChange={(patch) => updateByIndex(editingIndex, patch)}
                  onRemove={() => removeById(editing.upstream_model_id)}
                  onClose={() => setEditingIndex(null)}
                />
              </div>
            ) : null}

            {e20Hint !== null ? (
              <p className="mt-2 text-2xs text-warning-text" data-slot="e20-hint">
                {e20Hint}
              </p>
            ) : null}
          </div>
        </section>

        <section data-slot="member-board-right" className="min-w-0 lg:col-span-6">
          <div
            data-slot="member-column-head"
            data-column="right"
            className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1"
          >
            <h4 className="text-2sm font-medium text-title">候选成员</h4>
            <span className="text-2xs text-faint">已加入 {members.length} 个成员</span>
          </div>
          <div data-slot="member-scroll" className="max-h-[min(60vh,560px)] overflow-y-auto pr-0.5">
            <div data-slot="member-candidates" className="space-y-2 rounded-md border border-border bg-surface p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Combobox
                  className="w-64 max-w-full"
                  ariaLabel="搜索上游渠道或模型"
                  placeholder="选择上游模型加入"
                  searchPlaceholder="搜索上游渠道或模型"
                  emptyText="没有匹配的上游模型"
                  value={pick}
                  options={candidateOptions}
                  onChange={setPick}
                />
                <Button
                  data-slot="member-candidate-add"
                  variant="outline"
                  size="sm"
                  disabled={pick === ""}
                  onClick={() => {
                    if (pick === "") return;
                    addModel(pick);
                    setPick("");
                  }}
                >
                  <ACTION_ICONS.add aria-hidden="true" className="h-3.5 w-3.5" /> 加入成员
                </Button>
              </div>
              <p className="text-2xs text-faint">priority / weight / when 在左侧成员 chip 上编辑。</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
