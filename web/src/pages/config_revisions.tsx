import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "@/lib/notify";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { fmtMs } from "@/lib/format";
import { ACTION_ICONS } from "@/lib/icons";
import { revisionStatusMeta } from "@/lib/revision-status";
import { usePermissions } from "@/lib/permissions";
import type { ConfigRevision } from "@/types";
import { PageHeader } from "@/components/layout/page-header";

/**
 * 配置版本（统一列表规范）：版本号/操作人/状态徽标/时间/备注 + 详情抽屉
 * （变更摘要 / artifact 摘要 / 失败详情）+ 回滚（红色确认，写明将下发旧配置）。
 */

// docs/api-contract.md：POST /admin/config/rollback/{revision_id}；lib/api.ts 的
// ENDPOINTS 没有这条（本工位不改 lib），故在页面内按同一前缀拼写。
const ROLLBACK_ENDPOINT_PREFIX = "/admin/config/rollback/";

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制" + label);
  } catch {
    toast.error("复制失败，请手动选中复制");
  }
}

function RevisionDetailDrawer({ row, open, onOpenChange }: {
  row: ConfigRevision | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canRollback = can("config:write");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const meta = row ? revisionStatusMeta(row.status) : null;
  const failed = row?.status === "failed";

  const rollback = useMutation({
    mutationFn: (revisionId: string) =>
      api.post<ConfigRevision>(ROLLBACK_ENDPOINT_PREFIX + encodeURIComponent(revisionId)),
    onSuccess: (revision) => {
      toast.success("已回滚并下发旧配置", { description: "生成新版本 " + revision.id });
      setConfirmOpen(false);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["config-revisions"] });
      void queryClient.invalidateQueries({ queryKey: ["config-status"] });
    },
    onError: (error) => {
      setConfirmOpen(false);
      toast.error("回滚失败", { description: error.message });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-lg">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="tnum">版本 {row?.id ?? "—"}</span>
            {meta && <Badge tone={meta.tone}>{meta.label}</Badge>}
          </SheetTitle>
          <SheetDescription className="text-2xs">
            {row ? fmtMs(row.created_at_ms) : "—"} · 配置发布不可变：回滚生成新版本而不是原地改
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-3">
          <section className="space-y-1.5">
            <p className="text-2xs font-medium text-title">变更摘要</p>
            <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-2xs">
              <dt className="text-faint">操作人</dt>
              <dd className="text-body">{row?.operator || "—"}</dd>
              <dt className="text-faint">备注</dt>
              <dd className="text-body">{row?.reason || "—"}</dd>
              <dt className="text-faint">适配器</dt>
              <dd className="font-mono text-body">{row?.adapter_id || "—"}</dd>
              <dt className="text-faint">上一版本</dt>
              <dd className="tnum font-mono text-body">{row?.previous_revision_id ?? "—"}</dd>
            </dl>
          </section>

          <section className="space-y-1.5">
            <p className="text-2xs font-medium text-title">Artifact 摘要</p>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded border border-border bg-surface-2 px-2 py-1 font-mono text-2xs text-body">
                {row?.artifact_hash || "—"}
              </code>
              {row && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText(row.artifact_hash, "Artifact 哈希")}
                >
                  <ACTION_ICONS.copy className="h-3.5 w-3.5" />
                  复制
                </Button>
              )}
            </div>
          </section>

          {(failed || (row?.error_detail ?? "") !== "" || (row?.validation_note ?? "") !== "") && (
            <section className="space-y-1.5">
              <p className="text-2xs font-medium text-title">失败详情</p>
              {failed && (row?.error_detail ?? "") !== "" ? (
                <pre className="overflow-x-auto rounded-md border border-danger bg-danger-soft p-2 font-mono text-2xs leading-5 text-danger-text">
                  {row?.error_detail}
                </pre>
              ) : (
                <p className="text-2xs text-faint">{row?.error_detail || "该版本未记录失败详情。"}</p>
              )}
              {(row?.validation_note ?? "") !== "" && (
                <p className="text-2xs text-faint">校验备注：{row?.validation_note}</p>
              )}
            </section>
          )}

          {row && (
            <div className="border-t border-border pt-3">
              <Button
                variant="danger"
                size="sm"
                disabled={!canRollback || rollback.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                <ACTION_ICONS.undo className="h-3.5 w-3.5" /> 回滚到此版本
              </Button>
              {!canRollback && (
                <p className="mt-1 text-2xs text-faint">回滚需要 config:write 权限。</p>
              )}
            </div>
          )}
        </div>
      </SheetContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title={"回滚到版本 " + (row?.id ?? "") + "？"}
        confirmLabel={rollback.isPending ? "回滚中…" : "确认回滚"}
        description={
          "回滚到该版本将下发旧配置：数据面会重新加载该版本的渲染产物，覆盖当前生效配置；" +
          "回滚本身会生成新版本留档，可再次回滚撤销。确认要继续吗？"
        }
        onConfirm={() => {
          if (row) rollback.mutate(row.id);
        }}
      />
    </Sheet>
  );
}

export function ConfigRevisionsPage() {
  const q = useQuery({ queryKey: ["config-revisions"], queryFn: () => apiList<ConfigRevision>(ENDPOINTS.configRevisions) });
  const [detailRow, setDetailRow] = useState<ConfigRevision | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const columns: ColumnDef<ConfigRevision, unknown>[] = [
    {
      accessorKey: "id",
      header: "版本",
      meta: { className: "text-right tnum" },
      cell: (c) => <span className="tnum">{c.row.original.id}</span>,
    },
    { accessorKey: "operator", header: "操作人" },
    {
      accessorKey: "status",
      header: "状态",
      cell: (c) => {
        const meta = revisionStatusMeta(c.row.original.status);
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
    },
    {
      accessorKey: "created_at_ms",
      header: "时间",
      meta: { className: "text-right tnum" },
      cell: (c) => <span className="tnum text-2xs">{fmtMs(c.row.original.created_at_ms)}</span>,
    },
    {
      accessorKey: "reason",
      header: "备注",
      cell: (c) => (
        <span className="block max-w-80 truncate text-2xs text-faint">{c.row.original.reason || "—"}</span>
      ),
    },
    {
      id: "actions",
      header: "操作",
      enableSorting: false,
      meta: { sticky: "right" },
      cell: (c) => (
        <Button
          variant="ghost"
          size="dense"
          onClick={() => {
            setDetailRow(c.row.original);
            setDrawerOpen(true);
          }}
        >
          <ACTION_ICONS.view className="h-3.5 w-3.5" /> 详情
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="配置版本"
        description="配置发布不可变：每次变更新建版本；回滚生成新版本，而不是原地修改历史。"
      />
      <DataTable
        columns={columns}
        data={q.data?.items}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        emptyText="暂无配置版本"
        filterPlaceholder="筛选版本 / 操作人 / 备注"
        storageKey="slipstream.cols.config-revisions"
      />
      <RevisionDetailDrawer row={detailRow} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
