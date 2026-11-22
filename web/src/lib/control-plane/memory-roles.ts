import type { RoleCreate, RolePatch } from "@/generated/contract";

import { adminRoles, rolePayload } from "./memory/fixtures";
import type { PermissionGroup, RoleDefinition, RolesOperations } from "./operations/roles";

/** 后端保留键：内置角色（l05_service/rbac.py RESERVED_ROLE_KEYS）。 */
const RESERVED_ROLE_KEYS = new Set(["admin", "customer", "reseller"]);

const MOCK_GROUPS: Array<[string, string[]]> = [
  ["主数据", ["upstreams:read", "upstreams:write", "upstream_models:read", "upstream_models:write", "public_models:read", "public_models:write", "model_targets:read", "model_targets:write"]],
  ["流量治理", ["availability:read", "availability:write", "transforms:read", "transforms:write"]],
  ["治理", ["config:read", "config:write", "settings:read", "settings:write", "audits:read", "policies:read", "policies:write"]],
  ["计费", ["prices:read", "prices:write", "billing:cost", "billing:spend", "billing:subtree", "ledger:read"]],
  ["用量", ["logs:read", "logs:pull", "reports:read"]],
  ["账号", ["users:read", "users:create", "users:update", "users:delete", "apikeys:read", "apikeys:write", "admins:read", "admins:write", "roles:read", "roles:write"]],
  ["模型试验", ["playground:use"]],
];

/** 内存角色域：角色行直接改 fixtures 的 admin_roles；成员数按 mockUsers 实时计算。 */
export function createMemoryRoles(): RolesOperations {
  const findRole = (id: string) => {
    const row = adminRoles.find((role) => role.id === id);
    if (!row) throw Object.assign(new Error("角色不存在: " + id), { status: 404, code: "not_found" });
    return row;
  };
  return {
    list: async () => adminRoles.map((role) => rolePayload(role)),
    permissions: async (): Promise<PermissionGroup[]> => {
      const groups = MOCK_GROUPS.map(([group, keys]) => ({
        group,
        permissions: keys.map((key) => ({ key, label: key, description: "", group })),
      }));
      return groups;
    },
    create: async (body: RoleCreate) => {
      const name = (body.name ?? "").trim();
      if (name.length === 0) throw new Error("角色名称不能为空");
      if (name.length > 64) throw new Error("角色名称过长");
      if (adminRoles.some((role) => role.name === name)) throw new Error("角色名称已存在: " + name);
      let key = (body.key ?? "").trim();
      if (key.length > 0) {
        if (!/^[a-z][a-z0-9_]{2,31}$/.test(key)) {
          throw new Error("角色标识须为 3-32 位小写字母/数字/下划线且以字母开头");
        }
        if (RESERVED_ROLE_KEYS.has(key) || adminRoles.some((role) => role.key === key)) {
          throw new Error("角色标识已保留或存在: " + key);
        }
      } else {
        key = "custom_" + Math.random().toString(16).slice(2, 10);
      }
      const created: RoleDefinition = {
        id: "rol_" + Math.random().toString(16).slice(2, 10),
        key,
        name,
        description: (body.description ?? "").trim().slice(0, 255),
        builtin: false,
        all_permissions: false,
        permissions: [...new Set(body.permissions ?? [])],
        member_count: 0,
      };
      adminRoles.push(created);
      return rolePayload(created);
    },
    update: async (id, body: RolePatch) => {
      const row = findRole(id);
      if (body.permissions !== undefined && body.permissions !== null && row.builtin) {
        throw new Error("内置角色的权限不可修改（" + row.key + "）");
      }
      if (body.name !== undefined && body.name !== null) {
        const name = body.name.trim();
        if (name.length === 0) throw new Error("角色名称不能为空");
        if (adminRoles.some((role) => role.id !== row.id && role.name === name)) {
          throw new Error("角色名称已存在: " + name);
        }
        row.name = name;
      }
      if (body.description !== undefined && body.description !== null) {
        row.description = body.description.trim().slice(0, 255);
      }
      if (body.permissions !== undefined && body.permissions !== null) {
        row.permissions = [...new Set(body.permissions)];
      }
      return rolePayload(row);
    },
    remove: async (id) => {
      const row = findRole(id);
      if (row.builtin) throw new Error("内置角色不可删除");
      const used = rolePayload(row).member_count;
      if (used > 0) throw new Error("仍有 " + used + " 个用户使用该角色，无法删除");
      adminRoles.splice(adminRoles.indexOf(row), 1);
    },
  };
}
