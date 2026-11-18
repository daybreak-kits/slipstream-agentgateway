import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { ErrorState } from "@/components/governance/panel";
import { TabBar } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import type { ApiKey, UserTreeResponse } from "@/types";

import { ApiUsersTab } from "@/components/users/api-users-tab";
import { ConsoleTab } from "@/components/users/console-tab";

const TREE_KEY = ["admin-user-tree"] as const;
const KEYS_KEY = ["admin-api-keys"] as const;
const ROLES_KEY = ["admin-roles"] as const;

type TabKey = "api" | "console";

const TAB_ITEMS: Array<{ key: TabKey; label: string }> = [
  { key: "api", label: "API 用户" },
  { key: "console", label: "控制台账号" },
];

function parseTab(raw: string | null): TabKey {
  return raw === "console" ? "console" : "api";
}

/** roles:read 不可用（或列表为空）时的兜底：内置三角色仍是合法的 role 值。 */
const BUILTIN_ROLE_OPTIONS = [
  { key: "admin", name: "管理用户" },
  { key: "agent", name: "代理用户" },
  { key: "user", name: "普通用户" },
];

/**
 * 用户管理（ADR-019 统一用户表，ADR-023 两 Tab）：
 * - API 用户：余额/密钥/层级与充值、流水等运营操作；
 * - 控制台账号：登录名/角色/密码的管理视角（重置密码、启停、删除）。
 * 同一张 users 表，两个 Tab 是不同的镜头；?tab=console&role=<key> 支持角色预筛选
 * （角色管理页成员数入口跳入）。
 */
export function UsersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"));
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
      const payload = await api.get<{ items: Array<{ key: string; name: string }> }>("/admin/roles");
      return payload.items.map((item) => ({ key: item.key, name: item.name }));
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
    <div className="space-y-3">
      <TabBar
        ariaLabel="用户管理分区"
        items={TAB_ITEMS}
        value={tab}
        onValueChange={(key) => setParams({ tab: key }, { replace: true })}
      />

      {tree.isError ? (
        <ErrorState
          title="用户列表加载失败"
          description={(tree.error as Error).message}
          onRetry={() => void tree.refetch()}
          retrying={tree.isFetching}
        />
      ) : tab === "api" ? (
        <ApiUsersTab
          nodes={nodes}
          rootIds={rootIds}
          roles={roleOptions}
          globalScope={globalScope}
          keyCounts={keyCounts}
          keyCountsState={keyCountsState}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canDelete={canDelete}
          canReadLedger={canReadLedger}
          loading={tree.isPending}
          onChanged={invalidateShared}
        />
      ) : (
        <ConsoleTab
          nodes={nodes}
          rootIds={rootIds}
          roles={roleOptions}
          roleFilter={roleFilter}
          onRoleFilterChange={(role) =>
            setParams(role === null ? { tab: "console" } : { tab: "console", role }, { replace: true })
          }
          canUpdate={canUpdate}
          canDelete={canDelete}
          loading={tree.isPending}
          onChanged={invalidateShared}
        />
      )}
    </div>
  );
}
