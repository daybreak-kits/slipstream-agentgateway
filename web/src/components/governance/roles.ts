import type { AdminRole } from "./types";

/** 内置角色顺序与后端 l05_service/rbac.py 一致；自定义角色从 /admin/roles 读取。 */
export const ADMIN_ROLES: readonly AdminRole[] = ["admin", "agent", "user"];

/** 旧角色名兼容映射：owner→admin / operator→agent / viewer→user（后端同名 alias）。 */
export const LEGACY_ROLE_ALIAS: Record<string, AdminRole> = {
  owner: "admin",
  operator: "agent",
  viewer: "user",
};

export const ROLE_LABEL: Record<string, string> = {
  admin: "管理用户",
  agent: "代理用户",
  user: "普通用户",
  owner: "管理用户",
  operator: "代理用户",
  viewer: "普通用户",
};

export function roleLabel(role: string | null | undefined): string {
  const key = normalizeRoleKey(role);
  return ROLE_LABEL[key] ?? role ?? "未知角色";
}

export const ROLE_HINT: Record<string, string> = {
  admin: "全部权限；可管理管理员、角色与配置写入",
  agent: "普通用户权限 + 创建/管理下级用户，可看子树花费",
  user: "只读 + 查看自己的花费",
};

export function roleHint(role: string | null | undefined): string {
  return ROLE_HINT[normalizeRoleKey(role)] ?? "自定义角色（权限由权限矩阵配置）";
}

export const ROLE_TONE: Record<string, "primary" | "info" | "success" | "neutral"> = {
  admin: "primary",
  agent: "success",
  user: "neutral",
  owner: "primary",
  operator: "success",
  viewer: "neutral",
};

export function roleTone(role: string | null | undefined): "primary" | "info" | "success" | "neutral" {
  return ROLE_TONE[role ?? ""] ?? "info";
}

/** 归一化：旧名映射到新内置 key，未知自定义角色原样保留。 */
export function normalizeRoleKey(value: string | null | undefined): string {
  if (!value) return "user";
  return LEGACY_ROLE_ALIAS[value] ?? value;
}

/** 兼容旧调用方；等价于 normalizeRoleKey。 */
export function asAdminRole(value: string | null | undefined): AdminRole {
  return normalizeRoleKey(value);
}
