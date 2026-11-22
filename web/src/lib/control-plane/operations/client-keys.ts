import type { ApiKeyIssue, ApiKeyRename, ApiKeyStatusPatch } from "@/generated/contract";
import type { ApiKey } from "@/types";

import type { OperationOptions } from "../types";

/** 签发结果：明文只在这一条响应里出现一次（ADR-023）。 */
export interface IssuedApiKey {
  id: string;
  key: string;
  mask: string;
}

/**
 * 连接密钥（ADR-023）操作：列表、签发、启停、重命名、重置、删除、审计化 reveal。
 * 每用户最多 50 把的限制由适配器执行；页面只表达意图。
 */
export interface ClientKeysOperations {
  /** GET /admin/api-keys：掩码列表（页面固定取首页 200 条）。 */
  list(options?: OperationOptions): Promise<ApiKey[]>;
  /** POST /admin/users/{userId}/api-keys：为目标用户签发一把密钥。 */
  issue(userId: string, body: ApiKeyIssue): Promise<IssuedApiKey>;
  /** PATCH /admin/api-keys/{id}/status：启停。 */
  setStatus(id: string, body: ApiKeyStatusPatch): Promise<ApiKey>;
  /** PATCH /admin/api-keys/{id}：重命名。 */
  rename(id: string, body: ApiKeyRename): Promise<ApiKey>;
  /** POST /admin/api-keys/{id}/rotate：重置密钥材料，返回新明文。 */
  rotate(id: string): Promise<{ key: string }>;
  /** DELETE /admin/api-keys/{id}：删除立即生效、不可恢复。 */
  remove(id: string): Promise<void>;
  /** POST /admin/api-keys/{id}/reveal：审计化取回明文。 */
  reveal(id: string): Promise<{ key: string }>;
}
