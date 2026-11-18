import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import {
  AdminFormDialog,
  RoleCreateDialog,
  type AdminFormValues,
  type RoleCreateValues,
} from "@/components/governance/admin-dialogs";
import { EmptyState, ErrorState, PageToolbar, SectionCard } from "@/components/governance/panel";
import { PermissionMatrix } from "@/components/governance/permission-matrix";
import { normalizeRoleKey, roleHint, roleLabel, roleTone } from "@/components/governance/roles";
import type { AdminAccount, AdminCreateInput, AdminPatchInput } from "@/components/governance/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { AUTH_ME_QUERY_KEY } from "@/lib/auth";
import { usePermissions } from "@/lib/permissions";
import {
  createRole,
  deleteRole,
  fetchPermissionGroups,
  fetchRoles,
  updateRole,
  type RoleDefinition,
} from "@/lib/roles";

const ADMINS_KEY = ["admins"] as const;
const ROLES_KEY = ["roles"] as const;
const PERMISSIONS_KEY = ["permission-groups"] as const;

interface AdminDialogState {
  mode: "create" | "edit";
  admin: AdminAccount | null;
}

export function AdminsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManageAdmins = can("admins:write");
  const canManageRoles = can("roles:write");

  const admins = useQuery({
    queryKey: ADMINS_KEY,
    queryFn: () => api.get<AdminAccount[]>("/admin/admins"),
  });
  const roles = useQuery({ queryKey: ROLES_KEY, queryFn: fetchRoles });
  const permissions = useQuery({ queryKey: PERMISSIONS_KEY, queryFn: fetchPermissionGroups });

  const [dialog, setDialog] = useState<AdminDialogState | null>(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminAccount | null>(null);
  const [deletingRole, setDeletingRole] = useState<RoleDefinition | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const roleList = roles.data ?? [];
  const rolesByKey = new Map(roleList.map((role) => [normalizeRoleKey(role.key), role]));

  const invalidateRoleConsumers = () => {
    void queryClient.invalidateQueries({ queryKey: ADMINS_KEY });
    void queryClient.invalidateQueries({ queryKey: ROLES_KEY });
    void queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
  };

  const createAdmin = useMutation({
    mutationFn: (body: AdminCreateInput) => api.post<AdminAccount>("/admin/admins", body),
    onSuccess: (account) => {
      toast.success("管理员已创建", { description: account.username + " · " + roleLabel(account.role) });
      setDialog(null);
      invalidateRoleConsumers();
    },
  });

  const patchAdmin = useMutation({
    mutationFn: (vars: { id: string; body: AdminPatchInput }) =>
      api.patch<AdminAccount>("/admin/admins/" + vars.id, vars.body),
    onSuccess: (account) => {
      toast.success("管理员已更新", { description: account.username + " 的角色 / 密码已保存" });
      setDialog(null);
      invalidateRoleConsumers();
    },
  });

  const deleteAdmin = useMutation({
    mutationFn: (id: string) => api.del<void>("/admin/admins/" + id),
    onSuccess: () => {
      toast.success("账号已删除", { description: "该管理员立即失去控制面访问权" });
      setDeleting(null);
      invalidateRoleConsumers();
    },
    onError: (error) => {
      // 最后一个「可管理管理员」的账号由后端 409 拒绝，客户端不猜测角色名
      setDeleting(null);
      setDeleteError(error.message);
    },
  });

  const createRoleMutation = useMutation({
    mutationFn: (values: RoleCreateValues) => createRole({ ...values, permissions: [] }),
    onSuccess: (role) => {
      toast.success("角色已创建", { description: role.name + "，请在矩阵中勾选权限" });
      setRoleDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ROLES_KEY });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: (vars: { id: string; permissions: string[] }) =>
      updateRole(vars.id, { permissions: vars.permissions }),
    onSuccess: () => {
      toast.success("权限已保存");
      void queryClient.invalidateQueries({ queryKey: ROLES_KEY });
      void queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
    },
    onError: (error) => toast.error("权限保存失败", { description: error.message }),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => {
      toast.success("角色已删除");
      setDeletingRole(null);
      void queryClient.invalidateQueries({ queryKey: ROLES_KEY });
    },
    onError: (error) => {
      setDeletingRole(null);
      toast.error("删除角色失败", { description: error.message });
    },
  });

  const rows = admins.data ?? [];

  const columns: ColumnDef<AdminAccount, unknown>[] = [
    {
      accessorKey: "username",
      header: "登录名",
      cell: (cell) => <span className="font-medium text-title">{cell.row.original.username}</span>,
    },
    {
      accessorKey: "role",
      header: "角色",
      cell: (cell) => {
        const roleKey = normalizeRoleKey(cell.row.original.role);
        const role = rolesByKey.get(roleKey);
        const label = role?.name ?? roleLabel(roleKey);
        const granted = role?.all_permissions
          ? "全部权限"
          : role
            ? "已授予 " + role.permissions.length + " 项"
            : roleHint(roleKey);
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={roleTone(roleKey)}>{label}</Badge>
            <span className="text-2xs text-faint">{granted}</span>
          </div>
        );
      },
    },
    ...(canManageAdmins
      ? [
          {
            id: "actions",
            header: "操作",
            cell: (cell: { row: { original: AdminAccount } }) => {
              const account = cell.row.original;
              return (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      createAdmin.reset();
                      patchAdmin.reset();
                      setDialog({ mode: "edit", admin: account });
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger-text"
                    title="删除账号不可恢复；最后一个可管理管理员的账号会被后端 409 拒绝"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(account);
                    }}
                  >
                    删除账号
                  </Button>
                </div>
              );
            },
          } satisfies ColumnDef<AdminAccount, unknown>,
        ]
      : []),
  ];

  const dialogPending = createAdmin.isPending || patchAdmin.isPending;
  const dialogError = createAdmin.error?.message ?? patchAdmin.error?.message ?? null;

  const openCreate = () => {
    createAdmin.reset();
    patchAdmin.reset();
    setDialog({ mode: "create", admin: null });
  };

  const submitDialog = (values: AdminFormValues) => {
    if (dialog?.mode === "edit" && dialog.admin) {
      const body: AdminPatchInput = {};
      const role = normalizeRoleKey(dialog.admin.role);
      if (values.role !== role) body.role = values.role;
      if (values.password !== undefined) body.password = values.password;
      if (Object.keys(body).length === 0) {
        toast.info("没有改动", { description: "角色与密码都保持原样" });
        return;
      }
      patchAdmin.mutate({ id: dialog.admin.id, body });
      return;
    }
    if (values.username !== undefined && values.password !== undefined) {
      createAdmin.mutate({ username: values.username, password: values.password, role: values.role });
    }
  };

  const togglePermission = (role: RoleDefinition, permission: string) => {
    if (!canManageRoles || role.builtin) return;
    const next = role.permissions.includes(permission)
      ? role.permissions.filter((key) => key !== permission)
      : [...role.permissions, permission].sort();
    updateRoleMutation.mutate({ id: role.id, permissions: next });
  };

  return (
    <div className="space-y-3">
      {deleteError !== null && (
        <Alert variant="destructive">
          <div className="flex w-full items-start justify-between gap-2">
            <span>
              删除失败：{deleteError}。后端要求至少保留一个拥有 admins:write 权限的有效账号。
            </span>
            <Button variant="ghost" size="sm" onClick={() => setDeleteError(null)}>
              知道了
            </Button>
          </div>
        </Alert>
      )}

      <PageToolbar
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void admins.refetch()} disabled={admins.isFetching}>
              {admins.isFetching ? "刷新中…" : "刷新"}
            </Button>
            {canManageAdmins ? (
              <Button variant="primary" size="sm" onClick={openCreate}>
                新建管理员
              </Button>
            ) : null}
          </>
        }
      >
        <p className="text-2sm text-faint">
          共 <span className="tnum">{rows.length}</span> 个管理员 · 角色 <span className="tnum">{roleList.length}</span> 个
        </p>
        <span className="text-2xs text-faint">管理员账号（admin_users）与下文用户（API 消费者）是两套身份体系</span>
      </PageToolbar>

      {admins.isError ? (
        <ErrorState
          title="管理员列表加载失败"
          description={admins.error.message}
          onRetry={() => void admins.refetch()}
          retrying={admins.isFetching}
        />
      ) : rows.length === 0 && admins.isSuccess ? (
        <EmptyState
          title="还没有管理员"
          description="至少需要一个拥有 admins:write 的管理用户才能继续管理控制面。"
          action={
            canManageAdmins ? (
              <Button variant="primary" size="sm" onClick={openCreate}>
                新建管理员
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={admins.data}
          loading={admins.isPending}
          filterPlaceholder="筛选登录名 / 角色"
          emptyText="没有匹配的管理员"
        />
      )}

      {can("roles:read") ? (
        <SectionCard
          title="角色与权限矩阵"
          description="内置三角色不可改（内置角色的权限固定），自定义角色可逐条勾选；权限键由后端注册表校验。"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {roleList.map((role) => (
                <Badge key={role.id} tone={roleTone(role.key)}>
                  {role.name}：{roleHint(role.key)}
                </Badge>
              ))}
            </div>
            {canManageRoles ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  createRoleMutation.reset();
                  setRoleDialogOpen(true);
                }}
              >
                新建角色
              </Button>
            ) : null}
          </div>
          {permissions.isError ? (
            <ErrorState
              title="权限注册表加载失败"
              description={permissions.error.message}
              onRetry={() => void permissions.refetch()}
              retrying={permissions.isFetching}
            />
          ) : (
            <PermissionMatrix
              roles={roleList}
              groups={permissions.data ?? []}
              canEdit={canManageRoles}
              savingKey={updateRoleMutation.isPending ? (updateRoleMutation.variables?.id ?? null) : null}
              onToggle={togglePermission}
              onDelete={(role) => setDeletingRole(role)}
            />
          )}
          {roles.isError ? (
            <p className="mt-2 text-2xs text-danger-text">角色列表加载失败：{roles.error.message}</p>
          ) : null}
        </SectionCard>
      ) : null}

      <p className="text-2xs text-faint">
        「删除账号」直接移除管理员记录、立即失效访问权且不可恢复；后端会以 409 拒绝删除最后一个仍可管理管理员的账号。
        角色变更立即生效；重置密码后该账号下一次请求就要用新密码。权限键见权限矩阵，后端逐个端点强制校验。
      </p>

      <AdminFormDialog
        open={dialog !== null}
        mode={dialog?.mode ?? "create"}
        admin={dialog?.admin ?? null}
        roles={roleList}
        pending={dialogPending}
        errorText={dialogError}
        onClose={() => setDialog(null)}
        onSubmit={submitDialog}
      />

      <RoleCreateDialog
        open={roleDialogOpen}
        pending={createRoleMutation.isPending}
        errorText={createRoleMutation.error?.message ?? null}
        onClose={() => setRoleDialogOpen(false)}
        onSubmit={(values) => createRoleMutation.mutate(values)}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={"删除管理员「" + (deleting?.username ?? "") + "」？"}
        description="删除后该账号立即失去控制面访问权，且不可恢复；最后一个可管理管理员的账号会被后端拒绝。"
        confirmLabel="删除账号"
        destructive
        onConfirm={() => {
          if (deleting) deleteAdmin.mutate(deleting.id);
        }}
      />

      <ConfirmDialog
        open={deletingRole !== null}
        onOpenChange={(next) => {
          if (!next) setDeletingRole(null);
        }}
        title={"删除角色「" + (deletingRole?.name ?? "") + "」？"}
        description="仅自定义角色可删除，且角色下不能还有成员；删除后使用该角色的账号会失去对应权限。"
        confirmLabel="删除角色"
        destructive
        onConfirm={() => {
          if (deletingRole) deleteRoleMutation.mutate(deletingRole.id);
        }}
      />
    </div>
  );
}
