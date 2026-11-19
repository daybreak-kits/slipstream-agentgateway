/**
 * 权限矩阵前端镜像：逐条对照 api/src/l05_service/rbac.py 的 PERMISSIONS 常量。
 * v1 不建权限表，权限随角色走；本文件只用于只读展示，千万别在界面上做成可勾选。
 */
import type { AdminRole } from "./types";

export type PermissionAction = "read" | "write" | "manage";

export const PERMISSION_ACTIONS: readonly PermissionAction[] = ["read", "write", "manage"];

export const ACTION_LABEL: Record<PermissionAction, string> = {
  read: "读",
  write: "写",
  manage: "管",
};

export const ACTION_HINT: Record<PermissionAction, string> = {
  read: "查看列表与详情",
  write: "新增 / 修改主数据与配置",
  manage: "签发密钥、管理用户等敏感动作",
};

export interface PermissionResource {
  key: string;
  label: string;
  group: string;
}

/** 顺序与 rbac.py 的 _READ_RESOURCES 一致，分组只为界面可读。 */
export const PERMISSION_RESOURCES: readonly PermissionResource[] = [
  { key: "vendor", label: "供应商", group: "主数据" },
  { key: "upstream", label: "上游", group: "主数据" },
  { key: "upstream_model", label: "上游模型", group: "主数据" },
  { key: "public_model", label: "公开模型", group: "主数据" },
  { key: "model_target", label: "模型目标", group: "主数据" },
  { key: "availability_rule", label: "可用性规则", group: "流量治理" },
  { key: "transforms", label: "改写规则", group: "流量治理" },
  { key: "config_revision", label: "配置版本", group: "治理" },
  { key: "setting", label: "系统设置", group: "治理" },
  { key: "usage", label: "用量", group: "计费" },
  { key: "ledger", label: "账本", group: "计费" },
  { key: "billing", label: "计费规则", group: "计费" },
  { key: "user", label: "用户", group: "账号" },
  { key: "api_key", label: "连接密钥", group: "账号" },
  { key: "admin_user", label: "管理员", group: "账号" },
];

const RESOURCE_KEYS = new Set(PERMISSION_RESOURCES.map((r) => r.key));

/** 与后端 _WRITE_RESOURCES 一一对应。 */
const WRITE_RESOURCES = new Set([
  "vendor",
  "upstream",
  "upstream_model",
  "public_model",
  "model_target",
  "availability_rule",
  "transforms",
  "config_revision",
  "setting",
]);

/** 与后端 _MANAGE_RESOURCES 一一对应。 */
const MANAGE_RESOURCES = new Set(["api_key", "user"]);

/** billing 的写权限是特例：仅 admin / owner（rbac.py 的 _BILLING_MANAGE_ROLES）。 */
const BILLING_WRITE_ROLES = new Set<AdminRole>(["admin", "owner"]);

export function can(role: AdminRole, resource: string, action: PermissionAction): boolean {
  if (!RESOURCE_KEYS.has(resource)) return false;
  if (resource === "billing" && action === "write") return BILLING_WRITE_ROLES.has(role);
  if (action === "read") return true;
  if (action === "write") return role !== "viewer" && WRITE_RESOURCES.has(resource);
  // manage：owner 全量；admin 仅密钥与用户；operator / viewer 无
  return role === "owner" ? true : role === "admin" && MANAGE_RESOURCES.has(resource);
}

export function roleSummary(role: AdminRole): string {
  const write = PERMISSION_RESOURCES.filter((r) => can(role, r.key, "write")).length;
  const manage = PERMISSION_RESOURCES.filter((r) => can(role, r.key, "manage")).length;
  return "读 " + PERMISSION_RESOURCES.length + " 类 · 写 " + write + " 类 · 管 " + manage + " 类";
}

/** 某角色在某动作下能覆盖的资源数（给卡片标题用）。 */
export function grantedCount(role: AdminRole, action: PermissionAction): number {
  return PERMISSION_RESOURCES.filter((r) => can(role, r.key, action)).length;
}
