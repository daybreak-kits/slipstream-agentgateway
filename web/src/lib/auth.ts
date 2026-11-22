import { controlPlane } from "./control-plane";

/**
 * 控制台会话的页面级门面：实现归 control-plane 的 auth 域（W4 票04），
 * 这里保留既有导出名与 React Query key。
 */
export type { AdminIdentity, LoginOutcome } from "./control-plane/operations/auth";

import type { AdminIdentity, LoginOutcome } from "./control-plane/operations/auth";

/** React Query key for GET /admin/auth/me; login/logout must invalidate it. */
export const AUTH_ME_QUERY_KEY = ["auth", "me"] as const;

/** 账号密码登录：成功后后端设置 httpOnly 会话 cookie，前端不再持有 token。 */
export function loginAdmin(username: string, password: string): Promise<LoginOutcome> {
  return controlPlane.auth.login(username, password);
}

/** 当前身份；未登录（401/403）或网络不可达时返回 null，由路由守卫跳登录页。 */
export function fetchMe(): Promise<AdminIdentity | null> {
  return controlPlane.auth.me();
}

/** 退出登录：撤销服务端会话并清除 cookie；失败也不阻塞前端退出。 */
export function logoutAdmin(): Promise<void> {
  return controlPlane.auth.logout();
}
