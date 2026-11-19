import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { SankeyChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtCount } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";

import { fmtMoney } from "./chart-format";
import { useChartPalette, type ChartPalette } from "./chart-theme";
import type { FlowLink, FlowReport } from "./report-types";

echarts.use([SankeyChart, TooltipComponent, CanvasRenderer]);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char] ?? char;
  });
}

function shortLabel(value: string): string {
  return value.length <= 18 ? value : value.slice(0, 17) + "…";
}

function stageColor(id: string, data: FlowReport, palette: ChartPalette): string {
  const stage = data.node_meta[id]?.stage ?? "channel";
  const index = data.stages.findIndex((item) => item.id === stage);
  return palette.series[(index < 0 ? 0 : index) % palette.series.length] ?? palette.primary;
}

/** 跨接中的边：金额字段与后端契约一致——没有金额的边保持缺键（tooltip 不显示 0 元行）。 */
interface SpliceEdge {
  source: string;
  target: string;
  value: number;
  requests: number;
  tokens: number;
  cost_micro?: number;
  charge_micro?: number;
}

function mergeMoney(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined;
  return (left ?? 0) + (right ?? 0);
}

/** 跨接后同 (source,target) 对可能成对撞出多条新边：值/请求数/词元/金额逐对求和。 */
function sumDuplicateEdges(edges: SpliceEdge[]): SpliceEdge[] {
  const byPair = new Map<string, SpliceEdge>();
  for (const edge of edges) {
    const key = `${edge.source}\u0000${edge.target}`;
    const kept = byPair.get(key);
    if (!kept) {
      byPair.set(key, { ...edge });
      continue;
    }
    kept.value += edge.value;
    kept.requests += edge.requests;
    kept.tokens += edge.tokens;
    const cost = mergeMoney(kept.cost_micro, edge.cost_micro);
    if (cost !== undefined) kept.cost_micro = cost;
    const charge = mergeMoney(kept.charge_micro, edge.charge_micro);
    if (charge !== undefined) kept.charge_micro = charge;
  }
  return [...byPair.values()];
}

/**
 * 隐藏段的迭代式跨接（W4-B）：对每个隐藏段，入边×出边两两拼新边（值/请求数/词元/金额
 * 合并，重复 (a,b) 对求和），直到图中不含隐藏段——此前对隐藏段整条删链路会把图截成
 * 互不连通的两块（「图分成上下两块」bug 的可见症状）。金额随原承载边守恒：花费只在
 * 用户→密钥边、成本只在 上游模型→渠道 边，跨接时并入合成边。边界段（首段无入边 /
 * 末段无出边）没有跨接对象，移除触及边后其余链路自然连通。按 stages 顺序逐段处理，
 * 合成边只触及未处理的隐藏段，因此每段一轮即收敛。
 */
function spliceHiddenStages(
  links: FlowLink[],
  stageIds: string[],
  stageOf: (id: string) => string | undefined,
  hiddenSet: Set<string>,
): SpliceEdge[] {
  let edges: SpliceEdge[] = links.map((link) => ({ ...link }));
  for (const stage of stageIds) {
    if (!hiddenSet.has(stage)) continue;
    const incoming = edges.filter((edge) => stageOf(edge.target) === stage);
    const outgoing = edges.filter((edge) => stageOf(edge.source) === stage);
    const untouched = edges.filter(
      (edge) => stageOf(edge.source) !== stage && stageOf(edge.target) !== stage,
    );
    if (incoming.length === 0 || outgoing.length === 0) {
      edges = untouched;
      continue;
    }
    const bridged: SpliceEdge[] = [];
    for (const into of incoming) {
      for (const out of outgoing) {
        bridged.push({
          source: into.source,
          target: out.target,
          value: into.value + out.value,
          requests: into.requests + out.requests,
          tokens: into.tokens + out.tokens,
          cost_micro: mergeMoney(into.cost_micro, out.cost_micro),
          charge_micro: mergeMoney(into.charge_micro, out.charge_micro),
        });
      }
    }
    edges = sumDuplicateEdges([...untouched, ...bridged].filter((edge) => edge.value > 0));
  }
  edges.sort((left, right) =>
    left.source < right.source
      ? -1
      : left.source > right.source
        ? 1
        : left.target < right.target
          ? -1
          : left.target > right.target
            ? 1
            : 0,
  );
  return edges;
}

export interface FlowChartProps {
  data: FlowReport | undefined;
  /** 当前被隐藏的阶段（竖轴）id 列表。 */
  hiddenStages: string[];
  onToggleStage: (stageId: string) => void;
}

/**
 * 五段桑基：用户 → 连接密钥 → 公开模型 → 上游模型 → 上游渠道。
 * 五段竖轴都可隐藏：点节点隐藏该段，隐藏后图顶部出现「轴名芯片」点击恢复，
 * 图底部一行常驻五段轴名（隐藏的置灰）。echarts 按需引入，实例复用不 dispose（三期性能修）。
 */
export function FlowChart({ data, hiddenStages, onToggleStage }: FlowChartProps) {
  const { can } = usePermissions();
  const palette = useChartPalette();
  // 卡片四态切到内容时容器才挂载，用 state 做 callback ref 才不会错过 init 时机。
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  // 事件回填走 ref，绑定只随容器做一次，data/回调变化不重绑。
  const dataRef = useRef(data);
  const toggleRef = useRef(onToggleStage);
  dataRef.current = data;
  toggleRef.current = onToggleStage;
  const canCost = can("billing:cost");
  const canSpend = can("billing:spend");
  const hiddenSet = useMemo(() => new Set(hiddenStages), [hiddenStages]);

  const option = useMemo(() => {
    if (!data) return null;
    const meta = data.node_meta;
    const stageOf = (id: string): string | undefined => meta[id]?.stage;
    // 隐藏段不再整条删链路：入边×出边跨接成合成边（tooltip 显示合并值），图保持连通单图。
    const links = spliceHiddenStages(
      data.links,
      data.stages.map((stage) => stage.id),
      stageOf,
      hiddenSet,
    );
    if (links.length === 0) return null;

    const used = new Set<string>();
    links.forEach((link) => {
      used.add(link.source);
      used.add(link.target);
    });

    return {
      backgroundColor: "transparent",
      textStyle: { fontFamily: "inherit" },
      tooltip: {
        trigger: "item",
        backgroundColor: palette.surface,
        borderColor: palette.border,
        textStyle: { color: palette.text, fontSize: 12 },
        formatter: (params: unknown) => {
          const payload = params as { dataType?: string; data?: Record<string, unknown>; name?: string };
          if (payload.dataType === "edge") {
            const edge = payload.data ?? {};
            const source = meta[String(edge.source ?? "")]?.label ?? String(edge.source ?? "");
            const target = meta[String(edge.target ?? "")]?.label ?? String(edge.target ?? "");
            const rows = [
              escapeHtml(source) + " → " + escapeHtml(target),
              "请求：" + fmtCount(Number(edge.requests ?? 0)),
              "词元：" + fmtCount(Number(edge.tokens ?? 0)),
            ];
            if (canSpend && edge.charge_micro !== undefined) {
              rows.push("花费：" + fmtMoney(Number(edge.charge_micro), data.currency));
            }
            if (canCost && edge.cost_micro !== undefined) {
              rows.push("成本：" + fmtMoney(Number(edge.cost_micro), data.currency));
            }
            return rows.join("<br/>");
          }
          const node = meta[String(payload.name ?? "")];
          if (!node) return escapeHtml(String(payload.name ?? ""));
          return [
            escapeHtml(node.label),
            data.stages.find((stage) => stage.id === node.stage)?.label ?? node.stage,
            (data.metric === "tokens" ? "词元：" : "请求：") + fmtCount(node.value),
          ].join("<br/>");
        },
      },
      series: [
        {
          type: "sankey",
          data: [...used].map((id) => ({
            name: id,
            itemStyle: { color: stageColor(id, data, palette), borderWidth: 0 },
            label: {
              formatter: (params: { name?: string }) =>
                shortLabel(meta[String(params.name ?? "")]?.label ?? String(params.name ?? "")),
              color: palette.text,
              fontSize: 11,
            },
          })),
          links,
          emphasis: { focus: "adjacency" },
          nodeWidth: 12,
          nodeGap: 8,
          left: 8,
          right: 132,
          top: 8,
          bottom: 8,
          lineStyle: { color: "gradient", opacity: 0.26, curveness: 0.5 },
          label: { fontSize: 11 },
        },
      ],
    };
  }, [data, palette, canCost, canSpend, hiddenSet]);

  // 实例只随容器挂载/卸载创建销毁一次；点击事件与 resize 观察也只绑一次。
  useEffect(() => {
    if (!element) return;
    const chart = echarts.getInstanceByDom(element) ?? echarts.init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    // 节点点击 = 隐藏该节点所在段（竖轴）；恢复走顶部芯片或底部轴名行。
    const handleClick = (params: { dataType?: string; name?: unknown }) => {
      if (params.dataType !== "node") return;
      const stage = dataRef.current?.node_meta[String(params.name ?? "")]?.stage;
      if (stage) toggleRef.current(stage);
    };
    chart.on("click", handleClick);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    chart.resize();
    return () => {
      chart.off("click", handleClick);
      observer.disconnect();
    };
  }, [element]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    // 隐藏段过滤掉全部链路时 option 为 null：清空画布，等底部轴名行恢复。
    if (option) chart.setOption(option, true);
    else chart.clear();
  }, [option]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  const stages = data?.stages ?? [];
  const visibleStages = stages.filter((stage) => !hiddenSet.has(stage.id)).map((stage) => stage.id);

  const toggleViaGroup = (next: string[]) => {
    for (const stage of stages) {
      const wasVisible = !hiddenSet.has(stage.id);
      const nowVisible = next.includes(stage.id);
      if (wasVisible !== nowVisible) {
        onToggleStage(stage.id);
        return;
      }
    }
  };

  return (
    <div className="space-y-2">
      {hiddenStages.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-faint">已隐藏：</span>
          {stages
            .filter((stage) => hiddenSet.has(stage.id))
            .map((stage) => (
              <Button
                key={stage.id}
                variant="outline"
                size="dense"
                onClick={() => onToggleStage(stage.id)}
                title="点击恢复该段"
                className="gap-1 px-2 text-2xs"
              >
                {stage.label}
                <X className="h-3 w-3 text-faint" strokeWidth={2} aria-hidden="true" />
              </Button>
            ))}
        </div>
      )}
      <div
        ref={setElement}
        className="h-[320px] w-full min-w-0"
        role="img"
        aria-label="调用流向桑基图：用户到连接密钥、公开模型、上游模型、上游渠道"
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs text-faint">阶段轴（点击隐藏 / 恢复）</span>
        <ToggleGroup
          type="multiple"
          value={visibleStages}
          onValueChange={toggleViaGroup}
          aria-label="分流阶段轴"
          className="flex-wrap justify-start"
        >
          {stages.map((stage) => (
            <ToggleGroupItem
              key={stage.id}
              value={stage.id}
              className={
                "h-6 rounded-control px-2 text-2xs data-[state=on]:text-body " +
                (hiddenSet.has(stage.id) ? "text-faint line-through opacity-60" : "text-body")
              }
            >
              {stage.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
