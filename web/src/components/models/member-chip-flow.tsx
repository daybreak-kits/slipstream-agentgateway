import { useMemo, useState } from "react";

import {
  type CandidateGroup,
  type MemberChip,
  candidateGroups,
  conditionalMultiKeyHint,
  filterCandidateGroups,
  memberLabeler,
  memberLayers,
} from "@/components/models/member-chip";
import { type MemberDraft, nextPriority } from "@/components/models/member-drafts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACTION_ICONS } from "@/lib/icons";
import { useUpstreams } from "@/lib/use-upstreams";
import type { RoutingMode, UpstreamModel } from "@/types";

/** 分层提示：同层语义随渲染策略变化（failover 平权 / weighted 比例 / conditional 顺序）。 */
const LAYER_NOTES: Record<RoutingMode, string> = {
  failover: "同层 P2C 平权（带偏置随机）",
  weighted: "同层按 weight 整数比例分配",
  conditional: "按 when 顺序 first-match",
};

/**
 * 行内字段提示：行内编辑只渲染当前策略适用的字段（票15）——priority 永远在；
 * weight 仅 weighted、when 仅 conditional，其余模式完全不渲染（不是 disabled 摆着）。
 */
const FIELD_HINTS = {
  priority: "数值小优先；同值即同层",
  weight: "整数比例，如 1 与 3 = 1:3",
  when: "CEL 谓词；末位留空即兜底",
} as const;

/**
 * 候选 chip 渲染预算：几百上游、上千模型时两栏高度由 max-height 兜底，但 DOM 仍会
 * 随候选线性膨胀；未搜索时先只渲染前 120 个并提供「展开全部」（搜索本身在缩小集合，
 * 截断反而藏结果，故搜索时全量渲染）。
 */
const CANDIDATE_CHIP_BUDGET = 120;

export interface MemberChipFlowProps {
  members: MemberDraft[];
  upstreamModels: UpstreamModel[];
  /** 服务端 targets 的 id → 名称兜底（上游模型列表不含已被删除的引用行时仍可显示）。 */
  fallbackNames: Map<string, string>;
  mode: RoutingMode;
  onChange: (next: MemberDraft[]) => void;
}

interface MemberRowProps {
  chip: MemberChip;
  mode: RoutingMode;
  onPatch: (patch: Partial<MemberDraft>) => void;
  onRemove: () => void;
}

/** 已选成员行：每模型一行，行内直接编辑当前策略字段；脏态走页头体系（整页单 PATCH）。 */
function MemberRow({ chip, mode, onPatch, onRemove }: MemberRowProps) {
  const { member } = chip;
  return (
    <div
      data-slot="member-row"
      data-upstream-model-id={member.upstream_model_id}
      data-fallback={chip.fallback ? "true" : "false"}
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-border bg-surface px-2 py-1.5"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {mode === "conditional" ? (
          <span
            data-slot="chip-order"
            title={"顺序 " + chip.order}
            className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-surface-2 px-1 text-2xs text-faint tnum"
          >
            {chip.order}
          </span>
        ) : null}
        <span
          data-slot="member-row-label"
          title={chip.label}
          className="min-w-0 max-w-[14rem] truncate font-mono text-2sm text-body"
        >
          {chip.label}
        </span>
        {chip.fallback ? (
          <Badge tone="info" data-slot="chip-fallback">
            末位兜底
          </Badge>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1">
          <span className="shrink-0 text-2xs text-faint">priority</span>
          <Input
            aria-label="priority"
            inputMode="numeric"
            placeholder="1"
            title={FIELD_HINTS.priority}
            className="w-14 tnum"
            value={member.priority}
            onChange={(event) => onPatch({ priority: event.target.value })}
          />
        </span>
        {mode === "weighted" ? (
          <span className="flex items-center gap-1">
            <span className="shrink-0 text-2xs text-faint">weight</span>
            <Input
              aria-label="weight"
              inputMode="numeric"
              placeholder="0"
              title={FIELD_HINTS.weight}
              className="w-14 tnum"
              value={member.weight}
              onChange={(event) => onPatch({ weight: event.target.value })}
            />
          </span>
        ) : null}
        {mode === "conditional" ? (
          <span className="flex min-w-[12rem] flex-1 items-center gap-1">
            <span className="shrink-0 text-2xs text-faint">when</span>
            <Input
              aria-label="when"
              placeholder={'request.tier == "pro"'}
              title={FIELD_HINTS.when}
              className="min-w-0 flex-1"
              value={member.when}
              onChange={(event) => onPatch({ when: event.target.value })}
            />
          </span>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="dense"
        data-slot="member-row-remove"
        className="shrink-0 text-faint hover:bg-danger-soft hover:text-danger-text"
        title="移除成员"
        aria-label={"移除 " + chip.label}
        onClick={onRemove}
      >
        <ACTION_ICONS.clear aria-hidden="true" className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * 成员编排左 6 右 6（W6 ticket 15 行内编辑落地）：左栏已选成员按 priority 升序
 * 分层展示为「第 N 层」区块，每个模型一行，行内只渲染并允许编辑当前策略字段
 * （failover 只 priority、weighted 加 weight、conditional 加 when，非当前策略字段
 * 完全不渲染）；右栏候选按上游渠道分组为 chip，搜索框固定在滚动区外，点 chip 即
 * 加入。改 priority 即换层，conditional 末位兜底由排序 + 末位校验保证（见
 * member-drafts.validateMembers），不引入拖拽库。保存语义不变：草稿 members 与
 * 整页一起走单 PATCH，脏态由页头 DirtyCount 呈现。
 */
export function MemberChipFlow({
  members,
  upstreamModels,
  fallbackNames,
  mode,
  onChange,
}: MemberChipFlowProps) {
  const upstreams = useUpstreams();
  const [needle, setNeedle] = useState("");
  const [expanded, setExpanded] = useState(false);

  const labelOf = useMemo(() => memberLabeler(upstreamModels, fallbackNames), [upstreamModels, fallbackNames]);
  const layers = useMemo(() => memberLayers(members, labelOf, mode), [members, labelOf, mode]);
  const e20Hint = useMemo(
    () => (mode === "conditional" ? conditionalMultiKeyHint(members, upstreamModels, upstreams) : null),
    [mode, members, upstreamModels, upstreams],
  );
  const joinedIds = useMemo(() => new Set(members.map((member) => member.upstream_model_id)), [members]);
  const groups = useMemo(
    () =>
      filterCandidateGroups(
        candidateGroups(upstreamModels.filter((model) => !joinedIds.has(model.id))),
        needle,
      ),
    [upstreamModels, joinedIds, needle],
  );
  const totalCandidates = useMemo(() => groups.reduce((sum, group) => sum + group.models.length, 0), [groups]);
  const searching = needle.trim() !== "";
  const budget = searching || expanded ? Number.POSITIVE_INFINITY : CANDIDATE_CHIP_BUDGET;
  const truncated = !searching && totalCandidates > CANDIDATE_CHIP_BUDGET;
  const visibleGroups = useMemo(() => {
    let remaining = budget;
    const shown: CandidateGroup[] = [];
    for (const group of groups) {
      if (remaining <= 0) break;
      const models = group.models.slice(0, remaining);
      remaining -= models.length;
      shown.push(models.length === group.models.length ? group : { ...group, models });
    }
    return shown;
  }, [groups, budget]);

  const updateByIndex = (index: number, patch: Partial<MemberDraft>) => {
    onChange(members.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  };
  const removeByIndex = (index: number) => {
    onChange(members.filter((_, i) => i !== index));
  };
  const addModel = (upstreamModelId: string) => {
    onChange([
      ...members,
      { upstream_model_id: upstreamModelId, priority: String(nextPriority(members)), weight: "", when: "" },
    ]);
  };

  return (
    <div className="space-y-3" data-slot="member-chip-flow">
      {/* 票14 容器骨架：桌面左 6 右 6（左=已选成员行，右=候选分组），窄屏上下堆叠；
       * 两栏各自 max-h min(60vh,560px) 内部滚动，列头与候选搜索固定在滚动区外。 */}
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
            {members.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-2xs text-faint" data-slot="member-empty">
                暂无成员；从右侧候选区点击 chip 加入。
              </p>
            ) : null}
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
                  <div className="space-y-1.5">
                    {layer.chips.map((chip) => (
                      <MemberRow
                        key={chip.index}
                        chip={chip}
                        mode={mode}
                        onPatch={(patch) => updateByIndex(chip.index, patch)}
                        onRemove={() => removeByIndex(chip.index)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>

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
            <Input
              aria-label="搜索上游渠道或模型"
              placeholder="搜索上游渠道或模型"
              title="按上游渠道或模型名过滤候选"
              className="w-44"
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
            />
            <span className="text-2xs text-faint">已加入 {members.length} 个成员</span>
          </div>
          <div data-slot="member-scroll" className="max-h-[min(60vh,560px)] overflow-y-auto pr-0.5">
            <div data-slot="member-candidates" className="space-y-2 rounded-md border border-border bg-surface p-2">
              {visibleGroups.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-3 text-2xs text-faint" data-slot="candidate-empty">
                  {searching
                    ? "没有匹配的候选；换个关键词试试。"
                    : "没有可加入的候选：全部上游模型都已加入成员，或先在上游渠道登记模型。"}
                </p>
              ) : null}
              {visibleGroups.map((group) => (
                <section key={group.key} data-slot="member-candidate-group" data-upstream-id={group.key}>
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <h4 className="text-2sm font-medium text-title">{group.name}</h4>
                    <span className="text-2xs text-faint">{group.models.length} 个模型</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.models.map((model) => {
                      const label = labelOf(model.id);
                      return (
                        <Button
                          key={model.id}
                          variant="ghost"
                          data-slot="member-candidate-chip"
                          data-upstream-model-id={model.id}
                          className="inline-flex h-auto max-w-full min-w-0 items-center justify-start gap-1 overflow-hidden rounded-full border border-dashed border-border px-2 py-1 text-left text-2sm font-normal text-body hover:border-primary hover:bg-primary-soft hover:text-primary-text"
                          title={"加入成员 " + label}
                          aria-label={"加入成员 " + label}
                          onClick={() => addModel(model.id)}
                        >
                          <ACTION_ICONS.add aria-hidden="true" className="h-3 w-3 shrink-0" />
                          <span className="min-w-0 truncate font-mono">{label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {truncated ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="dense" onClick={() => setExpanded((value) => !value)}>
                    {expanded ? "收起，仅显示前 " + CANDIDATE_CHIP_BUDGET + " 个" : "展开全部 " + totalCandidates + " 个候选"}
                  </Button>
                  <span className="text-2xs text-faint">候选较多，先渲染前 {CANDIDATE_CHIP_BUDGET} 个。</span>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
