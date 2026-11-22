import type { OperationOptions } from "../types";

/** GET /admin/auth/me 的形状（permissions 由 RBAC 填充）。 */
export interface AdminIdentity {
  id: string;
  username: string;
  name: string;
  role: string;
  status: string;
  permissions: string[];
  expires_at?: string;
}

export type LoginOutcome =
  | { kind: "ok"; user: AdminIdentity }
  | { kind: "error"; message: string };

/**
 * 控制台会话操作：登录/当前身份/退出。
 * 登录失败是业务结果（页面展示文案）而非抛错；未登录以 null 表示。
 */
export interface AuthOperations {
  login(username: string, password: string): Promise<LoginOutcome>;
  me(options?: OperationOptions): Promise<AdminIdentity | null>;
  logout(): Promise<void>;
}
