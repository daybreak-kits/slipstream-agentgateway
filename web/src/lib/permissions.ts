import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { AUTH_ME_QUERY_KEY, fetchMe, type AdminIdentity } from "./auth";

export interface PermissionApi {
  me: AdminIdentity | null | undefined;
  permissions: readonly string[];
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
  isPending: boolean;
}

const NO_PERMISSIONS: PermissionApi = {
  me: undefined,
  permissions: [],
  can: () => false,
  canAny: () => false,
  isPending: true,
};

const PermissionsContext = createContext<PermissionApi>(NO_PERMISSIONS);

/**
 * 全站唯一的 /admin/auth/me 订阅点：挂一次 Provider，27+ 个消费方走 context，
 * 权限查询只发一次请求、回调引用稳定，避免各自 useQuery 造成全树重渲染。
 */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const me = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: 60_000,
    retry: false,
  });
  const permissions = me.data?.permissions ?? EMPTY_PERMISSIONS;
  const can = useCallback((permission: string) => permissions.includes(permission), [permissions]);
  const canAny = useCallback(
    (...items: string[]) => items.some((permission) => permissions.includes(permission)),
    [permissions],
  );
  const value = useMemo<PermissionApi>(
    () => ({ me: me.data, permissions, can, canAny, isPending: me.isPending }),
    [me.data, permissions, can, canAny, me.isPending],
  );
  // 本文件是 .ts（无 JSX 运行时），Provider 用 createElement 等价表达
  return createElement(PermissionsContext.Provider, { value }, children);
}

const EMPTY_PERMISSIONS: readonly string[] = [];

/** /admin/auth/me 的 permissions 是唯一真源；后端已按角色展开为 resource:action 列表。 */
export function usePermissions(): PermissionApi {
  return useContext(PermissionsContext);
}
