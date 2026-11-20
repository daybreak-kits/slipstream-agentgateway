import type { MemberDraft } from "@/components/models/member-drafts";
import { toInt } from "@/components/models/model-vocab";
import type { RoutingMode, Upstream, UpstreamModel } from "@/types";

/**
 * 公开模型成员编排的展示与分组纯逻辑（W5 ticket 14）。
 *
 * 成员展示名统一为「上游渠道/模型」（如 zai-01/glm-5.3），与 GLOSSARY 一致：
 * 不再用 ticket 13 的「模型名 · 上游名」。这里只做纯函数，SSR 门禁
 * （check-semantic-dirty.mjs 第 9 段）直接断言返回值，组件只负责渲染。
 */

/** 成员展示名统一为「上游渠道/模型」；上游渠道缺失时只显示模型名。 */
export function memberChipLabel(upstreamName: string | undefined, modelName: string): string {
  const channel = (upstreamName ?? "").trim();
  const model = modelName.trim();
  return channel === "" ? model : channel + "/" + model;
}

/** 成员 id → 展示名；上游模型列表缺失时回退服务端 join 名或 id。 */
export function memberLabeler(
  upstreamModels: UpstreamModel[],
  fallbackNames: Map<string, string>,
): (upstreamModelId: string) => string {
  const byId = new Map(upstreamModels.map((model) => [model.id, model]));
  return (upstreamModelId) => {
    const model = byId.get(upstreamModelId);
    if (model) return memberChipLabel(model.upstream_name, model.name);
    return fallbackNames.get(upstreamModelId) ?? upstreamModelId;
  };
}

export interface MemberChip {
  member: MemberDraft;
  /** 草稿下标：编辑态按它定位成员（分层只改展示顺序，不改草稿顺序）。 */
  index: number;
  label: string;
  /** 分层后的全局 1-based 顺序：conditional 的顺序徽标。 */
  order: number;
  /** conditional 末位兜底成员（when 留空）。 */
  fallback: boolean;
}

export interface MemberLayer {
  priority: number;
  /** 「第 N 层」：同 priority 即同层，failover 下同层 P2C 平权。 */
  title: string;
  chips: MemberChip[];
}

function chipsOf(members: MemberDraft[], labelOf: (upstreamModelId: string) => string): MemberChip[] {
  return members
    .map((member, index) => ({
      member,
      index,
      label: labelOf(member.upstream_model_id),
      order: index + 1,
      fallback: false,
    }))
    .sort((left, right) => toInt(left.member.priority) - toInt(right.member.priority));
}

function fallbackOf(sortedChips: MemberChip[], mode: RoutingMode): MemberChip | null {
  if (mode !== "conditional") return null;
  const last = sortedChips[sortedChips.length - 1];
  return last !== undefined && last.member.when.trim() === "" ? last : null;
}

/** 按 priority 升序分层：同 priority 归入同一层，层内保持草稿顺序；order 是全局顺序。 */
export function memberLayers(
  members: MemberDraft[],
  labelOf: (upstreamModelId: string) => string,
  mode: RoutingMode,
): MemberLayer[] {
  const sorted = chipsOf(members, labelOf);
  sorted.forEach((chip, index) => {
    chip.order = index + 1;
  });
  const fallback = fallbackOf(sorted, mode);
  if (fallback !== null) fallback.fallback = true;
  const layers: MemberLayer[] = [];
  for (const chip of sorted) {
    const priority = toInt(chip.member.priority);
    const last = layers[layers.length - 1];
    if (last !== undefined && last.priority === priority) last.chips.push(chip);
    else layers.push({ priority, title: "第 " + (layers.length + 1) + " 层", chips: [chip] });
  }
  return layers;
}

/** conditional 末位兜底成员：按 priority 排序后的最后一位且 when 留空；其他模式为 null。 */
export function conditionalFallback(
  members: MemberDraft[],
  labelOf: (upstreamModelId: string) => string,
  mode: RoutingMode,
): MemberChip | null {
  return fallbackOf(chipsOf(members, labelOf), mode);
}

export interface CandidateGroup {
  key: string;
  /** 上游渠道名（分组标题）。 */
  name: string;
  models: UpstreamModel[];
}

/** 候选成员按上游渠道分组：组名与组内模型名都按名称升序。 */
export function candidateGroups(upstreamModels: UpstreamModel[]): CandidateGroup[] {
  const byUpstream = new Map<string, UpstreamModel[]>();
  for (const model of upstreamModels) {
    const key = model.upstream_id || model.upstream_name || "unknown";
    const list = byUpstream.get(key);
    if (list === undefined) byUpstream.set(key, [model]);
    else list.push(model);
  }
  return [...byUpstream.entries()]
    .map(([key, models]) => ({
      key,
      name: models[0]?.upstream_name ?? key,
      models: [...models].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** 搜索候选：上游渠道名命中保留整组，否则只按模型名过滤；关键词大小写不敏感。 */
export function filterCandidateGroups(groups: CandidateGroup[], needle: string): CandidateGroup[] {
  const keyword = needle.trim().toLowerCase();
  if (keyword === "") return groups;
  return groups.flatMap((group) => {
    const channelHit = group.name.toLowerCase().includes(keyword);
    const models = channelHit ? group.models : group.models.filter((model) => model.name.toLowerCase().includes(keyword));
    return models.length > 0 ? [{ ...group, models }] : [];
  });
}

/**
 * E20（P0-RESULTS §E20）：conditional 模式 × 成员引用的上游配了多把密钥 →
 * AG conditional targets first-match 首条独占，密钥平权与密钥级容错不生效，
 * 渲染时每目标只使用第一把密钥。key_count 缺失（旧载荷）时按未知处理，不误报。
 */
export function conditionalMultiKeyHint(
  members: MemberDraft[],
  upstreamModels: UpstreamModel[],
  upstreams: Upstream[],
): string | null {
  const multiKey = members.some((member) => {
    const model = upstreamModels.find((item) => item.id === member.upstream_model_id);
    const upstream = upstreams.find((item) => item.id === model?.upstream_id);
    return (upstream?.key_count ?? 0) > 1;
  });
  return multiKey
    ? "conditional 模式下密钥平权与密钥级容错不生效（E20），每目标仅使用第一把密钥"
    : null;
}
