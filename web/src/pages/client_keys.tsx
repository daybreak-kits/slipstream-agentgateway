import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "@/lib/notify";

import { CopyKeyButton } from "@/components/keys/copy-key-button";
import { RenameKeyDialog } from "@/components/keys/rename-key-dialog";
import { DataTable } from "@/components/data-table";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtMs } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import { OneTimeSecretDialog } from "@/components/users/one-time-secret-dialog";
import { ENDPOINTS, api } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import type { ApiKey } from "@/types";
import { PageHeader } from "@/components/layout/page-header";

const KEYS_QUERY_KEY = ["api-keys"] as const;

/**
 * 连接密钥（ADR-023）：掩码常驻、明文只经审计化 reveal 取回；
 * 充值入口移到用户管理，每用户最多 50 把。启停可逆不弹确认，
 * 重置（rotate）与删除走危险操作确认。
 */
export function ClientKeysPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canWrite = can("apikeys:write");

  const qKeys = useQuery({
    queryKey: KEYS_QUERY_KEY,
    queryFn: () => api.get<ApiKey[]>(ENDPOINTS.apiKeys + "?page_size=200&offset=0"),
  });

  const [renameTarget, setRenameTarget] = useState<ApiKey | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  /** rotate 返回的新明文：仅弹窗存活期可见，关闭即不再持有 */
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  /** 签发（W6 流程 2 补口）：选用户 + 可选名称 → 明文一次性弹窗 */
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [issueUserId, setIssueUserId] = useState("");
  const [issueName, setIssueName] = useState("");

  const usersQ = useQuery({
    queryKey: ["admin-users-lite"],
    queryFn: () => api.get<Array<{ id: string; name: string; status: string }>>(ENDPOINTS.users + "?page_size=200&offset=0"),
    enabled: canWrite,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
  };

  const issue = useMutation({
    mutationFn: (vars: { userId: string; name: string }) =>
      // ApiKeyIssue.user_id 必填（后端按 body 内 user_id 归属），路径 user_id 仅供路由
      api.post<{ id: string; key: string; mask: string }>(
        ENDPOINTS.users + "/" + vars.userId + "/api-keys",
        { user_id: vars.userId, ...(vars.name.trim() ? { name: vars.name.trim() } : {}) },
      ),
    onSuccess: (result) => {
      setIssueOpen(false);
      setIssueUserId("");
      setIssueName("");
      setIssuedSecret(result.key);
      invalidate();
    },
    onError: (error: Error) => toast.error("签发密钥失败", { description: error.message }),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { keyId: string; status: "active" | "disabled" }) =>
      api.patch<ApiKey>(ENDPOINTS.apiKeys + "/" + vars.keyId + "/status", { status: vars.status }),
    onSuccess: (key) => {
      toast.success(key.status === "active" ? "密钥已启用" : "密钥已关闭", {
        description: key.name ?? key.key_suffix,
      });
      invalidate();
    },
    onError: (error: Error) => toast.error("状态更新失败", { description: error.message }),
  });

  const rename = useMutation({
    mutationFn: (vars: { keyId: string; name: string }) =>
      api.patch<ApiKey>(ENDPOINTS.apiKeys + "/" + vars.keyId, { name: vars.name }),
    onSuccess: (key) => {
      toast.success("密钥已重命名", { description: key.name ?? undefined });
      setRenameTarget(null);
      invalidate();
    },
    onError: (error: Error) => toast.error("重命名失败", { description: error.message }),
  });

  const rotate = useMutation({
    mutationFn: (keyId: string) => api.post<{ key: string }>(ENDPOINTS.apiKeyRotate(keyId), {}),
    onSuccess: (data) => {
      setRotateTarget(null);
      setRotatedSecret(data.key);
      toast.success("密钥已重置", { description: "旧密钥材料随本次下发失效" });
      invalidate();
    },
    onError: (error: Error) => {
      setRotateTarget(null);
      toast.error("重置密钥失败", { description: error.message });
    },
  });

  const deleteKey = useMutation({
    mutationFn: (keyId: string) => api.del<void>(ENDPOINTS.apiKeys + "/" + keyId),
    onSuccess: () => {
      toast.success("密钥已删除", { description: "删除立即生效，不可恢复" });
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error: Error) => {
      setDeleteTarget(null);
      toast.error("删除密钥失败", { description: error.message });
    },
  });

  const columns: ColumnDef<ApiKey, unknown>[] = [
    {
      accessorKey: "name",
      header: "名称",
      cell: (cell) => (
        <span className="font-medium text-title">{cell.row.original.name ?? "未命名密钥"}</span>
      ),
    },
    {
      accessorKey: "mask",
      header: "密钥",
      cell: (cell) => (
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-2xs tnum">{cell.row.original.mask}</span>
          {canWrite && <CopyKeyButton keyId={cell.row.original.id} />}
        </span>
      ),
    },
    {
      accessorKey: "last_used_at_ms",
      header: "最后使用",
      meta: { className: "text-right tnum" },
      cell: (cell) => {
        const usedAt = cell.row.original.last_used_at_ms;
        return <span className="tnum text-2xs">{usedAt ? fmtMs(usedAt) : "—"}</span>;
      },
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: (cell) => {
        const active = cell.row.original.status === "active";
        // 关闭是可逆启停（非终态），用 warning 提示「被人为关闭」而不是中性灰（DESIGN-AUDIT 四期 §16）。
        return <Badge tone={active ? "success" : "warning"}>{active ? "启用" : "关闭"}</Badge>;
      },
    },
    {
      accessorKey: "created_at_ms",
      header: "创建时间",
      meta: { className: "text-right tnum" },
      cell: (cell) => <span className="tnum text-2xs">{fmtMs(cell.row.original.created_at_ms)}</span>,
    },
    {
      id: "actions",
      header: "操作",
      meta: { sticky: "right" },
      cell: (cell) => {
        if (!canWrite) return <span className="text-2xs text-faint">只读</span>;
        const key = cell.row.original;
        const active = key.status === "active";
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionButton
              action={active ? "disable" : "enable"}
              size="dense"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ keyId: key.id, status: active ? "disabled" : "active" })}
            >
              {active ? "关闭" : "启用"}
            </ActionButton>
            <ActionButton action="rename" size="dense" onClick={() => setRenameTarget(key)}>
              重命名
            </ActionButton>
            <ActionButton action="resetKey" size="dense" onClick={() => setRotateTarget(key)}>
              重置
            </ActionButton>
            <ActionButton action="delete" size="dense" onClick={() => setDeleteTarget(key)}>
              删除
            </ActionButton>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="连接密钥"
        description="密钥只显示掩码；复制明文会写入审计记录。每用户最多 50 把，余额耗尽后请求返回 429。 "
      />
      {canWrite && (
        <div className="flex items-center justify-end">
          <Button variant="primary" size="sm" onClick={() => setIssueOpen(true)}>
            <ACTION_ICONS.add className="h-3.5 w-3.5" /> 新建密钥
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        data={qKeys.data}
        loading={qKeys.isPending}
        error={qKeys.isError ? (qKeys.error as Error).message : null}
        onRetry={() => void qKeys.refetch()}
        emptyText="还没有连接密钥"
        filterPlaceholder="筛选名称 / 掩码"
        storageKey="slipstream.cols.client-keys"
      />

      <Dialog open={issueOpen} onOpenChange={(next) => { if (!next) setIssueOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建连接密钥</DialogTitle>
            <DialogDescription>
              为所选用户签发一把 sk- 连接密钥；明文只在创建后展示一次，请立即复制保存。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-2sm text-title" htmlFor="issue-user">用户</label>
              <Select value={issueUserId} onValueChange={setIssueUserId}>
                <SelectTrigger id="issue-user" className="w-full">
                  <SelectValue placeholder="选择用户" />
                </SelectTrigger>
                <SelectContent>
                  {(usersQ.data ?? []).map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-2sm text-title" htmlFor="issue-name">名称（可选）</label>
              <Input
                id="issue-name"
                value={issueName}
                onChange={(event) => setIssueName(event.target.value)}
                placeholder="默认 密钥 N"
                maxLength={255}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)} disabled={issue.isPending}>
              取消
            </Button>
            <Button
              onClick={() => issue.mutate({ userId: issueUserId, name: issueName })}
              disabled={issue.isPending || !issueUserId}
            >
              <ACTION_ICONS.issueKey className="h-3.5 w-3.5" />
              {issue.isPending ? "签发中…" : "签发密钥"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OneTimeSecretDialog
        open={issuedSecret !== null}
        title="连接密钥已签发"
        description="此明文仅显示一次，关闭后不再展示；请立即复制保存。"
        secret={issuedSecret ?? ""}
        onClose={() => setIssuedSecret(null)}
      />

      <RenameKeyDialog
        open={renameTarget !== null}
        keyName={renameTarget?.name ?? null}
        pending={rename.isPending}
        onClose={() => setRenameTarget(null)}
        onSubmit={(name) => {
          if (renameTarget === null) return;
          rename.mutate({ keyId: renameTarget.id, name });
        }}
      />

      <ConfirmDialog
        open={rotateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRotateTarget(null);
        }}
        title={"重置密钥「" + (rotateTarget?.name ?? rotateTarget?.key_suffix ?? "") + "」？"}
        description="重置会生成新密钥材料，旧密钥在本次下发后立即失效；新密钥明文仅展示一次，请先复制再关闭。"
        confirmLabel="重置密钥"
        destructive
        onConfirm={() => {
          if (rotateTarget === null) return;
          rotate.mutate(rotateTarget.id);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={"删除密钥「" + (deleteTarget?.name ?? deleteTarget?.key_suffix ?? "") + "」？"}
        description="删除后该密钥立即失效且不可恢复，使用它的客户端会收到 401。此操作不可撤销。"
        confirmLabel="删除密钥"
        destructive
        onConfirm={() => {
          if (deleteTarget === null) return;
          deleteKey.mutate(deleteTarget.id);
        }}
      />

      <OneTimeSecretDialog
        open={rotatedSecret !== null}
        title="新密钥已生成"
        description="此密钥仅显示一次，请立即复制保存；关闭后不再可见。"
        secret={rotatedSecret ?? ""}
        showRecopy
        onClose={() => setRotatedSecret(null)}
      />
    </div>
  );
}
