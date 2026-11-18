import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { apiList, ENDPOINTS } from "@/lib/api";
import { fmtCny, fmtInt } from "@/lib/format";
import { METRIC_ICONS } from "@/lib/metric-icons";
import { usePermissions } from "@/lib/permissions";
import type { ChargeEntry, PublicModel } from "@/types";

import { MoneyStack, TokenCell } from "./cells";

interface UserRow {
  id: string;
  name: string;
}

/** 运营账单·营收：对外计费流水；花费与成本合并为一列（ticket 17）。 */
export function RevenuePanel() {
  const { can } = usePermissions();
  const showCost = can("billing:cost");
  const q = useQuery({ queryKey: ["charge-entries"], queryFn: () => apiList<ChargeEntry>(ENDPOINTS.chargeEntries) });
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => apiList<UserRow>(ENDPOINTS.users) });
  const modelsQ = useQuery({ queryKey: ["public-models"], queryFn: () => apiList<PublicModel>(ENDPOINTS.publicModels) });

  const userName = (id: string) => usersQ.data?.items.find((u) => u.id === id)?.name ?? id;
  const modelName = (id: string) => modelsQ.data?.items.find((m) => m.id === id)?.name ?? id;

  const columns: ColumnDef<ChargeEntry, unknown>[] = [
    { accessorKey: "id", header: "流水号", cell: (c) => <span className="tnum text-2xs">{c.row.original.id}</span> },
    {
      id: "user",
      accessorFn: (r) => userName(r.user_id),
      header: "用户",
      cell: (c) => (
        <Link to="/users" className="text-primary-text hover:underline">
          {String(c.getValue())}
        </Link>
      ),
    },
    { id: "model", accessorFn: (r) => modelName(r.public_model_id), header: "对外模型", cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    {
      id: "tokens",
      header: "词元",
      cell: (c) => <TokenCell input={c.row.original.input_tokens} output={c.row.original.output_tokens} />,
    },
    {
      id: "money",
      header: showCost ? "花费 / 成本" : "花费",
      cell: (c) => (
        <MoneyStack
          charge={c.row.original.status === "unpriced" ? null : c.row.original.amount_micro}
          cost={c.row.original.cost_micro}
          currency={c.row.original.currency}
          showCost={showCost}
          unpriced={c.row.original.status === "unpriced" ? 1 : 0}
        />
      ),
    },
    {
      id: "status",
      header: "状态",
      cell: (c) =>
        c.row.original.status === "ok" ? (
          <Badge tone="success">已计费</Badge>
        ) : c.row.original.status === "free" ? (
          <Badge tone="info">免费</Badge>
        ) : (
          <Badge tone="warning">待补价</Badge>
        ),
    },
  ];

  const entries = q.data?.items ?? [];
  const loaded = q.data !== undefined;
  const totalChargeMicro = entries.reduce((sum, row) => sum + (row.status === "unpriced" ? 0 : row.amount_micro), 0);
  const totalCostMicro = entries.reduce((sum, row) => sum + (row.cost_micro ?? 0), 0);
  const unpriced = entries.filter((row) => row.status === "unpriced").length;
  const error = q.isError ? (q.error as Error).message : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="花费合计"
          icon={METRIC_ICONS.charge.icon}
          tone={METRIC_ICONS.charge.tone}
          value={loaded ? (entries.length > 0 ? fmtCny(totalChargeMicro) : "—") : undefined}
          loading={q.isPending}
          error={error}
          onRetry={() => void q.refetch()}
          hint={loaded ? "已加载 " + entries.length + " 条花费流水" : "下游价目表营收账"}
        />
        {showCost && (
          <MetricCard
            label="成本合计"
            icon={METRIC_ICONS.cost.icon}
            tone={METRIC_ICONS.cost.tone}
            value={loaded && entries.length > 0 ? fmtCny(totalCostMicro) : loaded ? "—" : undefined}
            loading={q.isPending}
            hint="同批事件的上游成本"
          />
        )}
        <MetricCard
          label="词元合计"
          icon={METRIC_ICONS.tokens.icon}
          tone={METRIC_ICONS.tokens.tone}
          value={loaded ? (entries.length > 0 ? fmtInt(entries.reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0)) : "—") : undefined}
          loading={q.isPending}
          hint="输入 + 输出"
        />
        <MetricCard
          label="待补价"
          icon={METRIC_ICONS.unpriced.icon}
          tone={unpriced > 0 ? "danger" : METRIC_ICONS.unpriced.tone}
          value={loaded ? fmtInt(unpriced) : undefined}
          loading={q.isPending}
          hint="未定价不写 0，补价后重算"
        />
      </div>
      <p className="text-2xs text-faint">营收为对外计费口径（charge），成本来自同一事件的成本流水；两列合并在「花费 / 成本」单元格内，不相加。</p>
      <DataTable
        columns={columns}
        data={q.data?.items}
        loading={q.isPending}
        error={error}
        onRetry={() => void q.refetch()}
        emptyText="暂无营收流水"
        filterPlaceholder="筛选流水号 / 用户 / 模型"
      />
    </div>
  );
}
