import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";

import { DataTable } from "@/components/data-table";
import { api, ENDPOINTS } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import type { AuditLog, AuditLogList } from "@/types";

const columns: ColumnDef<AuditLog, unknown>[] = [
  { accessorKey: "created_at", header: "时间", cell: (c) => <span className="tnum">{fmtTime(c.row.original.created_at)}</span> },
  { accessorKey: "actor", header: "操作人" },
  { accessorKey: "action", header: "动作", cell: (c) => <span className="tnum">{c.row.original.action}</span> },
  { accessorKey: "target", header: "目标", cell: (c) => <span className="tnum">{c.row.original.target}</span> },
  { accessorKey: "detail", header: "详情", cell: (c) => <span className="text-2xs text-body">{c.row.original.detail}</span> },
];

export function AuditLogsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const { data, isPending } = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ["audit-logs", page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      return api.get<AuditLogList>(ENDPOINTS.auditLogs + "?" + params.toString());
    },
  });

  useEffect(() => {
    if (!data) return;
    const maxPage = Math.max(0, Math.ceil(data.total / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [data, page, pageSize]);

  return (
    <DataTable
      columns={columns}
      data={data?.items}
      loading={isPending}
      emptyText="没有审计记录"
      paging={{
        mode: "server",
        offset: page * pageSize,
        pageSize,
        total: data?.total ?? 0,
        onOffsetChange: (offset) => setPage(Math.floor(offset / pageSize)),
        onPageSizeChange: (size) => {
          setPage(0);
          setPageSize(size);
        },
      }}
    />
  );
}
