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
import type { FlowReport } from "./report-types";

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
    const links = data.links
      .filter((link) => {
        const sourceStage = stageOf(link.source);
        const targetStage = stageOf(link.target);
        return !hiddenSet.has(sourceStage ?? "") && !hiddenSet.has(targetStage ?? "");
      })
      .filter((link) => link.value > 0)
      .map((link) => ({
        source: link.source,
        target: link.target,
        value: link.value,
        requests: link.requests,
        tokens: link.tokens,
        cost_micro: link.cost_micro,
        charge_micro: link.charge_micro,
      }));
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
