import type { ConfigRevision } from "@/types";

import { clone } from "./memory-adapter";
import { configRevisions, mockSession } from "./memory/fixtures";
import type { ApplyRevision, ConfigOperations } from "./operations/config";

function nextRevisionId(): string {
  return "cr_" + String(configRevisions.length + 1).padStart(2, "0");
}

function newRevision(reason: string): ConfigRevision {
  const revision: ConfigRevision = {
    id: nextRevisionId(),
    artifact_hash: "h" + Math.random().toString(16).slice(2, 11),
    adapter_id: "openai-chat",
    operator: mockSession.username,
    reason,
    status: "active",
    previous_revision_id: configRevisions.find((row) => row.status === "active")?.id ?? null,
    created_at_ms: Date.now(),
  };
  for (const row of configRevisions) {
    if (row.status === "active") row.status = "superseded";
  }
  configRevisions.unshift(revision);
  return revision;
}

/** 内存配置域：回滚/下发都生成新版本并置旧的 superseded。 */
export function createMemoryConfig(): ConfigOperations {
  return {
    revisions: async (options) => {
      const rows = clone(configRevisions);
      return options?.limit ? rows.slice(0, options.limit) : rows;
    },
    rollback: async (id) => {
      const target = configRevisions.find((row) => row.id === id);
      if (!target) throw Object.assign(new Error("配置版本不存在：" + id), { status: 404, code: "not_found" });
      return newRevision("回滚到 " + id);
    },
    apply: async (reason): Promise<ApplyRevision> => {
      const revision = newRevision(reason ?? "网关策略下发");
      return { id: revision.id, status: revision.status, artifact_hash: revision.artifact_hash };
    },
  };
}
