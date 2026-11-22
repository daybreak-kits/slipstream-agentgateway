import type { UserTreeResponse, UserTreeNode } from "@/types";

import { clone } from "./memory-adapter";
import {
  deriveMockUsername,
  ledgerFor,
  mockOneTimePassword,
  mockUsers,
  nextMockUserId,
} from "./memory/fixtures";
import type { CreatedUser, UsersOperations } from "./operations/users";

/** 内存用户表：同一份扁平 mockUsers 派生列表/树；写操作直接落内存行。 */
export function createMemoryUsers(): UsersOperations {
  const visible = () => mockUsers.filter((user) => user.status !== "deleted");
  const requireUser = (id: string) => {
    const row = mockUsers.find((user) => user.id === id);
    if (!row || row.status === "deleted") {
      throw Object.assign(new Error("用户不存在：" + id), { status: 404, code: "not_found" });
    }
    return row;
  };

  return {
    list: async () => clone(visible()),
    tree: async (): Promise<UserTreeResponse> => {
      const rows = visible();
      const visibleIds = new Set(rows.map((user) => user.id));
      const rootIds = rows
        .filter((user) => user.parent_user_id === null || !visibleIds.has(user.parent_user_id))
        .map((user) => user.id);
      return {
        root_id: rootIds[0] ?? null,
        root_ids: rootIds,
        total: rows.length,
        nodes: clone(rows),
      };
    },
    create: async (body) => {
      const parent = body.parent_user_id ? mockUsers.find((user) => user.id === body.parent_user_id) : undefined;
      const now = Date.now();
      const created: UserTreeNode = {
        id: nextMockUserId(),
        name: body.name,
        username: body.username?.trim() || deriveMockUsername(body.name),
        balance_micro: body.balance_micro ?? 0,
        role: body.role ?? "customer",
        parent_user_id: parent?.id ?? null,
        status: body.status ?? "active",
        depth: (parent?.depth ?? -1) + 1,
        direct_children: 0,
        subtree_size: 1,
        created_at_ms: now,
        updated_at_ms: now,
      };
      mockUsers.push(created);
      if (parent) {
        parent.direct_children += 1;
        parent.subtree_size += 1;
      }
      const result: CreatedUser = { ...clone(created), initial_password: mockOneTimePassword() };
      return result;
    },
    update: async (id, body) => {
      const row = requireUser(id);
      if (body.name !== undefined && body.name !== null) row.name = body.name;
      if (body.username !== undefined && body.username !== null) row.username = body.username;
      if (body.role !== undefined && body.role !== null) row.role = body.role;
      if (body.parent_user_id !== undefined) row.parent_user_id = body.parent_user_id;
      if (body.status !== undefined && body.status !== null) row.status = body.status;
      row.updated_at_ms = Date.now();
      return clone(row);
    },
    remove: async (id) => {
      const row = requireUser(id);
      row.status = "deleted";
      row.updated_at_ms = Date.now();
      return { id: row.id, status: row.status };
    },
    resetPassword: async (id) => {
      const row = requireUser(id);
      return { id: row.id, username: row.username };
    },
    topup: async (id, body) => {
      const row = requireUser(id);
      row.balance_micro += body.amount_micro;
      return { balance_after_micro: row.balance_micro };
    },
    adjust: async (id, body) => {
      const row = requireUser(id);
      row.balance_micro += body.delta_micro;
      return { balance_after_micro: row.balance_micro };
    },
    ledger: async (id) => {
      requireUser(id);
      return clone(ledgerFor(id));
    },
  };
}
