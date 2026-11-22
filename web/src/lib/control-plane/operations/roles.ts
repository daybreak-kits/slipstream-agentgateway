import type { RoleCreate, RolePatch } from "@/generated/contract";

import type { OperationOptions } from "../types";

/** 权限项：key 为 resource:action，group/label 用于权限矩阵分组展示。 */
export interface PermissionEntry {
  key: string;
  label: string;
  description: string;
  group: string;
}

export interface PermissionGroup {
  group: string;
  permissions: PermissionEntry[];
}

/** 角色（admin_roles）：builtin 角色不可删除，all_permissions 角色永远拥有全部权限。 */
export interface RoleDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  builtin: boolean;
  all_permissions: boolean;
  permissions: string[];
  member_count: number;
}

/** 角色管理（ADR-023 #4）操作；内置角色的权限/删除约束由适配器执行。 */
export interface RolesOperations {
  /** GET /admin/roles：内置角色在前，自定义角色在后。 */
  list(options?: OperationOptions): Promise<RoleDefinition[]>;
  /** GET /admin/permissions：分组权限注册表。 */
  permissions(options?: OperationOptions): Promise<PermissionGroup[]>;
  /** POST /admin/roles：创建自定义角色。 */
  create(body: RoleCreate): Promise<RoleDefinition>;
  /** PATCH /admin/roles/{id}：改名/描述/权限（内置角色权限不可改）。 */
  update(id: string, body: RolePatch): Promise<RoleDefinition>;
  /** DELETE /admin/roles/{id}：内置或有成员的角色不可删。 */
  remove(id: string): Promise<void>;
}
