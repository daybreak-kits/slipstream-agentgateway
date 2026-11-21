import { api } from "./api";
import { useMock } from "./mock";

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

export interface RolePatchInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

const MOCK_GROUPS: Array<[string, string[]]> = [
  ["主数据", ["upstreams:read", "upstreams:write", "upstream_models:read", "upstream_models:write", "public_models:read", "public_models:write", "model_targets:read", "model_targets:write"]],
  ["流量治理", ["availability:read", "availability:write", "transforms:read", "transforms:write"]],
  ["治理", ["config:read", "config:write", "settings:read", "settings:write", "audits:read", "policies:read", "policies:write"]],
  ["计费", ["prices:read", "prices:write", "billing:cost", "billing:spend", "billing:subtree", "ledger:read"]],
  ["用量", ["logs:read", "logs:pull", "reports:read"]],
  ["账号", ["users:read", "users:create", "users:update", "users:delete", "apikeys:read", "apikeys:write", "admins:read", "admins:write", "roles:read", "roles:write"]],
  ["模型试验", ["playground:use"]],
];

function mockEntry(key: string, group: string): PermissionEntry {
  return { key, label: key, description: "", group };
}

export const MOCK_PERMISSION_GROUPS: PermissionGroup[] = MOCK_GROUPS.map(([group, keys]) => ({
  group,
  permissions: keys.map((key) => mockEntry(key, group)),
}));

/** GET /admin/permissions：分组权限注册表。 */
export async function fetchPermissionGroups(): Promise<PermissionGroup[]> {
  if (useMock) return MOCK_PERMISSION_GROUPS;
  const payload = await api.get<{ groups: PermissionGroup[] }>("/admin/permissions");
  return payload.groups;
}

/** GET /admin/roles：内置角色在前，自定义角色在后（mock 模式由 lib/mock.ts 的内存 admin_roles 应答）。 */
export async function fetchRoles(): Promise<RoleDefinition[]> {
  const payload = await api.get<{ items: RoleDefinition[]; total: number }>("/admin/roles");
  return payload.items;
}

export async function updateRole(id: string, input: RolePatchInput): Promise<RoleDefinition> {
  return api.patch<RoleDefinition>("/admin/roles/" + id, input);
}

export async function deleteRole(id: string): Promise<void> {
  return api.del<void>("/admin/roles/" + id);
}
