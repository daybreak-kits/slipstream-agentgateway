import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/governance/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { UserTreeNode } from "@/types";

import { describeApiError } from "./api-error";
import { OneTimeSecretDialog } from "./one-time-secret-dialog";
import { generatePassword } from "./password";

const STATUS_LABEL: Record<string, string> = {
  active: "启用",
  disabled: "停用",
  deleted: "已删除",
};

interface ConsoleTabProps {
  /** 控制台账号 = 统一用户表里可见的全部用户（ADR-019：有角色即可登录控制台） */
  nodes: UserTreeNode[];
  rootIds: readonly string[];
  /** 角色下拉（已按权限裁剪） */
  roles: Array<{ key: string; name: string }>;
  /** /users?tab=console&role=<key> 预筛选（角色管理页成员数入口跳入） */
  roleFilter: string | null;
  onRoleFilterChange: (role: string | null) => void;
  canUpdate: boolean;
  canDelete: boolean;
  /** 用户树首次加载中 */
  loading: boolean;
  onChanged: () => void;
}

type ResetTarget = { id: string; name: string };

/**
 * Tab2「控制台账号」：登录名/角色/密码的管理视角。
 * 重置密码：后端 PUT password 不生成也不回显，因此由前端生成 12 位随机密码
 * 提交并一次性展示（ADR-019 密码策略）。
 */
export function ConsoleTab({
  nodes,
  rootIds,
  roles,
  roleFilter,
  onRoleFilterChange,
  canUpdate,
  canDelete,
  loading,
  onChanged,
}: ConsoleTabProps) {
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserTreeNode | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);

  const roleName = useMemo(() => new Map(roles.map((item) => [item.key, item.name])), [roles]);
  const rows = useMemo(
    () => (roleFilter === null ? nodes : nodes.filter((node) => node.role === roleFilter)),
    [nodes, roleFilter],
  );

  const patchUser = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, string> }) =>
      api.patch<UserTreeNode>("/admin/users/" + vars.id, vars.body),
    onSuccess: (user, vars) => {
      const changedRole = "role" in vars.body;
      toast.success(changedRole ? "角色已调整" : user.status === "active" ? "用户已启用" : "用户已停用", {
        description: user.name + "（" + user.username + "）",
      });
      onChanged();
    },
    onError: (error) => toast.error("更新失败", { description: describeApiError(error) }),
  });

  const resetPassword = useMutation({
    mutationFn: (vars: { id: string; password: string }) =>
      api.put<{ id: string; username: string }>("/admin/users/" + vars.id + "/password", {
        password: vars.password,
      }),
    onSuccess: (result, vars) => {
      toast.success("密码已重置", { description: result.username + " 的已有会话已全部注销" });
      setResetTarget(null);
      setNewPassword(vars.password);
    },
    onError: (error) => {
      setResetTarget(null);
      toast.error("重置密码失败", { description: describeApiError(error) });
    },
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.del<{ id: string; status: string }>("/admin/users/" + id),
    onSuccess: () => {
      toast.success("账号已删除", { description: "该账号立即失去控制台访问权" });
      setDeleteTarget(null);
      onChanged();
    },
    onError: (error) => {
      setDeleteTarget(null);
      toast.error("删除账号失败", { description: describeApiError(error) });
    },
  });

  const columns: ColumnDef<UserTreeNode, unknown>[] = [
    {
      accessorKey: "username",
      header: "登录名",
      cell: (cell) => <span className="font-mono text-2sm text-title">{cell.row.original.username}</span>,
    },
    {
      accessorKey: "name",
      header: "显示名",
      cell: (cell) => <span className="text-2sm">{cell.row.original.name}</span>,
    },
    {
      accessorKey: "role",
      header: "角色",
      cell: (cell) => {
        const user = cell.row.original;
        if (!canUpdate) {
          return <span className="text-2sm">{roleName.get(user.role) ?? user.role}</span>;
        }
        return (
          <Select
            value={user.role}
            onValueChange={(next) => {
              if (next !== user.role) patchUser.mutate({ id: user.id, body: { role: next } });
            }}
          >
            <SelectTrigger className="h-8 w-36 text-2sm" aria-label={"调整 " + user.username + " 的角色"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: (cell) => {
        const status = cell.row.original.status;
        const tone = status === "active" ? "success" : status === "disabled" ? "warning" : "neutral";
        return <Badge tone={tone}>{STATUS_LABEL[status] ?? status}</Badge>;
      },
    },
    {
      id: "actions",
      header: "操作",
      cell: (cell) => {
        const user = cell.row.original;
        if (user.status === "deleted") return <span className="text-2xs text-faint">已删除</span>;
        const isRoot = rootIds.includes(user.id);
        const disabledNow = user.status === "disabled";
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {canUpdate && (
              <Button variant="outline" size="sm" onClick={() => setResetTarget({ id: user.id, name: user.name })}>
                重置密码
              </Button>
            )}
            {canUpdate && (
              <Button
                variant="outline"
                size="sm"
                disabled={patchUser.isPending || isRoot}
                title={isRoot ? "根用户不可停用" : undefined}
                onClick={() =>
                  patchUser.mutate({
                    id: user.id,
                    body: { status: disabledNow ? "active" : "disabled" },
                  })
                }
              >
                {disabledNow ? "启用" : "停用"}
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger-text"
                disabled={isRoot}
                title={isRoot ? "根用户不可删除" : undefined}
                onClick={() => setDeleteTarget(user)}
              >
                删除
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-2sm text-faint">
          共 <span className="tnum">{rows.length}</span> 个控制台账号 · 有角色即可以账号密码登录控制台（ADR-019）
        </p>
        {roleFilter !== null && (
          <Button variant="outline" size="sm" onClick={() => onRoleFilterChange(null)}>
            角色：{roleName.get(roleFilter) ?? roleFilter} · 清除筛选
          </Button>
        )}
      </div>

      {rows.length === 0 && !loading ? (
        <EmptyState
          title={roleFilter === null ? "还没有控制台账号" : "该角色下没有成员"}
          description={roleFilter === null ? "在「API 用户」页签新建用户，用户即可用初始密码登录控制台。" : "换一个角色，或到角色管理页查看其它角色的成员。"}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          pageSize={50}
          filterPlaceholder="筛选登录名 / 显示名"
          emptyText="没有匹配的账号"
          storageKey="slipstream.cols.users-console"
        />
      )}

      <ConfirmDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null);
        }}
        title={"重置「" + (resetTarget?.name ?? "") + "」的控制台密码？"}
        description="重置会生成新的 12 位随机密码，原密码立即失效，该账号所有已登录会话被注销。"
        confirmLabel="生成新密码"
        destructive
        onConfirm={() => {
          if (resetTarget === null) return;
          resetPassword.mutate({ id: resetTarget.id, password: generatePassword(12) });
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={"删除账号「" + (deleteTarget?.username ?? "") + "」？"}
        description="删除后该账号立即失去控制台访问权且不可恢复；有下级的用户需先迁移或删除下级，根用户不可删除。"
        confirmLabel="删除账号"
        destructive
        onConfirm={() => {
          if (deleteTarget === null) return;
          deleteUser.mutate(deleteTarget.id);
        }}
      />

      <OneTimeSecretDialog
        open={newPassword !== null}
        title="密码已重置"
        description="新密码仅显示一次，请立即复制并告知用户；关闭后不再可见。"
        secret={newPassword ?? ""}
        onClose={() => setNewPassword(null)}
      />
    </div>
  );
}
