import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

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
import { MODEL_TYPES } from "@/components/models/model-vocab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACTION_ICONS } from "@/lib/icons";
import { useUpstreams } from "@/lib/use-upstreams";
import { cn } from "@/lib/utils";
import type { RoutingMode, UpstreamModel } from "@/types";

/** 分层提示：同层语义随渲染策略变化（failover 平权 / weighted 比例 / conditional 顺序）。 */
const LAYER_NOTES: Record<RoutingMode, string> = {
  failover: "同层 P2C 平权（带偏置随机）",
  weighted: "同层按权重整数比例分配",
  conditional: "按条件表达式顺序 first-match",
};

/**
 * 行内字段提示：行内编辑只渲染当前策略适用的字段（票15）——priority 永远在；
 * weight 仅 weighted、when 仅 conditional，其余模式完全不渲染（不是 disabled 摆着）。
 * W7 票05：提示不再挂在输入框 title 上，收进行内展开区（「更多配置」）。
 */
const FIELD_HINTS = {
  priority: "优先级：数值小优先；同值即同层",
  weight: "权重：整数比例，如 1 与 3 = 1:3（仅加权分流模式使用）",
  when: "条件：CEL 谓词；末位留空即兜底（仅条件路由模式使用）",
} as const;

/**
 * 成员卡列模板（W9：底部成员编辑改为横向小卡片，每张卡都有优先级/权重/条件与删除按钮）；
 * 窄屏同一套 DOM 退化为卡片堆叠，模板只在 lg 以上生效。
 * 列：展开 | 优先级 | 权重 | 条件 | 成员/上游 | 移除。
 */
const ROW_GRID = "lg:grid-cols-[2rem_4.5rem_4.5rem_minmax(6.5rem,1fr)_minmax(0,1.15fr)_2rem]";

/**
 * 候选 chip 渲染预算：几百上游、上千模型时两栏高度由 max-height 兜底，但 DOM 仍会
 * 随候选线性膨胀；未搜索时先只渲染前 120 个并提供「展开全部」（搜索本身在缩小集合，
 * 截断反而藏结果，故搜索时全量渲染）。W7 票05：已选成员不再从候选中过滤，
 * 原地灰显也计入预算。
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

/** 窄屏卡片模式下的行内字段标签（桌面由表头提供，lg 起隐藏）。 */
function CellLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-2xs text-faint lg:hidden">{children}</span>;
}

/** 单元格的窄屏卡片定位：首行放 chevron/成员/移除，输入整行铺开；lg 起回归表格列。 */
const CELL_CARD = "col-span-3 col-start-1 lg:col-auto lg:row-auto";
const CELL_CARD_ROW1 = "lg:col-auto lg:row-auto";

interface MemberRowProps {
  chip: MemberChip;
  mode: RoutingMode;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<MemberDraft>) => void;
  onRemove: () => void;
}

/** 已选成员表格行：输入前置（优先级 → 权重/表达式 → 成员/上游），chevron 展开更多配置；脏态走页头体系（整页单 PATCH）。 */
function MemberRow({ chip, mode, expanded, onToggle, onPatch, onRemove }: MemberRowProps) {
  const { member } = chip;
  return (
    <div
      role="row"
      data-slot="member-row"
      data-upstream-model-id={member.upstream_model_id}
      data-index={chip.index}
      data-fallback={chip.fallback ? "true" : "false"}
      className={cn(
        "mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 rounded-md border border-border bg-surface p-2.5 last:mb-0",
        "lg:items-center lg:gap-2",
        ROW_GRID,
        expanded ? "rounded-b-none" : null,
      )}
    >
      <div role="cell" className={cn("flex items-center", CELL_CARD_ROW1)}>
        <Button
          variant="ghost"
          size="dense"
          data-slot="member-row-expand"
          aria-expanded={expanded}
          aria-label={(expanded ? "收起更多配置 " : "展开更多配置 ") + chip.label}
          title={expanded ? "收起更多配置" : "展开更多配置"}
          className="px-1.5 text-faint hover:text-body"
          onClick={onToggle}
        >
          <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </Button>
      </div>
      <div role="cell" className={cn("min-w-0", CELL_CARD, "row-start-2")}>
        <CellLabel>优先级</CellLabel>
        <Input
          aria-label="优先级"
          inputMode="numeric"
          placeholder="1"
          title={FIELD_HINTS.priority}
          className="w-full tnum"
          value={member.priority}
          onChange={(event) => onPatch({ priority: event.target.value })}
        />
      </div>
      {/* W9：每张成员卡都展示优先级/权重/条件三项；非当前策略的字段禁用（不隐藏），
          让「这张卡能配什么」一眼可见，也不会让行高随策略变化。 */}
      <div role="cell" className={cn("min-w-0", CELL_CARD, "row-start-3")}>
        <CellLabel>权重</CellLabel>
        <Input
          aria-label="权重"
          inputMode="numeric"
          placeholder="0"
          title={FIELD_HINTS.weight}
          className="w-full tnum"
          value={member.weight}
          disabled={mode !== "weighted"}
          onChange={(event) => onPatch({ weight: event.target.value })}
        />
      </div>
      <div role="cell" className={cn("min-w-0", CELL_CARD, "row-start-4")}>
        <CellLabel>条件</CellLabel>
        <Input
          aria-label="条件"
          placeholder={'request.tier == "pro"'}
          title={FIELD_HINTS.when}
          className="w-full"
          value={member.when}
          disabled={mode !== "conditional"}
          onChange={(event) => onPatch({ when: event.target.value })}
        />
      </div>
      <div role="cell" className={cn("min-w-0 lg:min-w-24", CELL_CARD_ROW1)}>
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
            className="min-w-0 truncate font-mono text-2sm text-body"
          >
            {chip.label}
          </span>
          {chip.fallback ? (
            <Badge tone="info" data-slot="chip-fallback">
              末位兜底
            </Badge>
          ) : null}
        </div>
      </div>
      <div role="cell" className={cn("flex items-center justify-end", CELL_CARD_ROW1)}>
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
    </div>
  );
}

interface MemberRowDetailProps {
  chip: MemberChip;
  upstreamName: string;
  typeLabel: string;
  hint: string;
}

/** 行展开区（更多配置）：承接未来扩展字段；当前放上游渠道/模型类型/成员 ID 与当前策略字段说明。 */
function MemberRowDetail({ chip, upstreamName, typeLabel, hint }: MemberRowDetailProps) {
  return (
    <div
      role="row"
      data-slot="member-row-detail"
      className="mb-2 rounded-b-md border border-t-0 border-border bg-surface-2/40 p-2.5 last:mb-0"
    >
      <div role="cell">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-2xs">
          <dt className="shrink-0 text-faint">上游渠道</dt>
          <dd className="min-w-0 truncate text-body">{upstreamName}</dd>
          <dt className="shrink-0 text-faint">模型类型</dt>
          <dd className="min-w-0 text-body">{typeLabel}</dd>
          <dt className="shrink-0 text-faint">成员 ID</dt>
          <dd className="min-w-0 break-all font-mono text-body">{chip.member.upstream_model_id}</dd>
          <dt className="shrink-0 text-faint">字段说明</dt>
          <dd className="min-w-0 text-body">{hint}</dd>
        </dl>
      </div>
    </div>
  );
}

/**
 * 成员编排左 6 右 6（W7 ticket 05 表格化）：左栏已选成员是输入前置的表格
 * （优先级/权重/表达式在前，成员信息靠后），按 priority 升序逐行展示，行内只渲染
 * 并允许编辑当前策略字段（failover 只 priority、weighted 加 weight、conditional
 * 加 when，非当前策略字段完全不渲染）；每行有显式 chevron 展开区承接更多配置。
 * 右栏候选按上游渠道分组 chip，候选始终保留原位——点击加入原地灰显、+ 变 ×，
 * 再点灰态候选取消选择；左侧已选只能点行内 × 移除。窄屏（<lg）同一套 DOM 退化为
 * 卡片堆叠，不引入横向滚动。改 priority 即换层，conditional 末位兜底由排序 +
 * 末位校验保证（见 member-drafts.validateMembers），不引入拖拽库。保存语义不变：
 * 草稿 members 与整页一起走单 PATCH，脏态由页头 DirtyCount 呈现。
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
  const [expandedAll, setExpandedAll] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const labelOf = useMemo(() => memberLabeler(upstreamModels, fallbackNames), [upstreamModels, fallbackNames]);
  const layers = useMemo(() => memberLayers(members, labelOf, mode), [members, labelOf, mode]);
  const chips = useMemo(() => layers.flatMap((layer) => layer.chips), [layers]);
  const modelById = useMemo(() => new Map(upstreamModels.map((model) => [model.id, model])), [upstreamModels]);
  const typeLabelOf = useMemo(() => {
    const labels = new Map(MODEL_TYPES.map((item) => [item.value, item.label]));
    return (upstreamModelId: string) => {
      const model = modelById.get(upstreamModelId);
      return model ? labels.get(model.model_type) ?? model.model_type : "未记录";
    };
  }, [modelById]);
  // 三张策略字段都常驻在卡片上，展开区的字段说明给出全部三项的中文口径。'
  const hint = FIELD_HINTS.priority + "；" + FIELD_HINTS.weight + "；" + FIELD_HINTS.when;
  const e20Hint = useMemo(
    () => (mode === "conditional" ? conditionalMultiKeyHint(members, upstreamModels, upstreams) : null),
    [mode, members, upstreamModels, upstreams],
  );
  const joinedIds = useMemo(() => new Set(members.map((member) => member.upstream_model_id)), [members]);
  const groups = useMemo(
    () => filterCandidateGroups(candidateGroups(upstreamModels), needle),
    [upstreamModels, needle],
  );
  const totalCandidates = useMemo(() => groups.reduce((sum, group) => sum + group.models.length, 0), [groups]);
  const searching = needle.trim() !== "";
  const budget = searching || expandedAll ? Number.POSITIVE_INFINITY : CANDIDATE_CHIP_BUDGET;
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
  const removeModel = (upstreamModelId: string) => {
    onChange(members.filter((member) => member.upstream_model_id !== upstreamModelId));
  };

  return (
    <div className="space-y-3" data-slot="member-chip-flow">
      {/* W7 票05 容器骨架（沿用 W5/W6）：桌面左 7 右 5（W9：左栏加宽让成员名可读），
       * 窄屏上下堆叠；两栏各自 max-h min(60vh,560px) 内部滚动，列头/表头与候选搜索
       * 固定在滚动区外，左右列头行等高、表头同一水平线。 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12" data-slot="member-board-grid">
        <section data-slot="member-board-left" className="min-w-0 lg:col-span-7">
          <div
            data-slot="member-column-head"
            data-column="left"
            className="mb-1.5 flex h-9 items-center justify-between gap-x-2 gap-y-1 overflow-hidden"
          >
            <h4 className="shrink-0 text-2sm font-medium text-title">已选成员</h4>
            <span className="min-w-0 truncate text-2xs text-faint">
              共 {members.length} 个成员，{layers.length} 层；{LAYER_NOTES[mode]}
            </span>
          </div>
          <div data-slot="member-scroll" className="max-h-[min(60vh,560px)] overflow-y-auto pr-0.5">
            {members.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-2xs text-faint" data-slot="member-empty">
                暂无成员；从右侧候选区点击 chip 加入。
              </p>
            ) : (
              <div role="table" aria-label="已选成员" data-slot="member-table" className="w-full">
                <div
                  role="row"
                  data-slot="member-table-head"
                  className={cn(
                    "hidden h-9 items-center gap-2 border-x border-t border-border bg-surface-2/60 px-2 lg:grid",
                    ROW_GRID,
                  )}
                >
                  <span role="columnheader" className="text-2xs font-medium text-faint">展开</span>
                  <span role="columnheader" className="text-2xs font-medium text-faint">优先级</span>
                  <span role="columnheader" className="text-2xs font-medium text-faint">权重</span>
                  <span role="columnheader" className="text-2xs font-medium text-faint">条件</span>
                  <span role="columnheader" className="text-2xs font-medium text-faint">成员 / 上游</span>
                  <span role="columnheader" className="sr-only">移除</span>
                </div>
                {chips.map((chip) => (
                  <Fragment key={chip.index}>
                    <MemberRow
                      chip={chip}
                      mode={mode}
                      expanded={expandedIndex === chip.index}
                      onToggle={() => setExpandedIndex((current) => (current === chip.index ? null : chip.index))}
                      onPatch={(patch) => updateByIndex(chip.index, patch)}
                      onRemove={() => removeByIndex(chip.index)}
                    />
                    {expandedIndex === chip.index ? (
                      <MemberRowDetail
                        chip={chip}
                        upstreamName={modelById.get(chip.member.upstream_model_id)?.upstream_name ?? "未记录"}
                        typeLabel={typeLabelOf(chip.member.upstream_model_id)}
                        hint={hint}
                      />
                    ) : null}
                  </Fragment>
                ))}
              </div>
            )}

            {e20Hint !== null ? (
              <p className="mt-2 text-2xs text-warning-text" data-slot="e20-hint">
                {e20Hint}
              </p>
            ) : null}
          </div>
        </section>

        <section data-slot="member-board-right" className="min-w-0 lg:col-span-5">
          <div
            data-slot="member-column-head"
            data-column="right"
            className="mb-1.5 flex h-9 items-center justify-between gap-x-2 gap-y-1 overflow-hidden"
          >
            <h4 className="shrink-0 text-2sm font-medium text-title">候选成员</h4>
            <Input
              aria-label="搜索上游渠道或模型"
              placeholder="搜索上游渠道或模型"
              title="按上游渠道或模型名过滤候选"
              className="w-44 shrink-0"
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
            />
            <span className="hidden min-w-0 truncate text-2xs text-faint sm:inline">已加入 {members.length} 个成员</span>
          </div>
          <div
            data-slot="member-candidate-head"
            className="mb-1.5 hidden h-9 items-center justify-between gap-2 border-b border-border px-2 text-2xs font-medium text-faint lg:flex"
          >
            <span>上游 / 模型</span>
            <span>加入 / 已选</span>
          </div>
          <div data-slot="member-scroll" className="max-h-[min(60vh,560px)] overflow-y-auto pr-0.5">
            <div data-slot="member-candidates" className="space-y-2 rounded-md border border-border bg-surface p-2">
              {visibleGroups.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-3 text-2xs text-faint" data-slot="candidate-empty">
                  {searching
                    ? "没有匹配的候选；换个关键词试试。"
                    : "没有可加入的候选：先在上游渠道登记模型。"}
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
                      const joined = joinedIds.has(model.id);
                      return (
                        <Button
                          key={model.id}
                          variant="ghost"
                          data-slot="member-candidate-chip"
                          data-upstream-model-id={model.id}
                          data-selected={joined ? "true" : "false"}
                          aria-pressed={joined}
                          className={cn(
                            "inline-flex h-auto max-w-full min-w-0 items-center justify-start gap-1 overflow-hidden rounded-full border px-2 py-1 text-left text-2sm font-normal",
                            joined
                              ? "border-solid border-border bg-surface-2 text-faint hover:border-danger hover:bg-danger-soft hover:text-danger-text"
                              : "border-dashed border-border text-body hover:border-primary hover:bg-primary-soft hover:text-primary-text",
                          )}
                          title={(joined ? "取消选择成员 " : "加入成员 ") + label}
                          aria-label={(joined ? "取消选择成员 " : "加入成员 ") + label}
                          onClick={() => (joined ? removeModel(model.id) : addModel(model.id))}
                        >
                          {joined ? (
                            <ACTION_ICONS.clear aria-hidden="true" className="h-3 w-3 shrink-0" />
                          ) : (
                            <ACTION_ICONS.add aria-hidden="true" className="h-3 w-3 shrink-0" />
                          )}
                          <span className="min-w-0 truncate font-mono">{label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {truncated ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="dense" onClick={() => setExpandedAll((value) => !value)}>
                    {expandedAll ? "收起，仅显示前 " + CANDIDATE_CHIP_BUDGET + " 个" : "展开全部 " + totalCandidates + " 个候选"}
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
