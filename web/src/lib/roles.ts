import { controlPlane } from "./control-plane";

/**
 * 角色与权限注册表的页面级门面：类型与操作都归 control-plane（W4 票04），
 * 这里保留既有导出名，避免调用方一次性重写。
 */
export type {
  PermissionEntry,
  PermissionGroup,
  RoleDefinition,
} from "./control-plane/operations/roles";

import type { PermissionGroup, RoleDefinition } from "./control-plane/operations/roles";

/** 更新角色时可提交的字段。 */
export interface RolePatchInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

/** GET /admin/permissions：分组权限注册表。 */
export function fetchPermissionGroups(): Promise<PermissionGroup[]> {
  return controlPlane.roles.permissions();
}

/** GET /admin/roles：内置角色在前，自定义角色在后。 */
export async function fetchRoles(): Promise<RoleDefinition[]> {
  return controlPlane.roles.list();
}

export function updateRole(id: string, input: RolePatchInput): Promise<RoleDefinition> {
  return controlPlane.roles.update(id, input);
}

export function deleteRole(id: string): Promise<void> {
  return controlPlane.roles.remove(id);
}
