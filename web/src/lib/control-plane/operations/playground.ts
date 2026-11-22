/**
 * 模型试验（Playground）的非 chat 操作（W4 票04）。
 *
 * chat 流式请求属 W5 票05 的范围，暂留在 lib/playground.ts；这里只收纳页面级
 * 读取（我的模型参数），让 Playground 页面不再直接拼 /admin 路径。
 */

import type { MyModelOut } from "@/generated/contract";

import type { OperationOptions } from "../types";

export interface PlaygroundOperations {
  /** GET /admin/my/models：登录用户可见的启用公开模型参数（无金额键）。 */
  myModels(options?: OperationOptions): Promise<MyModelOut[]>;
}
