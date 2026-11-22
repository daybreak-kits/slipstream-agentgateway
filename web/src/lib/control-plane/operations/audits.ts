/**
 * 审计域的 typed operations（W4 票04）：分页列表 + actor/action 子串筛选。
 *
 * 审计行的响应仍是手写领域类型（后端该路由返回 dict 未声明 response_model）。
 */

import type { AuditLogList } from "@/types";

import type { OperationOptions } from "../types";

/** GET /admin/audit-logs 的查询参数；actor/action 是子串筛选，空串表示不过滤。 */
export interface AuditQuery {
  limit: number;
  offset: number;
  actor?: string;
  action?: string;
}

export interface AuditsOperations {
  /** GET /admin/audit-logs：最新在前。 */
  list(query: AuditQuery, options?: OperationOptions): Promise<AuditLogList>;
}
