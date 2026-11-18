import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard } from "@/components/dashboard/chart-card";
import { fmtMicroYuan } from "@/components/dashboard/chart-format";
import { useChartPalette, type ChartPalette } from "@/components/dashboard/chart-theme";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/stat-card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Empty } from "@/components/ui/empty";
import { api, ENDPOINTS } from "@/lib/api";
import { fmtCny, fmtInt } from "@/lib/format";
import { METRIC_ICONS } from "@/lib/metric-icons";
import { usePermissions } from "@/lib/permissions";
import type { MySpendResponse, SpendDimension } from "@/types";

import { MoneyStack, TokenCell } from "./cells";

const RANGES = [
  { value: "today", label: "今天" },
  { value: "24h", label: "24 时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "365d", label: "365 天" },
] as const;

type SpendRange = (typeof RANGES)[number]["value"];
type SpendScope = "self" | "subtree";

function money(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : fmtCny(value);
}

function bucketText(bucket: "hour" | "day" | undefined): string {
  return bucket === "hour" ? "小时" : "日";
}

interface SpendTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>;
  palette: ChartPalette;
}

function SpendTooltip({ active, label, payload, palette }: SpendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-md border px-2.5 py-1.5 text-2xs shadow-sm"
      style={{ background: palette.surface, borderColor: palette.border, color: palette.text }}
    >
      <div className="mb-1 font-medium" style={{ color: palette.text }}>
        {label ?? ""}
      </div>
      {payload.map((item) => (
        <div key={String(item.dataKey)} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: item.color }} />
          <span style={{ color: palette.faint }}>{item.name ?? ""}</span>
          <span className="tnum font-medium" style={{ color: palette.text }}>
            {fmtCny(Number(item.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 我的花费（ticket 17）：按时间范围聚合当前账号或子树，字段随 billing:cost 裁剪。
 * 成本/毛利键在无权限时根本不存在，页面用 === undefined 判断，而不是依赖 null。
 */
export function MySpendPanel() {
  const { can } = usePermissions();
  const [range, setRange] = useState<SpendRange>("30d");
  const [scope, setScope] = useState<SpendScope>("self");
  const palette = useChartPalette();

  const canSubtree = can("billing:subtree");
  const canCost = can("billing:cost");
  const query = useQuery({
    queryKey: ["bills", "my-spend", range, scope],
    queryFn: () =>
      api.get<MySpendResponse>(
        ENDPOINTS.mySpend + "?range=" + range + "&scope=" + scope,
      ),
    staleTime: 30_000,
  });

  const data = query.data;
  const summary = data?.summary;
  const showCost = canCost && summary?.cost_micro !== undefined;
  const showMargin = canCost && summary?.margin_micro !== undefined;
  const rangeLabel = RANGES.find((item) => item.value === range)?.label ?? range;
  const bucket = bucketText(data?.bucket);

  const rows = (data?.series ?? []).map((point) => ({
    label: point.label,
    charge: point.charge_micro,
    cost: showCost ? (point.cost_micro ?? null) : null,
  }));
  const isEmpty = data !== undefined && data.summary.requests === 0;

  const dimensionColumns: ColumnDef<SpendDimension, unknown>[] = [
    {
      accessorKey: "name",
      header: "名称",
      cell: (c) => (
        <div className="min-w-0">
          <div className="truncate text-2sm text-body">{c.row.original.name}</div>
          {c.row.original.name !== c.row.original.id && (
            <div className="truncate text-2xs text-faint">{c.row.original.id}</div>
          )}
        </div>
      ),
    },
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
          charge={c.row.original.charge_micro}
          cost={c.row.original.cost_micro}
          currency={c.row.original.currency}
          showCost={showCost}
          unpriced={c.row.original.unpriced}
        />
      ),
    },
    {
      accessorKey: "requests",
      header: "请求数",
      cell: (c) => <span className="tnum text-2sm">{fmtInt(c.row.original.requests)}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={range}
          variant="outline"
          size="sm"
          aria-label="我的花费时间范围"
          onValueChange={(value) => {
            if (value) setRange(value as SpendRange);
          }}
        >
          {RANGES.map((item) => (
            <ToggleGroupItem key={item.value} value={item.value}>
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {canSubtree && (
          <ToggleGroup
            type="single"
            value={scope}
            variant="outline"
            size="sm"
            aria-label="账单层级范围"
            onValueChange={(value) => {
              if (value) setScope(value as SpendScope);
            }}
          >
            <ToggleGroupItem value="self">本账号</ToggleGroupItem>
            <ToggleGroupItem value="subtree">下级子树</ToggleGroupItem>
          </ToggleGroup>
        )}
        <span className="ml-auto text-2xs text-faint">
          {data?.all_users
            ? "管理员视角 · 全部用户"
            : data?.user
              ? "用户：" + data.user.name
              : "只统计当前账号"}
          {data ? " · " + data.timezone + " · " + bucket + "桶" : ""}
        </span>
      </div>

      {data && data.user === null && !data.all_users && data.scope === "self" && data.summary.requests === 0 ? (
        <Empty text={"当前登录账号还未绑定层级用户" + (canSubtree ? "；切到「下级子树」可查看可见范围内的账单" : "，暂时没有可展示的花费")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="花费合计"
              icon={METRIC_ICONS.charge.icon}
              tone={METRIC_ICONS.charge.tone}
              value={summary ? money(summary.charge_micro) : undefined}
              loading={query.isPending}
              error={query.isError ? (query.error as Error).message : null}
              onRetry={() => void query.refetch()}
              hint={rangeLabel + " · " + bucket + "桶 · 营收口径"}
            />
            {showCost && (
              <MetricCard
                label="成本合计"
                icon={METRIC_ICONS.cost.icon}
                tone={METRIC_ICONS.cost.tone}
                value={money(summary?.cost_micro)}
                loading={query.isPending}
                hint="上游成本口径"
              />
            )}
            {showMargin && (
              <MetricCard
                label="毛利"
                icon={METRIC_ICONS.margin.icon}
                tone={(summary?.margin_micro ?? 0) < 0 ? "danger" : METRIC_ICONS.margin.tone}
                value={money(summary?.margin_micro)}
                loading={query.isPending}
                hint="花费 − 成本"
              />
            )}
            <MetricCard
              label="词元合计"
              icon={METRIC_ICONS.tokens.icon}
              tone={METRIC_ICONS.tokens.tone}
              value={summary ? fmtInt(summary.input_tokens + summary.output_tokens) : undefined}
              loading={query.isPending}
              hint={summary ? "输入 " + fmtInt(summary.input_tokens) + " · 输出 " + fmtInt(summary.output_tokens) : undefined}
            />
            <MetricCard
              label="请求数"
              icon={METRIC_ICONS.requests.icon}
              tone={METRIC_ICONS.requests.tone}
              value={summary ? fmtInt(summary.requests) : undefined}
              loading={query.isPending}
              hint="每个计费事件计 1 次"
            />
            <MetricCard
              label="待补价"
              icon={METRIC_ICONS.unpriced.icon}
              tone={(summary?.unpriced ?? 0) > 0 ? "danger" : METRIC_ICONS.unpriced.tone}
              value={summary ? fmtInt(summary.unpriced) : undefined}
              loading={query.isPending}
              hint="未定价不写 0，补价后重算"
            />
          </div>

          {summary?.fx_missing && summary.fx_missing.length > 0 && (
            <p className="text-2xs text-warning-text">
              缺少汇率：{summary.fx_missing.join("、")}，折算总额暂不展示（分币种原值仍保留在后端）。
            </p>
          )}

          <ChartCard
            title="花费趋势"
            subtitle={rangeLabel + " · " + bucket + "桶 · " + (showCost ? "花费与成本分两条线" : "仅花费")}
            loading={query.isPending}
            error={query.isError ? query.error : undefined}
            onRetry={() => void query.refetch()}
            emptyText={isEmpty ? "所选范围内还没有计费事件，试试放大时间范围" : null}
          >
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={palette.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    minTickGap={24}
                    stroke={palette.axis}
                    tick={{ fill: palette.faint, fontSize: 11 }}
                  />
                  <YAxis
                    tickFormatter={(value: number) => fmtMicroYuan(value)}
                    width={64}
                    stroke={palette.axis}
                    tick={{ fill: palette.faint, fontSize: 11 }}
                  />
                  <Tooltip content={<SpendTooltip palette={palette} />} />
                  <Area
                    type="monotone"
                    dataKey="charge"
                    name="花费"
                    stroke={palette.series[0]}
                    fill={palette.series[0]}
                    fillOpacity={0.22}
                    isAnimationActive={false}
                    dot={false}
                  />
                  {showCost && (
                    <Area
                      type="monotone"
                      dataKey="cost"
                      name="成本"
                      stroke={palette.series[2]}
                      fill={palette.series[2]}
                      fillOpacity={0.12}
                      isAnimationActive={false}
                      dot={false}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <div className="grid gap-3 xl:grid-cols-2">
            <section className="space-y-1">
              <p className="text-2sm font-medium text-title">按模型</p>
              <DataTable
                columns={dimensionColumns}
                data={data?.by_model}
                loading={query.isPending}
                error={query.isError ? (query.error as Error).message : null}
                onRetry={() => void query.refetch()}
                emptyText="所选范围内没有模型花费"
                filterPlaceholder="筛选模型"
                pageSize={25}
              />
            </section>
            <section className="space-y-1">
              <p className="text-2sm font-medium text-title">按用户</p>
              <DataTable
                columns={dimensionColumns}
                data={data?.by_user}
                loading={query.isPending}
                error={query.isError ? (query.error as Error).message : null}
                onRetry={() => void query.refetch()}
                emptyText="所选范围内没有用户花费"
                filterPlaceholder="筛选用户"
                pageSize={25}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
