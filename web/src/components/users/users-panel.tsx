import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "@/lib/notify";

import { DataTable } from "@/components/data-table";
import { ErrorState } from "@/components/governance/panel";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { fmtCny } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import { usePermissions } from "@/lib/permissions";
import type { UserTreeNode } from "@/types";

import { describeApiError } from "./api-error";
import { BalanceAdjustDialog } from "./balance-adjust-dialog";
import { CreateUserDialog } from "./create-user-dialog";
import { EditUserDialog } from "./edit-user-dialog";
import { LedgerDrawer } from "./ledger-drawer";
import { OneTimeSecretDialog } from "./one-time-secret-dialog";
import { generatePassword } from "./password";
import { TopupDialog } from "./topup-dialog";
import { buildTreeRows } from "./tree";

/** 术语门禁：状态动词统一「启用/关闭」（docs/GLOSSARY.md）。 */
const STATUS_LABEL: Record<string, string> = {
  active: "启用",
  disabled: "关闭",
  deleted: "已删除",
};

const COLUMN_LABELS: Record<string, string> = {
  user: "用户",
  role: "角色",
  type: "类型",
  balance_micro: "余额",
  keys: "密钥数",
  status: "状态",
  parent: "层级",
  actions: "操作",
};

interface UsersPanelProps {
  /** 作用域内全部用户（后端树序） */
  nodes: UserTreeNode[];
  rootIds: readonly string[];
  /** 角色下拉（roles:read 不可用时回退内置三角色） */
  roles: Array<{ key: string; name: string }>;
  /** 登录账号是否具备全局层级（决定下拉里是否提供管理用户角色） */
  globalScope: boolean;
  keyCounts: Map<string, number>;
  keyCountsState: "pending" | "error" | "ok";
  /** /users?role=<key> 预筛选（角色管理页成员数入口跳入）；null = 不筛 */
  roleFilter: string | null;
  onRoleFilterChange: (role: string | null) => void;
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
type ResetTarget = { id: string; name: string };

/**
 * 用户管理单页（ADR-019 统一用户表；原「API 用户/控制台账号」双页签合并）：
 * 一张列表承载余额/密钥/层级与登录名/角色/密码两个镜头。
 * 操作显隐一律查权限键（DESIGN-AUDIT §13 RBAC 红线，键值逐一对应后端 require）：
 * 充值/调整余额/重置密码/编辑/启闭 = users:update，流水 = ledger:read，删除 = users:delete；
 * 「控制台」徽章仅标识有登录名的行，不参与任何显隐判断。
 */
export function UsersPanel({
  nodes,
  rootIds,
  roles,
  globalScope,
  keyCounts,
  keyCountsState,
  roleFilter,
  onRoleFilterChange,
  canCreate,
  canUpdate,
  canDelete,
  canReadLedger,
  loading,
  onChanged,
}: UsersPanelProps) {
  const queryClient = useQueryClient();
  const { me } = usePermissions();
  const [view, setView] = useState<"tree" | "list">("tree");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserTreeNode | null>(null);
  const [topupUser, setTopupUser] = useState<UserTreeNode | null>(null);
  const [adjustUser, setAdjustUser] = useState<UserTreeNode | null>(null);
  const [ledgerUser, setLedgerUser] = useState<UserTreeNode | null>(null);
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserTreeNode | null>(null);
  /** 创建/重置成功返回的一次性密码（ADR-019：仅此一次），关闭弹窗即不再可见 */
  const [oneTimeSecret, setOneTimeSecret] = useState<{ title: string; secret: string } | null>(null);

  const roleOptions = useMemo(
    () => roles.filter((item) => globalScope || item.key !== "admin"),
    [roles, globalScope],
  );
  const roleName = useMemo(() => new Map(roles.map((item) => [item.key, item.name])), [roles]);
  const filteredNodes = useMemo(
    () => (roleFilter === null ? nodes : nodes.filter((node) => node.role === roleFilter)),
    [nodes, roleFilter],
  );
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const treeRows = useMemo(() => buildTreeRows(filteredNodes, [...rootIds]), [filteredNodes, rootIds]);
  const listRows = useMemo(
    () => [...filteredNodes].sort((a, b) => b.created_at_ms - a.created_at_ms),
    [filteredNodes],
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
      toast.success("用户已创建", { description: user.name + (user.username === "" ? "" : "（" + user.username + "）") });
      setCreateOpen(false);
      onChanged();
      if (user.initial_password) {
        setOneTimeSecret({ title: "用户已创建", secret: user.initial_password });
      }
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

  /** 行内 启用/关闭：只切状态，角色等其余字段走 EditUserDialog。 */
  const patchStatus = useMutation({
    mutationFn: (vars: { id: string; status: string }) =>
      api.patch<UserTreeNode>("/admin/users/" + vars.id, { status: vars.status }),
    onSuccess: (user) => {
      toast.success(user.status === "active" ? "用户已启用" : "用户已关闭", {
        description: user.name + (user.username === "" ? "" : "（" + user.username + "）"),
      });
      onChanged();
    },
    onError: (error) => toast.error("更新失败", { description: describeApiError(error) }),
  });

  /**
   * 重置密码：后端 PUT password 不生成也不回显，因此由前端生成 12 位随机密码
   * 提交并一次性展示（ADR-019 密码策略）。
   */
  const resetPassword = useMutation({
    mutationFn: (vars: { id: string; password: string }) =>
      api.put<{ id: string; username: string }>("/admin/users/" + vars.id + "/password", {
        password: vars.password,
      }),
    onSuccess: (result, vars) => {
      toast.success("密码已重置", { description: result.username === "" ? "已有会话已全部注销" : result.username + " 的已有会话已全部注销" });
      setResetTarget(null);
      setOneTimeSecret({ title: "密码已重置", secret: vars.password });
    },
    onError: (error) => {
      setResetTarget(null);
      toast.error("重置密码失败", { description: describeApiError(error) });
    },
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
        {user.username !== "" && (
          <div className="truncate font-mono text-2xs text-faint">{user.username}</div>
        )}
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
      id: "type",
      header: "类型",
      cell: (cell) =>
        cell.row.original.username !== "" ? (
          <Badge tone="neutral">控制台</Badge>
        ) : (
          <span className="text-2xs text-faint">—</span>
        ),
    },
    {
      accessorKey: "balance_micro",
      header: "余额",
      meta: { className: "text-right tnum" },
      cell: (cell) => <span className="tnum text-title">{fmtCny(cell.row.original.balance_micro)}</span>,
    },
    {
      id: "keys",
      header: "密钥数",
      meta: { className: "text-right tnum" },
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
      meta: { sticky: "right" },
      cell: (cell) => {
        const user = cell.row.original;
        if (user.status === "deleted") return <span className="text-2xs text-faint">已删除</span>;
        const isRoot = rootIds.includes(user.id);
        const isSelf = me?.id === user.id;
        const disabledNow = user.status === "disabled";
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {canUpdate && (
              <Button variant="ghost" size="dense" onClick={() => setTopupUser(user)}>
                <ACTION_ICONS.recharge className="h-3.5 w-3.5" /> 充值
              </Button>
            )}
            {canUpdate && (
              <Button variant="ghost" size="dense" onClick={() => setAdjustUser(user)}>
                <ACTION_ICONS.adjustBalance className="h-3.5 w-3.5" /> 调整余额
              </Button>
            )}
            {canReadLedger && (
              <Button variant="ghost" size="dense" onClick={() => setLedgerUser(user)}>
                <ACTION_ICONS.transactions className="h-3.5 w-3.5" /> 流水
              </Button>
            )}
            {canUpdate && (
              <Button
                variant="ghost"
                size="dense"
                onClick={() => setResetTarget({ id: user.id, name: user.name })}
              >
                <ACTION_ICONS.resetKey className="h-3.5 w-3.5" /> 重置密码
              </Button>
            )}
            {canUpdate && (
              // DESIGN-AUDIT §4：关闭/重新启用是可逆操作，直接执行不弹确认；
              // 唯一需要保护的是当前登录账号（关闭会让本次会话立即失效），用禁用 + 说明代替确认框。
              <ActionButton
                action={disabledNow ? "enable" : "disable"}
                size="dense"
                disabled={patchStatus.isPending || (isRoot && !disabledNow) || (isSelf && !disabledNow)}
                title={
                  isSelf && !disabledNow
                    ? "不能关闭当前登录账号"
                    : isRoot && !disabledNow
                      ? "根用户不可关闭"
                      : undefined
                }
                onClick={() =>
                  disabledNow
                    ? patchStatus.mutate({ id: user.id, status: "active" })
                    : patchStatus.mutate({ id: user.id, status: "disabled" })
                }
              >
                {disabledNow ? "启用" : "关闭"}
              </ActionButton>
            )}
            {canUpdate && (
              <ActionButton action="edit" size="dense" onClick={() => setEditing(user)}>
                编辑
              </ActionButton>
            )}
            {canDelete && (
              <ActionButton
                action="delete"
                size="dense"
                disabled={isRoot}
                title={isRoot ? "根用户不可删除" : undefined}
                onClick={() => setDeleteTarget(user)}
              >
                删除
              </ActionButton>
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
          共 <span className="tnum">{filteredNodes.length}</span> 位用户 · 树视图按层级展开，列表按创建时间倒序
        </p>
        {roleFilter !== null && (
          <Button variant="outline" size="sm" onClick={() => onRoleFilterChange(null)}>
            角色：{roleName.get(roleFilter) ?? roleFilter} · 清除筛选
          </Button>
        )}
        {canCreate && (
          <Button variant="primary" size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
            <ACTION_ICONS.addUser className="h-3.5 w-3.5" /> 新建用户
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
          storageKey="slipstream.cols.users"
          columnLabels={COLUMN_LABELS}
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
        title={"删除用户「" + (deleteTarget?.name ?? "") + "」？"}
        description="删除后该用户立即失效、不可再登录且界面不再展示（软删除：余额与流水保留存档）；有下级的用户需先迁移或删除下级，根用户不可删除。"
        confirmLabel="删除用户"
        destructive
        onConfirm={() => {
          if (deleteTarget === null) return;
          deleteUser.mutate(deleteTarget.id);
        }}
      />

      <OneTimeSecretDialog
        open={oneTimeSecret !== null}
        title={oneTimeSecret?.title ?? ""}
        description="新密码仅显示一次，请立即复制保存；关闭后不再可见。"
        secret={oneTimeSecret?.secret ?? ""}
        onClose={() => setOneTimeSecret(null)}
      />
    </div>
  );
}
