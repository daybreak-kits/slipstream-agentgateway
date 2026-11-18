import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { apiList, ENDPOINTS } from "@/lib/api";
import { revisionStatusMeta } from "@/lib/revision-status";
import type { ConfigRevision } from "@/types";

export function ConfigRevisionsPage() {
  const q = useQuery({ queryKey: ["config-revisions"], queryFn: () => apiList<ConfigRevision>(ENDPOINTS.configRevisions) });

  const columns: ColumnDef<ConfigRevision, unknown>[] = [
    { accessorKey: "id", header: "版本", cell: (c) => <span className="tnum">{c.row.original.id}</span> },
    {
      accessorKey: "artifact_hash",
      header: "Artifact",
      cell: (c) => <span className="tnum font-mono text-2xs">{String(c.row.original.artifact_hash).slice(0, 12)}…</span>,
    },
    { accessorKey: "adapter_id", header: "适配器" },
    { accessorKey: "operator", header: "操作人" },
    { accessorKey: "reason", header: "原因", cell: (c) => <span className="text-2xs text-faint">{c.row.original.reason || "—"}</span> },
    {
      accessorKey: "status",
      header: "状态",
      cell: (c) => {
        const meta = revisionStatusMeta(c.row.original.status);
        const detail = c.row.original.error_detail || c.row.original.validation_note;
        return (
          <span title={detail ?? undefined}>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </span>
        );
      },
    },
    {
      accessorKey: "previous_revision_id",
      header: "上一版本",
      cell: (c) => <span className="tnum text-2xs">{c.row.original.previous_revision_id ?? "—"}</span>,
    },
    {
      accessorKey: "created_at_ms",
      header: "创建时间",
      cell: (c) => <span className="tnum text-2xs">{new Date(c.row.original.created_at_ms).toISOString().slice(0, 19).replace("T", " ")}</span>,
    },
  ];

  return (
    <div className="space-y-2">
      <p className="text-2xs text-faint">配置发布不可变：每次变更新建版本并指向上一个版本；回滚生成新版本而不是原地改。</p>
      <DataTable
        columns={columns}
        data={q.data?.items}
        loading={q.isPending}
        error={q.isError ? (q.error as Error).message : null}
        onRetry={() => void q.refetch()}
        emptyText="暂无配置版本"
        filterPlaceholder="筛选版本 / 适配器 / 操作人"
      />
    </div>
  );
}