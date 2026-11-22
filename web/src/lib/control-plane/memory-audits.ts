/** 审计域的内存实现：fixtures 行上做子串筛选与分页（语义对齐后端路由）。 */

import type { AuditLog, AuditLogList } from "@/types";

import type { AuditsOperations } from "./operations/audits";
import * as fixtures from "./memory/fixtures";
import { clone } from "./memory-adapter";

export function createMemoryAudits(): AuditsOperations {
  return {
    list: async (query) => {
      const actor = (query.actor ?? "").toLowerCase();
      const action = (query.action ?? "").toLowerCase();
      let rows: AuditLog[] = fixtures.auditLogs.slice();
      if (action) rows = rows.filter((row) => row.action.toLowerCase().includes(action));
      if (actor) rows = rows.filter((row) => row.actor.toLowerCase().includes(actor));
      const total = rows.length;
      const items = clone(rows.slice(query.offset, query.offset + query.limit));
      const payload: AuditLogList = { items, total };
      return payload;
    },
  };
}
