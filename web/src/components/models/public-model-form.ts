import {
  type MemberDraft,
  memberDraftsOf,
  targetsPayload,
  validateMembers,
} from "@/components/models/member-drafts";
import { toInt } from "@/components/models/model-vocab";
import type { PublicModel, RoutingMode } from "@/types";

/**
 * 公开模型单页编辑器的整页草稿（ticket 13）。
 *
 * 基本信息与成员编排同属一份草稿：页面上只有一个「保存」，提交时也只发一个
 * PATCH /admin/public-models/{id}（可选 targets，服务端单事务）——不存在
 * 「基本信息已改、成员未改」的半成功，也就没有理由再拆成两个 Tab/两个保存按钮。
 */
export interface PublicModelForm {
  name: string;
  routing_mode: RoutingMode;
  note: string;
  enabled: boolean;
  /** 成员草稿（与基本信息同一份表单状态；ticket 14 会换 chip 展示，不改提交语义）。 */
  members: MemberDraft[];
}

/** 空白/新建草稿：数据未加载时占位，baseline 为 null 时不产生脏标记。 */
export const EMPTY_PUBLIC_MODEL_FORM: PublicModelForm = {
  name: "",
  routing_mode: "failover",
  note: "",
  enabled: true,
  members: [],
};

/** 单次保存要求的两个权限键，顺序固定（页面提示按此顺序展示）。 */
export const SAVE_PERMISSIONS = ["public_models:write", "model_targets:write"] as const;

/** 缺失权限的影响范围说明（页面只读提示用）。 */
export const PERMISSION_SCOPE: Record<(typeof SAVE_PERMISSIONS)[number], string> = {
  "public_models:write": "名称、策略、备注与启用状态",
  "model_targets:write": "成员编排",
};

/** 从服务端行 hydrate 整页草稿；targets 顺序即服务端 priority 顺序。 */
export function formOf(model: PublicModel): PublicModelForm {
  return {
    name: model.name,
    routing_mode: model.routing_mode,
    note: model.note ?? "",
    enabled: model.enabled,
    members: memberDraftsOf(model),
  };
}

/**
 * 提交前规范化：名称/备注去首尾空格；成员按 priority 升序并把数字字段规整成
 * 服务端回读的字符串形态。保存成功后页面把 form 与 baseline 同时换成规范值，
 * 脏标记立即清零，也不会因为「输入 01 / 服务端回读 1」出现假脏。
 */
export function normalizeForm(form: PublicModelForm): PublicModelForm {
  return {
    name: form.name.trim(),
    routing_mode: form.routing_mode,
    note: form.note.trim(),
    enabled: form.enabled,
    members: [...form.members]
      .sort((left, right) => toInt(left.priority) - toInt(right.priority))
      .map((member) => ({
        upstream_model_id: member.upstream_model_id,
        priority: String(toInt(member.priority)),
        weight: member.weight.trim() === "" ? "" : String(toInt(member.weight)),
        when: member.when.trim(),
      })),
  };
}

/** 单 PATCH 请求体：基本字段 + 策略 + 启用 + 成员整批替换（ticket 12 契约）。 */
export function patchPayloadOf(form: PublicModelForm): {
  name: string;
  routing_mode: RoutingMode;
  note: string;
  enabled: boolean;
  targets: ReturnType<typeof targetsPayload>;
} {
  const normalized = normalizeForm(form);
  return {
    name: normalized.name,
    routing_mode: normalized.routing_mode,
    note: normalized.note,
    enabled: normalized.enabled,
    targets: targetsPayload(normalized.members),
  };
}

/** 当前身份缺少哪些保存权限（服务端要求：基础写 + 含 targets 时的成员写）。 */
export function missingPermissions(can: (permission: string) => boolean): string[] {
  return SAVE_PERMISSIONS.filter((permission) => !can(permission));
}

/** 页面整页校验：名称非空 + 成员规则（至少一个/去重/conditional 末位兜底）。 */
export function validateForm(form: PublicModelForm): string[] {
  const errors: string[] = [];
  if (form.name.trim() === "") errors.push("名称不能为空");
  errors.push(...validateMembers(form.members, form.routing_mode));
  return Array.from(new Set(errors));
}

/** 成员差异条数（W9：页头名称旁展示）：逐位比较草稿与 baseline，顺序变化按位计差异。 */
export function changedMemberCount(
  before: MemberDraft[] | null | undefined,
  after: MemberDraft[],
): number {
  const base = before ?? [];
  const max = Math.max(base.length, after.length);
  let changed = 0;
  for (let index = 0; index < max; index += 1) {
    const left = base[index];
    const right = after[index];
    if (!left || !right) {
      changed += 1;
      continue;
    }
    const same =
      left.upstream_model_id === right.upstream_model_id &&
      left.priority === right.priority &&
      left.weight === right.weight &&
      left.when === right.when;
    if (!same) changed += 1;
  }
  return changed;
}

/** 成员草稿列表的内容比较（useDirtyFields 的 equals.members）：顺序也算变化。 */
export function sameMemberDrafts(before: unknown, after: unknown): boolean {
  if (!Array.isArray(before) || !Array.isArray(after)) return false;
  if (before.length !== after.length) return false;
  return before.every((item: MemberDraft, index) => {
    const other = after[index] as MemberDraft;
    return (
      item.upstream_model_id === other.upstream_model_id &&
      item.priority === other.priority &&
      item.weight === other.weight &&
      item.when === other.when
    );
  });
}
