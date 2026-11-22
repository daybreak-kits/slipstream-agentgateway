import type { LogsOperations } from "./operations/logs";
import type { UsersOperations } from "./operations/users";

/**
 * 测试里用动态 import 拿到的模块形状。
 * 这里只为满足 noUnusedLocals 与类型收窄，不参与运行时代码。
 */
export interface MemoryLogsModule {
  createMemoryLogs: () => LogsOperations;
}

export interface MemoryUsersModule {
  createMemoryUsers: () => UsersOperations;
}
