import { mockRequest, useMock } from "./mock";

// 同源（单端口 3700）时为空串；独立前端部署用 VITE_API_BASE 覆盖。
const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";
const LOGIN_PATH = "/admin/auth/login";
const LOGOUT_PATH = "/admin/auth/logout";
const ME_PATH = "/admin/auth/me";

/** React Query key for GET /admin/auth/me; login/logout must invalidate it. */
export const AUTH_ME_QUERY_KEY = ["auth", "me"] as const;

/** GET /admin/auth/me 的形状（permissions 由 ticket 03 填充）。 */
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

async function failureMessage(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const body = JSON.parse(raw) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // 认证失败可能返回纯文本：原样展示
    if (raw.trim()) return raw.trim().slice(0, 200);
  }
  return res.statusText || "登录失败";
}

/** 账号密码登录：成功后后端设置 httpOnly 会话 cookie，前端不再持有 token。 */
export async function loginAdmin(username: string, password: string): Promise<LoginOutcome> {
  const body = JSON.stringify({ username, password });
  if (useMock) {
    try {
      const payload = await mockRequest<{ user: AdminIdentity }>(LOGIN_PATH, {
        method: "POST",
        body,
      });
      return { kind: "ok", user: payload.user };
    } catch (e) {
      return { kind: "error", message: (e as Error).message };
    }
  }
  try {
    const res = await fetch(API_BASE + LOGIN_PATH, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) return { kind: "error", message: await failureMessage(res) };
    const payload = (await res.json()) as { user: AdminIdentity };
    return { kind: "ok", user: payload.user };
  } catch (e) {
    return {
      kind: "error",
      message:
        "无法连接控制面 API：" + String(API_BASE) + "（" + String((e as Error).message) + "）",
    };
  }
}

/** 当前身份；未登录（401/403）或网络不可达时返回 null，由路由守卫跳登录页。 */
export async function fetchMe(): Promise<AdminIdentity | null> {
  if (useMock) {
    try {
      return await mockRequest<AdminIdentity>(ME_PATH);
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(API_BASE + ME_PATH, { credentials: "include" });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return null;
    return (await res.json()) as AdminIdentity;
  } catch {
    return null;
  }
}

/** 退出登录：撤销服务端会话并清除 cookie；失败也不阻塞前端退出。 */
export async function logoutAdmin(): Promise<void> {
  if (useMock) {
    try {
      await mockRequest(LOGOUT_PATH, { method: "POST" });
    } catch {
      // mock 模式下没有会话也无所谓
    }
    return;
  }
  try {
    await fetch(API_BASE + LOGOUT_PATH, { method: "POST", credentials: "include" });
  } catch {
    // 网络失败时 cookie 可能在下次请求过期，前端仍然回到登录页
  }
}
