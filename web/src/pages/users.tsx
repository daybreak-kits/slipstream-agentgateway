import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { ErrorState } from "@/components/governance/panel";
import { UsersPanel } from "@/components/users/users-panel";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { fetchRoles } from "@/lib/roles";
import type { ApiKey, UserTreeResponse } from "@/types";
import { PageHeader } from "@/components/layout/page-header";

const TREE_KEY = ["admin-user-tree"] as const;
const KEYS_KEY = ["admin-api-keys"] as const;
const ROLES_KEY = ["admin-roles"] as const;

/** roles:read 不可用（或列表为空）时的兜底：内置三角色仍是合法的 role 值。 */
const BUILTIN_ROLE_OPTIONS = [
  { key: "admin", name: "管理用户" },
  { key: "agent", name: "代理用户" },
  { key: "user", name: "普通用户" },
];

/**
 * 用户管理单页（ADR-019 统一用户表）：原「API 用户 / 控制台账号」双页签合并为
 * 一张列表（树视图/列表切换），数据源维持 GET /admin/users/tree；
 * 角色编辑统一走 EditUserDialog；?role=<key> 支持角色预筛选
 * （角色管理页成员数入口跳入；旧 ?tab=console&role= 链接的 tab 参数忽略）。
 */
export function UsersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();
  const roleFilter = params.get("role");

  const canCreate = can("users:create");
  const canUpdate = can("users:update");
  const canDelete = can("users:delete");
  const canReadLedger = can("ledger:read");
  const canReadKeys = can("apikeys:read");
  // 与旧页一致的启发式：能删用户 ≈ 全局层级（代理用户只能看自己的子树）
  const globalScope = canDelete;

  const tree = useQuery({
    queryKey: TREE_KEY,
    queryFn: () => api.get<UserTreeResponse>("/admin/users/tree"),
  });
  const apiKeys = useQuery({
    queryKey: KEYS_KEY,
    queryFn: () => api.get<ApiKey[]>("/admin/api-keys?page_size=200&offset=0"),
    enabled: tree.isSuccess && canReadKeys,
  });
  const roles = useQuery({
    queryKey: ROLES_KEY,
    queryFn: async () => {
      const fetched = await fetchRoles();
      return fetched.map((item) => ({ key: item.key, name: item.name }));
    },
    staleTime: 60_000,
    retry: false,
  });

  const nodes = useMemo(() => tree.data?.nodes ?? [], [tree.data]);
  const rootIds = useMemo(() => tree.data?.root_ids ?? [], [tree.data]);

  const roleOptions = useMemo(() => {
    const fetched = roles.data ?? [];
    return fetched.length > 0
      ? fetched
      : BUILTIN_ROLE_OPTIONS.filter((item) => globalScope || item.key !== "admin");
  }, [roles.data, globalScope]);

  const keyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const key of apiKeys.data ?? []) counts.set(key.user_id, (counts.get(key.user_id) ?? 0) + 1);
    return counts;
  }, [apiKeys.data]);
  const keyCountsState: "pending" | "error" | "ok" = apiKeys.isPending
    ? "pending"
    : apiKeys.isError || !canReadKeys
      ? "error"
      : "ok";

  const invalidateShared = () => {
    void queryClient.invalidateQueries({ queryKey: TREE_KEY });
    void queryClient.invalidateQueries({ queryKey: KEYS_KEY });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="用户管理"
        description="按树或列表维护账号、余额与状态；根用户不可关闭或删除。"
      />
      {tree.isError ? (
        <ErrorState
          title="用户列表加载失败"
          description={(tree.error as Error).message}
          onRetry={() => void tree.refetch()}
          retrying={tree.isFetching}
        />
      ) : (
        <UsersPanel
          nodes={nodes}
          rootIds={rootIds}
          roles={roleOptions}
          globalScope={globalScope}
          keyCounts={keyCounts}
          keyCountsState={keyCountsState}
          roleFilter={roleFilter}
          onRoleFilterChange={(role) =>
            setParams(role === null ? {} : { role }, { replace: true })
          }
          canCreate={canCreate}
          canUpdate={canUpdate}
          canDelete={canDelete}
          canReadLedger={canReadLedger}
          loading={tree.isPending}
          onChanged={invalidateShared}
        />
      )}
    </div>
  );
}
