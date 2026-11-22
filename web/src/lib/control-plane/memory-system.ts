/** 系统状态域的内存实现：离线演示不产生每日自检提醒。 */

import * as fixtures from "./memory/fixtures";
import { clone } from "./memory-adapter";
import type { SystemOperations, SystemStatus } from "./operations/system";

export function createMemorySystem(): SystemOperations {
  return {
    status: async () => {
      const payload: SystemStatus = {
        checked_at: new Date().toISOString(),
        backend_version: String(fixtures.MOCK_VERSION),
        checks: {
          config_hash: { status: "ok", detail: "演示模式：无数据面配置下发" },
          version: { status: "ok", detail: "前端与演示后端同源" },
        },
        notices: [],
      };
      return clone(payload);
    },
  };
}
