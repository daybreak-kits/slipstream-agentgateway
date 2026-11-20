import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/lib/notify";

import { DataTable } from "@/components/data-table";
import { ErrorState } from "@/components/governance/panel";
import { RoleDrawer, type RoleFormValues } from "@/components/roles/role-drawer";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { describeApiError } from "@/components/users/api-error";
import { ACTION_ICONS } from "@/lib/icons";
import { usePermissions } from "@/lib/permissions";
import { deleteRole, fetchPermissionGroups, fetchRoles, updateRole } from "@/lib/roles";
import { fmtInt } from "@/lib/format";
import type { RoleDefinition } from "@/lib/roles";
import { PageHeader } from "@/components/layout/page-header";

const ROLES_KEY = ["roles"] as const;
const PERMISSIONS_KEY = ["permission-groups"] as const;

/**
 * 角色管理（ADR-023 #4）：角色列表 + 分节权限编辑；
 * 控制台账号并入用户管理（ADR-019），本页只管角色与权限键。
 */
export function AdminsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canManageRoles = can("roles:write");
  const canBrowseUsers = can("users:read");

  const rolesQ = useQuery({ queryKey: ROLES_KEY, queryFn: fetchRoles });
  const permsQ = useQuery({ queryKey: PERMISSIONS_KEY, queryFn: fetchPermissionGroups });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleDefinition | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ROLES_KEY });
  };

  const createRole = useMutation({
    mutationFn: (values: RoleFormValues) =>
      api.post<RoleDefinition>("/admin/roles", {
        name: values.name,
        description: values.description,
        permissions: values.permissions,
        ...(values.key !== "" ? { key: values.key } : {}),
      }),
    onSuccess: (role) => {
      toast.success("角色已创建", { description: role.name + "（" + role.key + "）" });
      setDrawerOpen(false);
      invalidate();
    },
    onError: (error) => toast.error("创建角色失败", { description: describeApiError(error) }),
  });

  const patchRole = useMutation({
    mutationFn: (vars: { id: string; values: RoleFormValues }) =>
      updateRole(vars.id, {
        name: vars.values.name,
        description: vars.values.description,
        permissions: vars.values.permissions,
      }),
    onSuccess: (role) => {
      toast.success("角色已保存", { description: role.name });
      setDrawerOpen(false);
      invalidate();
      // 权限变化影响当前登录人自己的可用操作，刷新 /admin/auth/me
      void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (error) => toast.error("保存角色失败", { description: describeApiError(error) }),
  });

  const removeRole = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => {
      toast.success("角色已删除");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => {
      setDeleteTarget(null);
      toast.error("删除角色失败", { description: describeApiError(error) });
    },
  });

  const columns: ColumnDef<RoleDefinition, unknown>[] = [
    {
      accessorKey: "key",
      header: "标识",
      cell: (cell) => <span className="font-mono text-2xs text-body">{cell.row.original.key}</span>,
    },
    {
      accessorKey: "name",
      header: "名称",
      cell: (cell) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-title">{cell.row.original.name}</div>
          {cell.row.original.description !== "" && (
            <div className="truncate text-2xs text-faint">{cell.row.original.description}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "builtin",
      header: "类型",
      cell: (cell) =>
        cell.row.original.builtin ? (
          <Badge tone="primary">内置</Badge>
        ) : (
          <Badge tone="neutral">自定义</Badge>
        ),
    },
    {
      accessorKey: "member_count",
      header: "成员数",
      meta: { className: "text-right tnum" },
      cell: (cell) => {
        const role = cell.row.original;
        if (!canBrowseUsers) return <span className="tnum">{role.member_count}</span>;
        return (
          <Button
            variant="ghost"
            size="sm"
            className="tnum"
            title="查看使用该角色的控制台账号"
            onClick={() => navigate("/users?role=" + encodeURIComponent(role.key))}
          >
            {role.member_count}
          </Button>
        );
      },
    },
    {
      id: "permissions",
      header: "权限数",
      meta: { className: "text-right tnum" },
      cell: (cell) => {
        const role = cell.row.original;
        return (
          <span className="tnum">
            {role.all_permissions ? "全部" : fmtInt(role.permissions.length)}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "操作",
      cell: (cell) => {
        const role = cell.row.original;
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {role.builtin ? (
              // 内置角色只读入口：不要求 roles:write（查看权限摘要不是写操作）
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingRole(role);
                  setDrawerOpen(true);
                }}
              >
                <ACTION_ICONS.view className="h-3.5 w-3.5" /> 查看权限
              </Button>
            ) : (
              canManageRoles && (
                <ActionButton
                  action="edit"
                  onClick={() => {
                    setEditingRole(role);
                    setDrawerOpen(true);
                  }}
                >
                  编辑
                </ActionButton>
              )
            )}
            {!role.builtin && canManageRoles && (
              <ActionButton action="delete" onClick={() => setDeleteTarget(role)}>
                删除
              </ActionButton>
            )}
          </div>
        );
      },
    },
  ];

  const roleList = rolesQ.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="角色管理"
        description="权限按 7 组分节管理；内置角色固定，自定义角色逐组勾选，删除前需清空成员。"
      />

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-2sm text-faint">
          共 <span className="tnum">{roleList.length}</span> 个角色 · 权限键由后端注册表（GET /admin/permissions）提供
        </p>
        <span className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void rolesQ.refetch()} disabled={rolesQ.isFetching}>
            <ACTION_ICONS.refresh className="h-3.5 w-3.5" />
            {rolesQ.isFetching ? "刷新中…" : "刷新"}
          </Button>
          {canManageRoles && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingRole(null);
                setDrawerOpen(true);
              }}
            >
              <ACTION_ICONS.add className="h-3.5 w-3.5" /> 新建角色
            </Button>
          )}
        </span>
      </div>

      {rolesQ.isError ? (
        <ErrorState
          title="角色列表加载失败"
          description={(rolesQ.error as Error).message}
          onRetry={() => void rolesQ.refetch()}
          retrying={rolesQ.isFetching}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rolesQ.data}
          loading={rolesQ.isPending}
          filterPlaceholder="筛选名称 / 标识"
          emptyText="还没有角色"
          storageKey="slipstream.cols.roles"
        />
      )}

      {permsQ.isError && (
        <p className="text-2xs text-danger-text">
          权限注册表加载失败（编辑抽屉里将看不到分组）：{(permsQ.error as Error).message}
        </p>
      )}

      <RoleDrawer
        open={drawerOpen}
        role={editingRole}
        groups={permsQ.data ?? []}
        groupsPending={permsQ.isPending}
        pending={createRole.isPending || patchRole.isPending}
        errorText={createRole.error?.message ?? patchRole.error?.message ?? null}
        onClose={() => setDrawerOpen(false)}
        onSubmit={(values) => {
          if (editingRole === null) createRole.mutate(values);
          else patchRole.mutate({ id: editingRole.id, values });
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title={"删除角色「" + (deleteTarget?.name ?? "") + "」？"}
        description="删除后使用该角色的账号立即失去对应权限，且不可恢复；角色下仍有成员时后端会拒绝删除。"
        confirmLabel="删除角色"
        destructive
        onConfirm={() => {
          if (deleteTarget === null) return;
          removeRole.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
