import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ENDPOINTS } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import { METRIC_ICONS } from "@/lib/metric-icons";
import { usePermissions } from "@/lib/permissions";
import type { ChargeEntry, CostEntry } from "@/types";

import { TokenCell } from "./cells";

// 稳定引用：`?? []` 每次渲染新建数组会让 TanStack Table 的行模型 memo 反复判定数据变化，
// 触发 _autoResetPageIndex → setState → 再渲染的同步死循环（真实浏览器主线程卡死）。
const EMPTY_COST_ROWS: CostEntry[] = [];
const EMPTY_CHARGE_ROWS: ChargeEntry[] = [];

/** 运营账单·待补价：成本/花费两张缺口表，补价调用批量 recompute（ticket 17 并入 tabs）。 */
export function UnpricedPanel() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canReprice = can("prices:write");
  const q = useQuery({ queryKey: ["unpriced"], queryFn: () => api.get<{ cost: CostEntry[]; charge: ChargeEntry[] }>(ENDPOINTS.unpriced) });

  const reprice = useMutation({
    mutationFn: (eventId: string) => api.post<unknown>(ENDPOINTS.unpricedRecompute, { event_ids: [eventId] }),
    onSuccess: () => {
      toast.success("已补价并重算");
      void qc.invalidateQueries({ queryKey: ["unpriced"] });
      void qc.invalidateQueries({ queryKey: ["cost-entries"] });
      void qc.invalidateQueries({ queryKey: ["charge-entries"] });
      void qc.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (e: Error) => toast.error("补价失败", { description: e.message }),
  });

  const costColumns: ColumnDef<CostEntry, unknown>[] = [
    { accessorKey: "id", header: "流水号", cell: (c) => <span className="tnum text-2xs">{c.row.original.id}</span> },
    {
      id: "source",
      header: "来源",
      cell: (c) => (
        <div className="space-y-0.5">
          <div className="text-2sm text-body">{c.row.original.vendor_id}</div>
          <div className="tnum text-2xs text-faint">{c.row.original.upstream_model_id}</div>
        </div>
      ),
    },
    {
      id: "tokens",
      header: "词元",
      cell: (c) => <TokenCell input={c.row.original.input_tokens} output={c.row.original.output_tokens} />,
    },
    {
      id: "fix",
      header: "缺口 / 操作",
      cell: (c) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="warning">缺上游成本价</Badge>
          {canReprice ? (
            <Button size="sm" variant="outline" disabled={reprice.isPending} onClick={() => reprice.mutate(c.row.original.gateway_event_id)}>
              补价并重算
            </Button>
          ) : (
            <span className="text-2xs text-faint">需 prices:write</span>
          )}
        </div>
      ),
    },
  ];

  const chargeColumns: ColumnDef<ChargeEntry, unknown>[] = [
    { accessorKey: "id", header: "流水号", cell: (c) => <span className="tnum text-2xs">{c.row.original.id}</span> },
    {
      id: "source",
      header: "来源",
      cell: (c) => (
        <div className="space-y-0.5">
          <div className="text-2sm text-body">{c.row.original.user_id}</div>
          <div className="tnum text-2xs text-faint">{c.row.original.public_model_id}</div>
        </div>
      ),
    },
    {
      id: "tokens",
      header: "词元",
      cell: (c) => <TokenCell input={c.row.original.input_tokens} output={c.row.original.output_tokens} />,
    },
    {
      id: "fix",
      header: "缺口 / 操作",
      cell: (c) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="warning">缺对外花费价</Badge>
          {canReprice ? (
            <Button size="sm" variant="outline" disabled={reprice.isPending} onClick={() => reprice.mutate(c.row.original.gateway_event_id)}>
              补价并重算
            </Button>
          ) : (
            <span className="text-2xs text-faint">需 prices:write</span>
          )}
        </div>
      ),
    },
  ];

  const costItems = q.data?.cost ?? EMPTY_COST_ROWS;
  const chargeItems = q.data?.charge ?? EMPTY_CHARGE_ROWS;
  const loaded = q.data !== undefined;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="缺上游成本价"
          icon={METRIC_ICONS.unpriced.icon}
          tone={costItems.length > 0 ? "warning" : "neutral"}
          value={loaded ? fmtInt(costItems.length) : undefined}
          loading={q.isPending}
          error={q.isError ? (q.error as Error).message : null}
          onRetry={() => void q.refetch()}
          hint="成本账里未能定价的流水"
        />
        <MetricCard
          label="缺对外花费价"
          icon={METRIC_ICONS.errors.icon}
          tone={chargeItems.length > 0 ? "danger" : "neutral"}
          value={loaded ? fmtInt(chargeItems.length) : undefined}
          loading={q.isPending}
          hint="花费账里未能定价的流水"
        />
      </div>
      <p className="text-2xs text-faint">未计价流水不写 0：补价后按新价目版本重算并回填成本 / 花费金额。</p>
      <section className="space-y-1">
        <p className="text-2sm font-medium text-title">缺上游成本价（{costItems.length}）</p>
        <DataTable
          columns={costColumns}
          data={costItems}
          loading={q.isPending}
          error={q.isError ? (q.error as Error).message : null}
          onRetry={() => void q.refetch()}
          emptyText="没有待补价的成本流水"
        />
      </section>
      <section className="space-y-1">
        <p className="text-2sm font-medium text-title">缺对外花费价（{chargeItems.length}）</p>
        <DataTable
          columns={chargeColumns}
          data={chargeItems}
          loading={q.isPending}
          error={q.isError ? (q.error as Error).message : null}
          onRetry={() => void q.refetch()}
          emptyText="没有待补价的花费流水"
        />
      </section>
    </div>
  );
}
