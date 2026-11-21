import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { SankeyChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtInt } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";

import { fmtMoney } from "./chart-format";
import { useChartPalette, type ChartPalette } from "./chart-theme";
import { flowSearchView } from "./flow-search";
import { FLOW_STAGES, type FlowReport } from "./report-types";

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
  const index = FLOW_STAGES.findIndex((item) => item.id === stage);
  return palette.series[(index < 0 ? 0 : index) % palette.series.length] ?? palette.primary;
}

export interface FlowChartProps {
  data: FlowReport | undefined;
  /** 当前被隐藏的阶段（竖轴）id 列表。 */
  hiddenStages: string[];
  onToggleStage: (stageId: string) => void;
  /** 搜索框状态归 TrendPanel（服务端窄化模式要把 q 传给后端）。 */
  query: string;
  onQueryChange: (value: string) => void;
  /** 仅显示搜索目标：只保留目标前后整条链。 */
  onlyChain: boolean;
  onOnlyChainChange: (value: boolean) => void;
  /** 大数据服务端窄化：返回的已经是链路子图，前端不再做闭包/高亮。 */
  serverNarrowed: boolean;
}

/**
 * 五段桑基：用户 → 连接密钥 → 公开模型 → 上游模型 → 上游渠道。
 * 布局（W6 票 17）：搜索框在左上，「仅显示搜索目标」开关随行；阶段轴移到卡片
 * 右侧竖排（隐藏项删除线可点恢复），「已隐藏」芯片块已删除——恢复入口只有轴，
 * 卡片高度不随隐藏状态变化（画布恒走 chart-frame token）。
 * 搜索高亮目标及其祖先/后代链路（flow-search 单向闭包，与后端 focus/q 同语义）；
 * 大数据（>阈值）由后端 q 过滤，前端不做闭包。
 * echarts 按需引入，实例复用不 dispose；setOption 用 replaceMerge 替换 series
 * （固定 series.id），避免 notMerge 整体重建后 hover 触发 getLayout 未定义崩溃。
 */
export function FlowChart({
  data,
  hiddenStages,
  onToggleStage,
  query,
  onQueryChange,
  onlyChain,
  onOnlyChainChange,
  serverNarrowed,
}: FlowChartProps) {
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
  const visibleStages = FLOW_STAGES.filter((stage) => !hiddenSet.has(stage.id)).map(
    (stage) => stage.id,
  );
  // 至少保留两个可见阶段：再隐藏会拿到无法解释的空图，因此禁止继续隐藏并明确提示；
  // 后端 422 是同一规则的最后防线（这里不发出会 422 的请求）。
  const canHideMore = visibleStages.length > 2;
  const chartBlocked = visibleStages.length < 2;
  const canHideMoreRef = useRef(canHideMore);
  canHideMoreRef.current = canHideMore;
  // 下限反馈：到下限后点节点不再静默忽略，提示短暂高亮（纯样式，不改布局）。
  const [limitFlash, setLimitFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, []);

  // 搜索闭包（仅前端小数据模式）：命中 + 祖先 + 后代；无命中等价于无高亮。
  const search =
    data && !serverNarrowed && query.trim() !== "" ? flowSearchView(data, query) : null;
  const effectiveSearch = search && search.matchedCount > 0 ? search : null;
  const chainOnly = Boolean(effectiveSearch && onlyChain);

  const option = useMemo(() => {
    if (!data) return null;
    const meta = data.node_meta;
    // 隐藏段由后端按完整路径投影：返回的 links 已重连，前端只负责渲染。
    // 仅显示搜索目标时前端再过滤一次（保留链上节点之间的边）。
    const links = chainOnly
      ? data.links.filter((link) => effectiveSearch?.chainLinkKeys.has(link.source + "\n" + link.target))
      : data.links;
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
              "请求：" + fmtInt(Number(edge.requests ?? 0)),
              "词元：" + fmtInt(Number(edge.tokens ?? 0)),
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
            FLOW_STAGES.find((stage) => stage.id === node.stage)?.label ?? node.stage,
            (data.metric === "tokens" ? "词元：" : "请求：") + fmtInt(node.value),
          ].join("<br/>");
        },
      },
      series: [
        {
          id: "flow-sankey",
          type: "sankey",
          data: [...used].map((id) => {
            const dimmed = effectiveSearch ? !effectiveSearch.chainNodeIds.has(id) : false;
            return {
              name: id,
              itemStyle: {
                color: stageColor(id, data, palette),
                borderWidth: 0,
                opacity: dimmed ? 0.12 : 1,
              },
              label: {
                formatter: (params: { name?: string }) =>
                  shortLabel(meta[String(params.name ?? "")]?.label ?? String(params.name ?? "")),
                color: dimmed ? palette.faint : palette.text,
                opacity: dimmed ? 0.55 : 1,
                fontSize: 11,
              },
            };
          }),
          links: links.map((link) => ({
            ...link,
            lineStyle: {
              color: "gradient",
              opacity:
                effectiveSearch && !effectiveSearch.chainLinkKeys.has(link.source + "\n" + link.target)
                  ? 0.05
                  : 0.26,
              curveness: 0.5,
            },
          })),
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
  }, [data, palette, canCost, canSpend, effectiveSearch, chainOnly]);

  // 实例只随容器挂载/卸载创建销毁一次；点击事件与 resize 观察也只绑一次。
  useEffect(() => {
    if (!element) return;
    const chart = echarts.getInstanceByDom(element) ?? echarts.init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    // 节点点击 = 隐藏该节点所在段（竖轴）；恢复走右侧阶段轴。
    const handleClick = (params: { dataType?: string; name?: unknown }) => {
      if (params.dataType !== "node") return;
      if (!canHideMoreRef.current) {
        // 到下限后点节点给反馈：提示短暂标红，不再静默忽略。
        setLimitFlash(true);
        if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setLimitFlash(false), 2000);
        return;
      }
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
    // 隐藏段过滤掉全部链路时 option 为 null：清空画布，等右侧阶段轴恢复。
    // replaceMerge 按固定 series.id 整体替换序列：悬停中的旧元素随 series 一起
    // 被安全回收，不会在 mouseout 时踩到 getLayout 未定义（W6 票 17）。
    if (option) chart.setOption(option, { replaceMerge: ["series"] });
    else chart.clear();
  }, [option]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  const stages = FLOW_STAGES;

  const toggleViaGroup = (next: string[]) => {
    for (const stage of stages) {
      const wasVisible = !hiddenSet.has(stage.id);
      const nowVisible = next.includes(stage.id);
      if (wasVisible !== nowVisible) {
        if (wasVisible && !canHideMore) return; // 再隐藏会少于两段：禁止
        onToggleStage(stage.id);
        return;
      }
    }
  };

  const stageCount = (stageId: string) => {
    let count = 0;
    for (const node of Object.values(data?.node_meta ?? {})) {
      if (node.stage === stageId) count += 1;
    }
    return count;
  };

  const searchStatus = serverNarrowed
    ? query.trim() === ""
      ? ""
      : data && data.links.length > 0
        ? `服务端已过滤：链 ${data.nodes.length} 节点 / ${data.links.length} 边`
        : `没有匹配「${query.trim()}」的节点`
    : effectiveSearch
      ? chainOnly
        ? `仅显示链路：${effectiveSearch.chainNodeCount} 节点 / ${effectiveSearch.chainLinkCount} 边`
        : `命中 ${effectiveSearch.matchedCount} · 链路 ${effectiveSearch.chainNodeCount} 节点 / ${effectiveSearch.chainLinkCount} 边`
      : query.trim() === ""
        ? ""
        : `没有匹配「${query.trim()}」的节点`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-0 flex-1 basis-64 items-center sm:max-w-72">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-faint" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索用户 / 密钥 / 模型 / 渠道"
            aria-label="搜索分流节点"
            data-slot="flow-search-input"
            className="h-8 pl-7 text-2xs"
          />
        </label>
        {!serverNarrowed && (
          <label className="flex shrink-0 items-center gap-1.5 text-2xs text-body">
            <Switch
              checked={onlyChain}
              onCheckedChange={onOnlyChainChange}
              disabled={!effectiveSearch}
              aria-label="仅显示搜索目标"
              data-slot="flow-only-chain"
            />
            仅显示搜索目标
          </label>
        )}
        <span data-slot="flow-search-status" role="status" className="min-w-0 truncate text-2xs text-faint">
          {searchStatus}
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px]">
        <div className="relative min-w-0">
          <div
            ref={setElement}
            className="chart-frame w-full min-w-0"
            role="img"
            aria-label="调用流向桑基图：用户到连接密钥、公开模型、上游模型、上游渠道"
          />
          {chartBlocked && (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center rounded-card border border-dashed border-border bg-card px-6 text-center text-sm text-muted-foreground"
            >
              至少保留两个可见阶段：请先恢复一个已隐藏阶段，再查看分流图
            </div>
          )}
        </div>
        <aside
          data-slot="flow-stage-axis"
          className="flex flex-col gap-1.5 lg:border-l lg:border-border lg:pl-3"
        >
          <span className="text-2xs text-faint">阶段轴（点击隐藏 / 恢复）</span>
          <ToggleGroup
            type="multiple"
            value={visibleStages}
            onValueChange={toggleViaGroup}
            aria-label="分流阶段轴"
            className="flex-col items-stretch justify-start gap-1"
          >
            {stages.map((stage) => {
              const index = FLOW_STAGES.findIndex((item) => item.id === stage.id);
              const color = palette.series[(index < 0 ? 0 : index) % palette.series.length] ?? palette.primary;
              const hidden = hiddenSet.has(stage.id);
              return (
                <ToggleGroupItem
                  key={stage.id}
                  value={stage.id}
                  disabled={!hidden && !canHideMore}
                  aria-label={stage.label}
                  title={hidden ? "点击恢复该段" : "点击隐藏该段"}
                  className="h-7 justify-start rounded-control px-2 text-2xs data-[state=on]:text-body"
                >
                  <span
                    aria-hidden="true"
                    className={"h-2 w-2 shrink-0 rounded-full " + (hidden ? "opacity-30" : "")}
                    style={{ backgroundColor: color }}
                  />
                  <span className={hidden ? "line-through opacity-60" : ""}>{stage.label}</span>
                  <span className="ml-auto tnum shrink-0 tabular-nums text-faint">
                    {fmtInt(stageCount(stage.id))}
                  </span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          {(!canHideMore || limitFlash) && (
            <span
              role="status"
              data-slot="flow-limit-hint"
              className={
                "text-2xs " + (limitFlash ? "text-danger-text" : "text-faint")
              }
            >
              已到下限：至少保留两个可见阶段，恢复一段后可继续隐藏
            </span>
          )}
        </aside>
      </div>
    </div>
  );
}
