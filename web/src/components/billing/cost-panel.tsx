import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { apiList, ENDPOINTS } from "@/lib/api";
import { fmtCny, fmtInt } from "@/lib/format";
import { METRIC_ICONS } from "@/lib/metric-icons";
import type { CostEntry, UpstreamModel, Vendor } from "@/types";

import { MoneyStack, TokenCell } from "./cells";

/** 运营账单·成本：只读成本流水，列已按 ticket 17 合并（词元、金额/状态）。 */
export function CostPanel() {
  const q = useQuery({ queryKey: ["cost-entries"], queryFn: () => apiList<CostEntry>(ENDPOINTS.costEntries) });
  const vendorsQ = useQuery({ queryKey: ["vendors"], queryFn: () => apiList<Vendor>(ENDPOINTS.vendors) });
  const modelsQ = useQuery({ queryKey: ["upstream-models"], queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels) });

  const vendorName = (id: string) => vendorsQ.data?.items.find((v) => v.id === id)?.name ?? id;
  const modelLabel = (id: string) => {
    const um = modelsQ.data?.items.find((m) => m.id === id);
    if (!um) return id;
    return um.upstream_name ? um.name + "（" + um.upstream_name + "）" : um.name;
  };

  const columns: ColumnDef<CostEntry, unknown>[] = [
    { accessorKey: "id", header: "流水号", cell: (c) => <span className="tnum text-2xs">{c.row.original.id}</span> },
    { id: "vendor", accessorFn: (r) => vendorName(r.vendor_id), header: "厂商", cell: (c) => <span>{String(c.getValue())}</span> },
    { id: "model", accessorFn: (r) => modelLabel(r.upstream_model_id), header: "上游模型", cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    {
      id: "tokens",
      header: "词元",
      cell: (c) => <TokenCell input={c.row.original.input_tokens} output={c.row.original.output_tokens} />,
    },
    {
      id: "money",
      header: "成本",
      cell: (c) => (
        <MoneyStack
          charge={c.row.original.status === "unpriced" ? null : c.row.original.amount_micro}
          currency={c.row.original.currency}
          unpriced={c.row.original.status === "unpriced" ? 1 : 0}
        />
      ),
    },
    {
      id: "status",
      header: "状态",
      cell: (c) => (
        <div className="space-y-0.5">
          {c.row.original.status === "ok" ? (
            <Badge tone="success">已计价</Badge>
          ) : c.row.original.status === "free" ? (
            <Badge tone="info">免费</Badge>
          ) : (
            <Badge tone="warning">待补价</Badge>
          )}
          <div className="tnum text-2xs text-faint">版本 {c.row.original.price_version_id ?? "—"}</div>
        </div>
      ),
    },
  ];

  const entries = q.data?.items ?? [];
  const loaded = q.data !== undefined;
  const totalCostMicro = entries.reduce((sum, row) => sum + row.amount_micro, 0);
  const inputTokens = entries.reduce((sum, row) => sum + row.input_tokens, 0);
  const outputTokens = entries.reduce((sum, row) => sum + row.output_tokens, 0);
  const unpriced = entries.filter((row) => row.status === "unpriced").length;
  const error = q.isError ? (q.error as Error).message : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="成本合计"
          icon={METRIC_ICONS.cost.icon}
          tone={METRIC_ICONS.cost.tone}
          value={loaded ? (entries.length > 0 ? fmtCny(totalCostMicro) : "—") : undefined}
          loading={q.isPending}
          error={error}
          onRetry={() => void q.refetch()}
          hint={loaded ? "已加载 " + entries.length + " 条成本流水" : "上游价目表成本账"}
        />
        <MetricCard
          label="词元合计"
          icon={METRIC_ICONS.tokens.icon}
          tone={METRIC_ICONS.tokens.tone}
          value={loaded ? (entries.length > 0 ? fmtInt(inputTokens + outputTokens) : "—") : undefined}
          loading={q.isPending}
          hint={loaded ? "输入 " + fmtInt(inputTokens) + " · 输出 " + fmtInt(outputTokens) : undefined}
        />
        <MetricCard
          label="流水条数"
          icon={METRIC_ICONS.requests.icon}
          tone={METRIC_ICONS.requests.tone}
          value={loaded ? fmtInt(entries.length) : undefined}
          loading={q.isPending}
          hint="每次上游调用一条成本流水"
        />
        <MetricCard
          label="待补价"
          icon={METRIC_ICONS.unpriced.icon}
          tone={unpriced > 0 ? "danger" : METRIC_ICONS.unpriced.tone}
          value={loaded ? fmtInt(unpriced) : undefined}
          loading={q.isPending}
          hint="未定价不写 0，补价后按新版本重算"
        />
      </div>
      <p className="text-2xs text-faint">成本为运营口径：按上游厂商价目折算（整数微单位存储）。厂商与模型名由 vendors / upstream-models 列表 join 得出，未命中时回落到原始 id。</p>
      <DataTable
        columns={columns}
        data={q.data?.items}
        loading={q.isPending}
        error={error}
        onRetry={() => void q.refetch()}
        emptyText="暂无成本流水"
        filterPlaceholder="筛选流水号 / 厂商 / 模型"
        storageKey="slipstream.cols.billing-cost"
      />
    </div>
  );
}
