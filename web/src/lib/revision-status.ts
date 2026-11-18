/**
 * 配置版本状态唯一词表。
 *
 * 后端来源：api/src/l05_service/rollout.py 的 RevisionStatus（active / superseded / failed），
 * 随 OpenAPI components.schemas.RevisionStatus 下发；前端不得再手写第三套词表。
 */
export const REVISION_STATUSES = ["active", "superseded", "failed"] as const;

export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export type RevisionStatusTone = "success" | "neutral" | "danger";

export interface RevisionStatusMeta {
  label: string;
  tone: RevisionStatusTone;
}

/** Record 让新增状态漏配时在 tsc 阶段直接失败。 */
const REVISION_STATUS_META: Record<RevisionStatus, RevisionStatusMeta> = {
  active: { label: "已生效", tone: "success" },
  superseded: { label: "已被替代", tone: "neutral" },
  failed: { label: "失败", tone: "danger" },
};

export function isRevisionStatus(value: string | null | undefined): value is RevisionStatus {
  return value !== null && value !== undefined && (REVISION_STATUSES as readonly string[]).includes(value);
}

/**
 * 已知状态走穷尽映射；后端未来新增状态时原样显示并降级为中性色，避免白屏。
 */
export function revisionStatusMeta(status: string | null | undefined): RevisionStatusMeta {
  if (isRevisionStatus(status)) return REVISION_STATUS_META[status];
  return { label: status || "未知", tone: "neutral" };
}
