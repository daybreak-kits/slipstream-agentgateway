import { toInt } from "@/components/models/model-vocab";
import type { PublicModel, RoutingMode } from "@/types";

/** 成员编排草稿行：weight 留空 = 未设置（提交时按 0 写入，现有 PUT 语义）。 */
export interface MemberDraft {
  upstream_model_id: string;
  priority: string;
  weight: string;
  when: string;
}

export function memberDraftsOf(model: PublicModel): MemberDraft[] {
  return (model.targets ?? []).map((t) => ({
    upstream_model_id: t.upstream_model_id ?? "",
    priority: String(t.priority ?? 1),
    weight: t.weight === null || t.weight === undefined ? "" : String(t.weight),
    when: t.when ?? "",
  }));
}

export function nextPriority(members: MemberDraft[]): number {
  let max = 0;
  for (const member of members) max = Math.max(max, toInt(member.priority));
  return max + 1;
}

/** PATCH /admin/public-models/{id} 的 targets 整批替换 payload（按 priority 升序提交，ticket 12）。 */
export function targetsPayload(members: MemberDraft[]): Array<{
  upstream_model_id: string;
  priority: number;
  weight: number;
  when: string;
}> {
  return members
    .map((member) => ({
      upstream_model_id: member.upstream_model_id,
      priority: toInt(member.priority),
      weight: member.weight.trim() === "" ? 0 : toInt(member.weight),
      when: member.when.trim(),
    }))
    .sort((a, b) => a.priority - b.priority);
}

export function validateMembers(members: MemberDraft[], mode: RoutingMode): string[] {
  const errors: string[] = [];
  if (members.length === 0) errors.push("至少保留 1 个成员");
  const seen = new Set<string>();
  for (const member of members) {
    if (!member.upstream_model_id) errors.push("成员缺少上游模型");
    if (seen.has(member.upstream_model_id)) errors.push("成员重复");
    seen.add(member.upstream_model_id);
    const priority = Number(member.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) errors.push("优先级必须是 0-100 的整数（数值小优先）");
    if (mode === "weighted") {
      const weight = Number(member.weight);
      if (!Number.isInteger(weight) || weight < 1) errors.push("加权分流模式下权重必须是 >= 1 的整数");
    }
  }
  if (mode === "conditional") {
    const sorted = [...members].sort((a, b) => Number(a.priority) - Number(b.priority));
    sorted.forEach((member, index) => {
      if (index < sorted.length - 1 && member.when.trim() === "") errors.push("条件路由模式下只有末位成员可以留空条件");
    });
  }
  return Array.from(new Set(errors));
}
