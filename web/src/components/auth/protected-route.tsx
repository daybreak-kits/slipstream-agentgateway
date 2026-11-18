import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { AUTH_ME_QUERY_KEY, fetchMe } from "@/lib/auth";

/** 路由守卫：会话有效才渲染子路由；未登录跳 /login 并带上回跳地址。 */
export function ProtectedRoute() {
  const location = useLocation();
  const me = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: fetchMe,
    retry: false,
    staleTime: 30_000,
  });

  if (me.isPending) {
    return (
      <div className="grid min-h-full place-items-center bg-surface-2 text-sm text-faint">
        正在验证登录状态…
      </div>
    );
  }
  if (!me.data) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={"/login?next=" + next} replace />;
  }
  return <Outlet />;
}
