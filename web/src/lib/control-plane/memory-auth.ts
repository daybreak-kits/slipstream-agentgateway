import { clone } from "./memory-adapter";
import {
  MOCK_ADMIN,
  MOCK_CUSTOMER,
  mockLoggedIn,
  mockSession,
  setMockLoggedIn,
  setMockSession,
} from "./memory/fixtures";
import type { AdminIdentity, AuthOperations, LoginOutcome } from "./operations/auth";

const BAD_CREDENTIALS = "用户名或密码错误（mock 演示账号：admin / user01，密码 admin12345）";

/** 内存控制台会话：admin / user01 + admin12345（或 admin123）可登录，刷新后回到未登录。 */
export function createMemoryAuth(): AuthOperations {
  return {
    login: async (username, password): Promise<LoginOutcome> => {
      const knownPassword = password === "admin12345" || password === "admin123";
      const knownUser = username === "admin" || username === "user01";
      if (!knownUser || !knownPassword) return { kind: "error", message: BAD_CREDENTIALS };
      const session = username === "user01" ? MOCK_CUSTOMER : MOCK_ADMIN;
      setMockSession(session);
      setMockLoggedIn(true);
      return { kind: "ok", user: clone(session) as AdminIdentity };
    },
    me: async (): Promise<AdminIdentity | null> => (mockLoggedIn ? (clone(mockSession) as AdminIdentity) : null),
    logout: async (): Promise<void> => {
      setMockLoggedIn(false);
    },
  };
}
