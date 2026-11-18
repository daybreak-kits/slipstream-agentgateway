import type { ReactNode } from "react";

import { usePermissions } from "@/lib/permissions";

interface RequirePermissionProps {
  permission: string;
  children: ReactNode;
}

/** 路由级权限守卫：缺少权限时只渲染说明，不请求页面数据。后端仍是最终裁决者。 */
export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const { can, isPending } = usePermissions();

  if (isPending) {
    return <div className="grid min-h-40 place-items-center text-sm text-faint">正在校验权限…</div>;
  }
  if (!can(permission)) {
    return (
      <div className="grid min-h-40 place-items-center rounded-md border border-border bg-surface px-6 py-10 text-center">
        <div className="space-y-1">
          <p className="text-sm font-medium text-title">没有访问权限</p>
          <p className="text-2xs text-faint">
            当前账号缺少 <span className="font-mono">{permission}</span>，请联系管理用户调整角色。
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
