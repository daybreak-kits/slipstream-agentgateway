import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { fmtMs, fmtYuan } from "@/components/governance/format";
import { LEDGER_PAGE_SIZE, summarizeLedger } from "@/components/governance/ledger-meta";
import { EmptyState, ErrorState, PageToolbar } from "@/components/governance/panel";
import type {
  ApiKeyRow,
  BalanceTopupResult,
  ConsumerUser,
  LedgerEntry,
} from "@/components/governance/types";
import {
  CreateHierarchyUserDialog,
  EditUserDialog,
} from "@/components/governance/user-hierarchy-dialogs";
import { LedgerDialog, TopupDialog } from "@/components/governance/user-dialogs";
import { MetricCard } from "@/components/stat-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { METRIC_ICONS } from "@/lib/metric-icons";
import { usePermissions } from "@/lib/permissions";
import { api } from "@/lib/api";
import type { UserTreeNode, UserTreeResponse } from "@/types";

const TREE_KEY = ["admin-user-tree"] as const;
const USERS_PAGE_SIZE = 200;
/** 累计消费要逐用户拉账本；列表页只汇总前 N 位，其余在“消费记录”里看。 */
const LEDGER_SUMMARY_USERS = 30;

const ROLE_LABELS: Record<string, string> = {
  admin: "管理用户",
  agent: "代理用户",
  user: "普通用户",
};

const STATUS_LABELS: Record<string, string> = {
  active: "启用",
  disabled: "停用",
  deleted: "已删除",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function statusTone(status: string): string {
  if (status === "active") return "text-success-text";
  if (status === "disabled") return "text-warning-text";
  return "text-faint";
}

interface TreeRow {
  node: UserTreeNode;
  level: number;
}

/** 作用域内的森林按父子关系展开；跨分支的边不会出现（后端已过滤）。 */
function buildTreeRows(nodes: UserTreeNode[], rootIds: string[]): TreeRow[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, UserTreeNode[]>();
  for (const node of nodes) {
    if (node.parent_user_id === null || !byId.has(node.parent_user_id)) continue;
    const bucket = children.get(node.parent_user_id) ?? [];
    bucket.push(node);
    children.set(node.parent_user_id, bucket);
  }
  for (const bucket of children.values()) {
    bucket.sort((a, b) => a.created_at_ms - b.created_at_ms || a.id.localeCompare(b.id));
  }
  const ordered: TreeRow[] = [];
  const visited = new Set<string>();
  const walk = (id: string, level: number) => {
    const node = byId.get(id);
    if (node === undefined || visited.has(id)) return;
    visited.add(id);
    ordered.push({ node, level });
    for (const child of children.get(id) ?? []) walk(child.id, level + 1);
  };
  for (const rootId of rootIds) walk(rootId, 0);
  for (const node of nodes) if (!visited.has(node.id)) walk(node.id, 0);
  return ordered;
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canCreate = can("users:create");
  const canUpdate = can("users:update");
  const canDelete = can("users:delete");
  const isAdminScope = canDelete;

  const tree = useQuery({
    queryKey: TREE_KEY,
    queryFn: () => api.get<UserTreeResponse>("/admin/users/tree"),
  });
  const nodes = tree.data?.nodes ?? [];
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const treeRows = useMemo(
    () => buildTreeRows(nodes, tree.data?.root_ids ?? []),
    [nodes, tree.data],
  );
  const listRows = useMemo(
    () => [...nodes].sort((a, b) => b.created_at_ms - a.created_at_ms),
    [nodes],
  );

  const apiKeys = useQuery({
    queryKey: ["admin-api-keys"],
    queryFn: () => api.get<ApiKeyRow[]>("/admin/api-keys?page_size=" + USERS_PAGE_SIZE + "&offset=0"),
    enabled: nodes.length > 0,
  });
  const roles = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => api.get<{ items: { key: string; name: string }[] }>("/admin/roles"),
    staleTime: 60_000,
  });
  const roleOptions = useMemo(() => {
    const fetched = roles.data?.items ?? [];
    const options = fetched.length > 0
      ? fetched.map((item) => ({ key: item.key, name: item.name }))
      : [
          { key: "admin", name: "管理用户" },
          { key: "agent", name: "代理用户" },
          { key: "user", name: "普通用户" },
        ];
    return options.filter((item) => isAdminScope || item.key !== "admin");
  }, [roles.data, isAdminScope]);
  const parentOptions = useMemo(
    () => treeRows.map((row) => ({ id: row.node.id, name: row.node.name, depth: row.level })),
    [treeRows],
  );

  const [view, setView] = useState<"tree" | "list">("tree");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserTreeNode | null>(null);
  const [topupUser, setTopupUser] = useState<ConsumerUser | null>(null);
  const [ledgerUser, setLedgerUser] = useState<ConsumerUser | null>(null);
  const [disableTarget, setDisableTarget] = useState<UserTreeNode | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: TREE_KEY });
    void queryClient.invalidateQueries({ queryKey: ["admin-api-keys"] });
  };

  const topup = useMutation({
    mutationFn: (vars: { userId: string; amountMicro: number; note: string }) =>
      api.post<BalanceTopupResult>("/admin/users/" + vars.userId + "/balance", {
        amount_micro: vars.amountMicro,
        currency: "CNY",
        note: vars.note,
      }),
    onSuccess: (result, vars) => {
      const after =
        typeof result.balance_after_micro === "number" ? "，当前余额 " + fmtYuan(result.balance_after_micro) : "";
      toast.success("充值成功", { description: "到账 " + fmtYuan(vars.amountMicro) + after });
      setTopupUser(null);
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["user-ledger", vars.userId] });
    },
  });

  const createUser = useMutation({
    mutationFn: (vars: {
      name: string;
      role: string;
      parentUserId: string | null;
      status: "active" | "disabled";
      balanceMicro: number;
    }) =>
      api.post<UserTreeNode>("/admin/users", {
        name: vars.name,
        role: vars.role,
        parent_user_id: vars.parentUserId,
        status: vars.status,
        balance_micro: vars.balanceMicro,
      }),
    onSuccess: (user) => {
      toast.success("用户已创建", { description: roleLabel(user.role) + " · " + user.name });
      setCreateOpen(false);
      invalidate();
    },
  });

  const editUser = useMutation({
    mutationFn: (vars: {
      id: string;
      name: string;
      role: string;
      parentUserId: string | null;
      status: "active" | "disabled";
    }) =>
      api.patch<UserTreeNode>("/admin/users/" + vars.id, {
        name: vars.name,
        role: vars.role,
        parent_user_id: vars.parentUserId,
        status: vars.status,
      }),
    onSuccess: (user) => {
      toast.success("用户已更新", { description: user.name + " · " + statusLabel(user.status) });
      setEditing(null);
      invalidate();
    },
  });

  const disableUser = useMutation({
    mutationFn: (user: UserTreeNode) =>
      api.patch<UserTreeNode>("/admin/users/" + user.id, {
        status: user.status === "disabled" ? "active" : "disabled",
      }),
    onSuccess: (user) => {
      toast.success(user.status === "disabled" ? "用户已停用" : "用户已启用", {
        description: user.name,
      });
      invalidate();
    },
    onError: (error: Error) => toast.error("状态更新失败", { description: error.message }),
  });

  const shownNodes = (view === "tree" ? treeRows.map((row) => row.node) : listRows).slice(0, LEDGER_SUMMARY_USERS);
  const ledgerQueries = useQueries({
    queries: shownNodes.map((user) => ({
      queryKey: ["user-ledger", user.id],
      queryFn: () =>
        api.get<LedgerEntry[]>("/admin/users/" + user.id + "/ledger?page_size=" + LEDGER_PAGE_SIZE + "&offset=0"),
      staleTime: 30_000,
      enabled: can("ledger:read"),
    })),
  });
  const summaries = new Map<string, { consumedMicro: number; toppedMicro: number }>();
  shownNodes.forEach((user, index) => {
    const result = ledgerQueries[index];
    if (result?.data !== undefined) summaries.set(user.id, summarizeLedger(result.data));
  });

  const keyRows = apiKeys.data ?? [];
  const keysHaveUser = keyRows.length > 0 && keyRows.every((key) => typeof key.user_id === "string");
  const keyCounts = new Map<string, number>();
  for (const key of keyRows) keyCounts.set(key.user_id, (keyCounts.get(key.user_id) ?? 0) + 1);

  const agentCount = nodes.filter((node) => node.role === "agent").length;
  const disabledCount = nodes.filter((node) => node.status === "disabled").length;
  const totalBalanceMicro = nodes.reduce((sum, node) => sum + node.balance_micro, 0);

  const renderName = (user: UserTreeNode, level?: number) => (
    <div className="flex items-center gap-1.5" style={level === undefined ? undefined : { paddingLeft: level * 14 }}>
      {level !== undefined && level > 0 && <span className="text-2xs text-faint">└</span>}
      <span className="font-medium text-title">{user.name}</span>
      {user.direct_children > 0 && (
        <span className="rounded bg-muted px-1 text-2xs text-faint" title="直接下级数">
          {user.direct_children}
        </span>
      )}
    </div>
  );

  const columns: ColumnDef<TreeRow, unknown>[] = [
    {
      id: "name",
      header: "用户名称",
      cell: (cell) => renderName(cell.row.original.node, view === "tree" ? cell.row.original.level : undefined),
    },
    {
      id: "role",
      header: "角色",
      cell: (cell) => (
        <span className="text-2sm" title={cell.row.original.node.role}>{roleLabel(cell.row.original.node.role)}</span>
      ),
    },
    {
      id: "parent",
      header: "父级",
      cell: (cell) => {
        const node = cell.row.original.node;
        const parent = node.parent_user_id === null ? undefined : byId.get(node.parent_user_id);
        return (
          <span className="text-2sm text-muted-foreground">
            {node.parent_user_id === null ? "根用户 D" : (parent?.name ?? "—")}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "状态",
      cell: (cell) => (
        <span className={"text-2sm " + statusTone(cell.row.original.node.status)}>{statusLabel(cell.row.original.node.status)}</span>
      ),
    },
    {
      id: "balance",
      header: "余额",
      cell: (cell) => (
        <span className="tnum text-title" title="预付余额：micro 折元，两位小数">
          {fmtYuan(cell.row.original.node.balance_micro)}
        </span>
      ),
    },
    {
      id: "consumed",
      header: "累计消费",
      cell: (cell) => {
        const summary = summaries.get(cell.row.original.node.id);
        if (summary === undefined) {
          return <span className="text-2xs text-faint" title="按账本 charge 汇总，见“消费记录”">汇总中…</span>;
        }
        return <span className="tnum" title="账本中所有 charge 的负 delta 绝对值">{fmtYuan(summary.consumedMicro)}</span>;
      },
    },
    {
      id: "subtree",
      header: "子树",
      cell: (cell) => (
        <span className="tnum text-2sm" title="含自己的子树人数">{cell.row.original.node.subtree_size}</span>
      ),
    },
    {
      id: "keys",
      header: "密钥数",
      cell: (cell) => {
        if (apiKeys.isPending) return <span className="text-2xs text-faint">…</span>;
        if (apiKeys.isError || !keysHaveUser) {
          return <span className="text-2xs text-faint" title="密钥接口缺 user_id，无法按用户统计">—</span>;
        }
        return <span className="tnum">{keyCounts.get(cell.row.original.node.id) ?? 0}</span>;
      },
    },
    {
      id: "created",
      header: "创建时间",
      cell: (cell) => <span className="tnum text-2xs">{fmtMs(cell.row.original.node.created_at_ms)}</span>,
    },
    {
      id: "actions",
      header: "操作",
      cell: (cell) => {
        const user = cell.row.original.node;
        const isRoot = tree.data?.root_ids.includes(user.id) ?? false;
        const enabling = user.status === "disabled";
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {canUpdate && (
              <Button variant="outline" size="sm" onClick={() => { editUser.reset(); setEditing(user); }}>编辑</Button>
            )}
            {canUpdate && (
              <Button
                variant="outline"
                size="sm"
                disabled={disableUser.isPending || isRoot}
                title={isRoot ? "根用户不可停用" : undefined}
                onClick={() => setDisableTarget(user)}
              >
                {enabling ? "启用" : "停用"}
              </Button>
            )}
            {canUpdate && (
              <Button variant="primary" size="sm" onClick={() => { topup.reset(); setTopupUser(user); }}>充值</Button>
            )}
            {can("ledger:read") && (
              <Button variant="ghost" size="sm" onClick={() => setLedgerUser(user)}>消费记录</Button>
            )}
          </div>
        );
      },
    },
  ];

  // 稳定引用：视图切换时每次渲染都生成新数组，见 DataTable 注释。
  const data = useMemo<TreeRow[]>(
    () => (view === "tree" ? treeRows : listRows.map((node) => ({ node, level: 0 }))),
    [view, treeRows, listRows],
  );
  const disableTargetEnabling = disableTarget?.status === "disabled";

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <MetricCard
          label="用户数"
          icon={METRIC_ICONS.users.icon}
          tone={METRIC_ICONS.users.tone}
          value={tree.isPending ? undefined : tree.isError ? "—" : String(nodes.length)}
          hint="当前作用域内的消费者账号"
          loading={tree.isPending}
        />
        <MetricCard
          label="代理用户"
          icon={METRIC_ICONS.users.icon}
          tone="primary"
          value={tree.isPending ? undefined : String(agentCount)}
          hint="可创建并管理自己的下级"
          loading={tree.isPending}
        />
        <MetricCard
          label="停用用户"
          icon={METRIC_ICONS.errors.icon}
          tone={disabledCount > 0 ? "warning" : "neutral"}
          value={tree.isPending ? undefined : String(disabledCount)}
          hint="停用后不可再下单"
          loading={tree.isPending}
        />
        <MetricCard
          label="余额合计"
          icon={METRIC_ICONS.cost.icon}
          tone="primary"
          value={tree.isPending ? undefined : fmtYuan(totalBalanceMicro)}
          hint="预付余额，micro 折元"
          loading={tree.isPending}
        />
      </div>

      {apiKeys.isError && (
        <Alert variant="warning"><span>密钥数统计不可用（GET /admin/api-keys 失败），其余列不受影响：{apiKeys.error.message}</span></Alert>
      )}

      <PageToolbar
        actions={
          <>
            <div className="flex items-center rounded-md border border-border p-0.5">
              <Button variant={view === "tree" ? "primary" : "ghost"} size="sm" onClick={() => setView("tree")}>树视图</Button>
              <Button variant={view === "list" ? "primary" : "ghost"} size="sm" onClick={() => setView("list")}>列表</Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => void tree.refetch()} disabled={tree.isFetching}>
              {tree.isFetching ? "刷新中…" : "刷新"}
            </Button>
            {canCreate && (
              <Button variant="primary" size="sm" onClick={() => { createUser.reset(); setCreateOpen(true); }}>新建用户</Button>
            )}
          </>
        }
      >
        <p className="text-2sm text-faint">
          共 <span className="tnum">{nodes.length}</span> 位用户 · 代理用户只能看到自己的子树 · 钱包口径：预付余额充多少用多少，扣到 0 后请求返回 429
        </p>
      </PageToolbar>

      {tree.isError ? (
        <ErrorState
          title="用户列表加载失败"
          description={tree.error.message}
          onRetry={() => void tree.refetch()}
          retrying={tree.isFetching}
        />
      ) : !tree.isPending && nodes.length === 0 ? (
        <EmptyState title="还没有用户" description={canCreate ? "新建第一位用户，或检查当前账号的数据范围。" : "当前账号没有可见的用户。"} />
      ) : (
        <DataTable
          data={data}
          columns={columns}
          loading={tree.isPending}
          pageSize={50}
          emptyText="没有匹配的用户"
        />
      )}

      {canCreate && (
        <CreateHierarchyUserDialog
          open={createOpen}
          pending={createUser.isPending}
          errorText={createUser.error?.message ?? null}
          roles={roleOptions}
          parents={parentOptions}
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
        parents={parentOptions}
        onClose={() => setEditing(null)}
        onSubmit={(values) => {
          if (editing === null) return;
          editUser.mutate({ id: editing.id, ...values });
        }}
      />

      <TopupDialog
        user={topupUser}
        open={topupUser !== null}
        pending={topup.isPending}
        errorText={topup.error?.message ?? null}
        onClose={() => setTopupUser(null)}
        onSubmit={(values) => {
          if (topupUser === null) return;
          topup.mutate({ userId: topupUser.id, amountMicro: values.amountMicro, note: values.note });
        }}
      />

      <LedgerDialog user={ledgerUser} open={ledgerUser !== null} onClose={() => setLedgerUser(null)} />

      <ConfirmDialog
        open={disableTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisableTarget(null);
        }}
        title={disableTargetEnabling ? "启用用户？" : "停用用户？"}
        description={
          disableTargetEnabling
            ? "启用后 " + (disableTarget?.name ?? "") + " 可以继续下单。"
            : "停用后 " + (disableTarget?.name ?? "") + " 不能继续下单，余额与流水保留。"
        }
        confirmLabel={disableTargetEnabling ? "确认启用" : "确认停用"}
        destructive={!disableTargetEnabling}
        onConfirm={() => {
          if (disableTarget === null) return;
          disableUser.mutate(disableTarget, { onSettled: () => setDisableTarget(null) });
        }}
      />
    </div>
  );
}
