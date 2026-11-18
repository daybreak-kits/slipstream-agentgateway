import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { ErrorState } from "@/components/governance/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { fmtCny } from "@/lib/format";
import type { UserTreeNode } from "@/types";

import { describeApiError } from "./api-error";
import { BalanceAdjustDialog } from "./balance-adjust-dialog";
import { CreateUserDialog } from "./create-user-dialog";
import { EditUserDialog } from "./edit-user-dialog";
import { LedgerDrawer } from "./ledger-drawer";
import { OneTimeSecretDialog } from "./one-time-secret-dialog";
import { TopupDialog } from "./topup-dialog";
import { buildTreeRows } from "./tree";

const STATUS_LABEL: Record<string, string> = {
  active: "启用",
  disabled: "停用",
  deleted: "已删除",
};

interface ApiUsersTabProps {
  /** 作用域内全部用户（后端树序） */
  nodes: UserTreeNode[];
  rootIds: readonly string[];
  /** 角色下拉（已按权限裁剪；roles:read 不可用时回退内置三角色） */
  roles: Array<{ key: string; name: string }>;
  /** 登录账号是否具备全局层级（决定下拉里是否提供管理用户角色） */
  globalScope: boolean;
  keyCounts: Map<string, number>;
  keyCountsState: "pending" | "error" | "ok";
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canReadLedger: boolean;
  /** 用户树首次加载中 */
  loading: boolean;
  /** 任一变更成功后失效共享查询（树/密钥/账本） */
  onChanged: () => void;
}

type CreatedUser = UserTreeNode & { initial_password?: string };

/** Tab1「API 用户」：余额/密钥/层级的运营视角，含树视图与充值、流水等操作。 */
export function ApiUsersTab({
  nodes,
  rootIds,
  roles,
  globalScope,
  keyCounts,
  keyCountsState,
  canCreate,
  canUpdate,
  canDelete,
  canReadLedger,
  loading,
  onChanged,
}: ApiUsersTabProps) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"tree" | "list">("tree");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserTreeNode | null>(null);
  const [topupUser, setTopupUser] = useState<UserTreeNode | null>(null);
  const [adjustUser, setAdjustUser] = useState<UserTreeNode | null>(null);
  const [ledgerUser, setLedgerUser] = useState<UserTreeNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserTreeNode | null>(null);
  /** 创建成功返回的 initial_password（ADR-019：仅此一次），关闭弹窗即不再可见 */
  const [initialPassword, setInitialPassword] = useState<string | null>(null);

  const roleOptions = useMemo(
    () => roles.filter((item) => globalScope || item.key !== "admin"),
    [roles, globalScope],
  );
  const roleName = useMemo(() => new Map(roles.map((item) => [item.key, item.name])), [roles]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const treeRows = useMemo(() => buildTreeRows(nodes, [...rootIds]), [nodes, rootIds]);
  const listRows = useMemo(
    () => [...nodes].sort((a, b) => b.created_at_ms - a.created_at_ms),
    [nodes],
  );
  const parents = useMemo(
    () => treeRows.map((row) => ({ id: row.node.id, name: row.node.name, depth: row.level })),
    [treeRows],
  );
  const treeLevel = useMemo(
    () => new Map(treeRows.map((row) => [row.node.id, row.level] as const)),
    [treeRows],
  );

  const createUser = useMutation({
    mutationFn: (values: { name: string; username: string; role: string; parentUserId: string | null }) =>
      api.post<CreatedUser>("/admin/users", {
        name: values.name,
        ...(values.username !== "" ? { username: values.username } : {}),
        role: values.role,
        parent_user_id: values.parentUserId,
        status: "active",
      }),
    onSuccess: (user) => {
      toast.success("用户已创建", { description: user.name + "（" + user.username + "）" });
      setCreateOpen(false);
      onChanged();
      if (user.initial_password) setInitialPassword(user.initial_password);
    },
    onError: (error) => toast.error("创建用户失败", { description: describeApiError(error) }),
  });

  const editUser = useMutation({
    mutationFn: (vars: {
      id: string;
      values: { name: string; role: string; parentUserId: string | null; status: string };
    }) =>
      api.patch<UserTreeNode>("/admin/users/" + vars.id, {
        name: vars.values.name,
        role: vars.values.role,
        parent_user_id: vars.values.parentUserId,
        status: vars.values.status,
      }),
    onSuccess: (user) => {
      toast.success("用户已更新", {
        description: user.name + " · " + (STATUS_LABEL[user.status] ?? user.status),
      });
      setEditing(null);
      onChanged();
    },
    onError: (error) => toast.error("保存失败", { description: describeApiError(error) }),
  });

  const topup = useMutation({
    mutationFn: (vars: { userId: string; amountMicro: number; note: string }) =>
      api.post<{ balance_after_micro: number }>("/admin/users/" + vars.userId + "/balance", {
        amount_micro: vars.amountMicro,
        currency: "CNY",
        note: vars.note,
      }),
    onSuccess: (result) => {
      toast.success("充值成功", { description: "当前余额 " + fmtCny(result.balance_after_micro ?? 0) });
      setTopupUser(null);
      onChanged();
    },
    onError: (error) => toast.error("充值失败", { description: describeApiError(error) }),
  });

  const adjust = useMutation({
    mutationFn: (vars: { userId: string; deltaMicro: number; note: string }) =>
      api.post<{ balance_after_micro: number }>("/admin/users/" + vars.userId + "/balance/adjust", {
        delta_micro: vars.deltaMicro,
        currency: "CNY",
        note: vars.note,
      }),
    onSuccess: (result, vars) => {
      toast.success("余额已调整", { description: "当前余额 " + fmtCny(result.balance_after_micro ?? 0) });
      setAdjustUser(null);
      onChanged();
      void queryClient.invalidateQueries({ queryKey: ["user-ledger", vars.userId] });
    },
    onError: (error) => toast.error("调整失败", { description: describeApiError(error) }),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.del<{ id: string; status: string }>("/admin/users/" + id),
    onSuccess: () => {
      toast.success("用户已删除", { description: "软删除：余额与流水保留存档" });
      setDeleteTarget(null);
      onChanged();
    },
    onError: (error) => {
      setDeleteTarget(null);
      toast.error("删除用户失败", { description: describeApiError(error) });
    },
  });

  const renderName = (user: UserTreeNode, level?: number) => (
    <div className="flex items-center gap-1.5" style={level === undefined ? undefined : { paddingLeft: level * 14 }}>
      {level !== undefined && level > 0 && <span className="text-2xs text-faint">└</span>}
      <div className="min-w-0">
        <div className="truncate font-medium text-title">{user.name}</div>
        <div className="truncate font-mono text-2xs text-faint">{user.username}</div>
      </div>
    </div>
  );

  const columns: ColumnDef<UserTreeNode, unknown>[] = [
    {
      id: "user",
      header: "用户",
      accessorFn: (row) => row.name + " " + row.username,
      cell: (cell) => renderName(cell.row.original, view === "tree" ? treeLevel.get(cell.row.original.id) : undefined),
    },
    {
      accessorKey: "role",
      header: "角色",
      cell: (cell) => (
        <span className="text-2sm">{roleName.get(cell.row.original.role) ?? cell.row.original.role}</span>
      ),
    },
    {
      accessorKey: "balance_micro",
      header: "余额",
      cell: (cell) => <span className="tnum text-title">{fmtCny(cell.row.original.balance_micro)}</span>,
    },
    {
      id: "keys",
      header: "密钥数",
      cell: (cell) => {
        if (keyCountsState === "pending") return <span className="text-2xs text-faint">…</span>;
        if (keyCountsState === "error") return <span className="text-2xs text-faint">—</span>;
        return <span className="tnum">{keyCounts.get(cell.row.original.id) ?? 0}</span>;
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
      id: "parent",
      header: "层级",
      cell: (cell) => {
        const parentId = cell.row.original.parent_user_id;
        const parent = parentId === null ? undefined : byId.get(parentId);
        return <span className="text-2sm text-muted-foreground">{parent?.name ?? "—"}</span>;
      },
    },
    {
      id: "actions",
      header: "操作",
      cell: (cell) => {
        const user = cell.row.original;
        if (user.status === "deleted") return <span className="text-2xs text-faint">已删除</span>;
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {canUpdate && (
              <Button variant="primary" size="sm" onClick={() => setTopupUser(user)}>充值</Button>
            )}
            {canUpdate && (
              <Button variant="outline" size="sm" onClick={() => setAdjustUser(user)}>调整余额</Button>
            )}
            {canReadLedger && (
              <Button variant="ghost" size="sm" onClick={() => setLedgerUser(user)}>流水</Button>
            )}
            {canUpdate && (
              <Button variant="outline" size="sm" onClick={() => setEditing(user)}>编辑</Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger-text"
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

  const data = useMemo<UserTreeNode[]>(
    () => (view === "tree" ? treeRows.map((row) => row.node) : listRows),
    [view, treeRows, listRows],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border border-border p-0.5">
          <Button variant={view === "tree" ? "primary" : "ghost"} size="sm" onClick={() => setView("tree")}>
            树视图
          </Button>
          <Button variant={view === "list" ? "primary" : "ghost"} size="sm" onClick={() => setView("list")}>
            列表
          </Button>
        </div>
        <p className="text-2sm text-faint">
          共 <span className="tnum">{nodes.length}</span> 位用户 · 树视图按层级展开，列表按创建时间倒序
        </p>
        {canCreate && (
          <Button variant="primary" size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
            新建用户
          </Button>
        )}
      </div>

      {nodes.length === 0 && !loading ? (
        <ErrorState
          title="还没有用户"
          description={canCreate ? "新建第一位用户，或检查当前账号的数据范围。" : "当前账号没有可见的用户。"}
        />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          pageSize={50}
          filterPlaceholder="筛选显示名 / 登录名"
          emptyText="没有匹配的用户"
        />
      )}

      {canCreate && (
        <CreateUserDialog
          open={createOpen}
          pending={createUser.isPending}
          errorText={createUser.error?.message ?? null}
          roles={roleOptions}
          parents={parents}
          onClose={() => setCreateOpen(false)}
          onSubmit={(values) => createUser.mutate(values)}
        />
      )}

      <EditUserDialog
        user={editing}
        open={editing !== null}
        pending={editUser.isPending}
        errorText={editUser.error?.message ?? null}
        roles={roleOptions}
        parents={parents}
        rootIds={rootIds}
        onClose={() => setEditing(null)}
        onSubmit={(values) => {
          if (editing === null) return;
          editUser.mutate({ id: editing.id, values });
        }}
      />

      <TopupDialog
        userName={topupUser?.name ?? ""}
        open={topupUser !== null}
        pending={topup.isPending}
        errorText={topup.error?.message ?? null}
        onClose={() => setTopupUser(null)}
        onSubmit={(values) => {
          if (topupUser === null) return;
          topup.mutate({ userId: topupUser.id, ...values });
        }}
      />

      <BalanceAdjustDialog
        userName={adjustUser?.name ?? ""}
        open={adjustUser !== null}
        pending={adjust.isPending}
        errorText={adjust.error?.message ?? null}
        onClose={() => setAdjustUser(null)}
        onSubmit={(values) => {
          if (adjustUser === null) return;
          adjust.mutate({ userId: adjustUser.id, ...values });
        }}
      />

      <LedgerDrawer
        userId={ledgerUser?.id ?? null}
        userName={ledgerUser?.name ?? ""}
        onClose={() => setLedgerUser(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={"删除用户「" + (deleteTarget?.name ?? "") + "」？"}
        description="删除后该用户立即失效、界面不再展示（软删除，余额与流水保留存档）；有下级的用户需先迁移或删除下级，根用户不可删除。"
        confirmLabel="删除用户"
        destructive
        onConfirm={() => {
          if (deleteTarget === null) return;
          deleteUser.mutate(deleteTarget.id);
        }}
      />

      <OneTimeSecretDialog
        open={initialPassword !== null}
        title="用户已创建"
        description="初始密码仅显示一次，请立即复制保存；关闭后不再可见。"
        secret={initialPassword ?? ""}
        onClose={() => setInitialPassword(null)}
      />
    </div>
  );
}
