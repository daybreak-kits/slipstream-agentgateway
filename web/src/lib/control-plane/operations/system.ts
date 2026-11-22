/** 系统状态域的 typed operations（W4 票04）：每日自检结果与提醒（W6 票08）。 */

import type { OperationOptions } from "../types";

/** GET /admin/system-status 的单条提醒。 */
export interface SystemStatusNotice {
  check: string;
  title: string;
  detail: string;
  notified_at_ms: number;
  notified_at: string;
}

/** GET /admin/system-status 的载荷（后端 routers_meta，纯 dict 无契约模型）。 */
export interface SystemStatus {
  checked_at: string;
  backend_version: string;
  checks: Record<string, { status: string; detail?: string }>;
  notices: SystemStatusNotice[];
}

export interface SystemOperations {
  /** GET /admin/system-status */
  status(options?: OperationOptions): Promise<SystemStatus>;
}
