import type { ConfigRevision } from "@/types";

import type { OperationOptions } from "../types";

/** 下发结果：只回版本号/状态/artifact 摘要。 */
export interface ApplyRevision {
  id: string;
  status: string;
  artifact_hash: string;
}

export interface RevisionListOptions extends OperationOptions {
  /** 只取最近 N 条（顶栏徽标用 1）；缺省返回全部。 */
  limit?: number;
}

/** 配置版本与下发操作：列表 / 回滚 / 下发留档。 */
export interface ConfigOperations {
  /** GET /admin/config/revisions：版本列表（新→旧）。 */
  revisions(options?: RevisionListOptions): Promise<ConfigRevision[]>;
  /** POST /admin/config/rollback/{id}：回滚生成新版本，不原地改。 */
  rollback(id: string): Promise<ConfigRevision>;
  /** POST /admin/config/apply：渲染/校验/下发后留档，返回新版本摘要。 */
  apply(reason?: string): Promise<ApplyRevision>;
}
