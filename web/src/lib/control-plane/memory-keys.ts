import type { ApiKey } from "@/types";

import { clone } from "./memory-adapter";
import { clientKeys, mockUsers } from "./memory/fixtures";
import type { ClientKeysOperations } from "./operations/client-keys";

/** 每用户最多 50 把（后端同口径，ADR-023）。 */
const KEY_LIMIT = 50;

let keySeq = clientKeys.length;

function nextKeyId(): string {
  keySeq += 1;
  return "ak_" + String(keySeq).padStart(2, "0");
}

function randomSuffix(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function requireKey(id: string): ApiKey {
  const row = clientKeys.find((key) => key.id === id);
  if (!row) throw Object.assign(new Error("密钥不存在：" + id), { status: 404, code: "not_found" });
  return row;
}

/** 内存连接密钥域：签发/启停/重命名/重置/删除都在内存行上完成。 */
export function createMemoryClientKeys(): ClientKeysOperations {
  return {
    list: async () => clone(clientKeys),
    issue: async (userId, body) => {
      const user = mockUsers.find((row) => row.id === userId && row.status !== "deleted");
      if (!user) throw Object.assign(new Error("用户不存在：" + userId), { status: 404, code: "not_found" });
      if (clientKeys.filter((key) => key.user_id === userId).length >= KEY_LIMIT) {
        throw Object.assign(new Error("每用户最多 " + KEY_LIMIT + " 把密钥"), { status: 409, code: "KEY_LIMIT" });
      }
      const suffix = randomSuffix();
      const row: ApiKey = {
        id: nextKeyId(),
        user_id: userId,
        mask: "sk-…" + suffix,
        key_suffix: suffix,
        status: "active",
        created_at_ms: Date.now(),
        ...(body.name?.trim() ? { name: body.name.trim() } : {}),
      };
      clientKeys.push(row);
      return { id: row.id, key: "sk-ss-" + suffix + "A1B2C3D4", mask: row.mask };
    },
    setStatus: async (id, body) => {
      const row = requireKey(id);
      row.status = body.status as ApiKey["status"];
      return clone(row);
    },
    rename: async (id, body) => {
      const row = requireKey(id);
      row.name = body.name;
      return clone(row);
    },
    rotate: async (id) => {
      const row = requireKey(id);
      row.key_suffix = randomSuffix();
      row.mask = "sk-…" + row.key_suffix;
      row.last_used_at_ms = undefined;
      return { key: "sk-ss-" + row.key_suffix + "R9T8U7V6" };
    },
    remove: async (id) => {
      const index = clientKeys.findIndex((key) => key.id === id);
      if (index < 0) throw Object.assign(new Error("密钥不存在：" + id), { status: 404, code: "not_found" });
      clientKeys.splice(index, 1);
    },
    reveal: async (id) => {
      const row = requireKey(id);
      return { key: "sk-ss-" + row.key_suffix + "DEMO0000" };
    },
  };
}
