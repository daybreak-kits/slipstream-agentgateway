import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AUTH_ME_QUERY_KEY } from "./auth";
import { api, ENDPOINTS } from "./api";
import { applyTheme, THEME_STORAGE_KEY, type Theme } from "./theme";
import type { ConnectionInfo, UserPreferences } from "@/types";

/** ticket 16：用户设置 / 运营设置的数据层，读写既有控制面接口。 */

export const CONNECTION_DEFAULT_PORT = 3600;

export const CONNECTION_QUERY_KEY = ["settings", "connection"] as const;
export const PREFERENCES_QUERY_KEY = ["auth", "preferences"] as const;

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "system",
  notify_email: true,
  notify_browser: false,
  notify_weekly: true,
  bio: "",
};

/** 浏览器当前 host；没有 window 时回退 localhost。 */
export function browserHost(): string {
  if (typeof window === "undefined") return "localhost";
  return window.location.hostname || "localhost";
}

/** 默认连接地址：浏览器当前 host + 3600 端口（本地开发即 http://<host>:3600）。 */
export function defaultBaseUrl(port = CONNECTION_DEFAULT_PORT): string {
  return "http://" + browserHost() + ":" + port;
}

/** 运营设置里配了公网地址就用它，否则回退默认地址。 */
export function effectiveBaseUrl(info: ConnectionInfo | undefined): string {
  const configured = info?.base_url?.trim();
  return configured ? configured.replace(/\/+$/, "") : defaultBaseUrl(info?.default_port ?? CONNECTION_DEFAULT_PORT);
}

/** URL 校验：http(s) + 主机名，不允许账号密码/query/hash；空串 = 自动。 */
export function validateBaseUrl(input: string): string | null {
  const value = input.trim();
  if (value.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "请输入完整地址，例如 https://api.example.com";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "协议只能是 http 或 https";
  if (!parsed.hostname) return "地址必须包含主机名";
  if (parsed.username || parsed.password) return "地址不能包含账号密码";
  if (parsed.search || parsed.hash) return "地址不能包含查询参数或锚点";
  return null;
}

export async function fetchConnection(): Promise<ConnectionInfo> {
  return api.get<ConnectionInfo>(ENDPOINTS.connection);
}

export async function fetchPreferences(): Promise<UserPreferences> {
  const payload = await api.get<UserPreferences>(ENDPOINTS.preferences);
  return { ...DEFAULT_PREFERENCES, ...payload };
}

export async function savePreferences(next: UserPreferences): Promise<UserPreferences> {
  return api.put<UserPreferences>(ENDPOINTS.preferences, next);
}

export async function saveProfile(name: string): Promise<void> {
  await api.patch<unknown>("/admin/auth/me", { name });
}

/** 读取连接地址；接口不可用（mock/旧后端）时回退默认值，页面不白屏。 */
export function useConnection() {
  return useQuery({
    queryKey: CONNECTION_QUERY_KEY,
    queryFn: fetchConnection,
    staleTime: 60_000,
    retry: false,
  });
}

/** 读偏好并把主题落到本浏览器（服务端是跨浏览器真源，localStorage 只做首屏加速）。 */
export function usePreferencesSync(): { preferences: UserPreferences; theme: Theme; isLoading: boolean } {
  const query = useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: fetchPreferences,
    staleTime: 30_000,
    retry: false,
  });
  const preferences = query.data ?? DEFAULT_PREFERENCES;
  const theme = preferences.theme;
  // 只有拿到服务端数据才回写本地主题；请求失败时保留本浏览器已有选择。
  if (query.data && typeof window !== "undefined" && localStorage.getItem(THEME_STORAGE_KEY) !== theme) {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyTheme(theme);
  }
  return { preferences, theme, isLoading: query.isPending };
}

export function useSavePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savePreferences,
    onSuccess: (data) => {
      queryClient.setQueryData(PREFERENCES_QUERY_KEY, data);
      localStorage.setItem(THEME_STORAGE_KEY, data.theme);
      applyTheme(data.theme);
    },
  });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveProfile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
    },
  });
}
