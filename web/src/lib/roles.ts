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
  ["主数据", ["vendors:read", "vendors:write", "upstreams:read", "upstreams:write", "upstream_models:read", "upstream_models:write", "public_models:read", "public_models:write", "model_targets:read", "model_targets:write"]],
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

const ALL_KEYS = MOCK_GROUPS.flatMap(([, keys]) => keys);

const USER_KEYS = [
  ...MOCK_GROUPS.filter(([group]) => group !== "账号" && group !== "模型试验")
    .flatMap(([, keys]) => keys)
    .filter((key) => key.endsWith(":read")),
  "billing:spend",
  "playground:use",
];

const AGENT_KEYS = [...USER_KEYS, "users:read", "users:create", "users:update", "billing:subtree"];

export const MOCK_ROLES: RoleDefinition[] = [
  {
    id: "role_admin",
    key: "admin",
    name: "管理用户",
    description: "全部权限；可管理管理员、角色与配置写入",
    builtin: true,
    all_permissions: true,
    permissions: ALL_KEYS,
    member_count: 1,
  },
  {
    id: "role_agent",
    key: "agent",
    name: "代理用户",
    description: "普通用户权限 + 创建/管理下级用户，可看子树花费",
    builtin: true,
    all_permissions: false,
    permissions: AGENT_KEYS,
    member_count: 1,
  },
  {
    id: "role_user",
    key: "user",
    name: "普通用户",
    description: "只读 + 查看自己的花费",
    builtin: true,
    all_permissions: false,
    permissions: USER_KEYS,
    member_count: 1,
  },
  // 自定义角色示例：角色管理页用它演示「编辑/删除」入口（内置角色只有只读的「查看权限」）
  {
    id: "role_custom_viewer",
    key: "custom_viewer",
    name: "运营观察员",
    description: "示例自定义角色：只读权限子集，可编辑或删除",
    builtin: false,
    all_permissions: false,
    permissions: USER_KEYS.slice(0, 12),
    member_count: 0,
  },
];

/** GET /admin/permissions：分组权限注册表。 */
export async function fetchPermissionGroups(): Promise<PermissionGroup[]> {
  if (useMock) return MOCK_PERMISSION_GROUPS;
  const payload = await api.get<{ groups: PermissionGroup[] }>("/admin/permissions");
  return payload.groups;
}

/** GET /admin/roles：内置角色在前，自定义角色在后。 */
export async function fetchRoles(): Promise<RoleDefinition[]> {
  if (useMock) return MOCK_ROLES;
  const payload = await api.get<{ items: RoleDefinition[]; total: number }>("/admin/roles");
  return payload.items;
}

export async function updateRole(id: string, input: RolePatchInput): Promise<RoleDefinition> {
  return api.patch<RoleDefinition>("/admin/roles/" + id, input);
}

export async function deleteRole(id: string): Promise<void> {
  return api.del<void>("/admin/roles/" + id);
}
