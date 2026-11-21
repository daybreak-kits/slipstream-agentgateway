import type { AdminRole } from "./types";

/** 内置角色顺序与后端 l05_service/rbac.py 一致；自定义角色从 /admin/roles 读取。 */
export const ADMIN_ROLES: readonly AdminRole[] = ["admin", "customer", "reseller"];

export const ROLE_LABEL: Record<string, string> = {
  admin: "管理用户",
  customer: "客户",
  reseller: "分销商",
};

export function roleLabel(role: string | null | undefined): string {
  return ROLE_LABEL[role ?? ""] ?? role ?? "未知角色";
}

export const ROLE_HINT: Record<string, string> = {
  admin: "全部权限；可维护角色、管理用户与配置",
  customer: "只读 + 查看自己的花费",
  reseller: "客户权限 + 创建/管理下级用户，可看子树花费",
};

export function roleHint(role: string | null | undefined): string {
  return ROLE_HINT[role ?? ""] ?? "自定义角色（权限由权限矩阵配置）";
}

export const ROLE_TONE: Record<string, "primary" | "info" | "success" | "neutral"> = {
  admin: "primary",
  reseller: "success",
  customer: "neutral",
};

export function roleTone(role: string | null | undefined): "primary" | "info" | "success" | "neutral" {
  return ROLE_TONE[role ?? ""] ?? "info";
}
