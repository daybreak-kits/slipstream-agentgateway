/**
 * 分流图搜索/聚焦的纯函数层（W6 票 17）。
 *
 * 语义与后端 focus/q/top_n（api/src/l05_service/aggregates.py 的
 * _flow_closure/_flow_keep_subgraph/_flow_fold_tail）逐条对齐：
 * - 闭包在「聚合图」上计算，祖先只沿入边向上、后代只沿出边向下（方向性 BFS，
 *   不从祖先继续探它的其他下游，否则闭包退化成整个连通分量）；
 * - 子图保留闭包内节点与其之间的聚合边，边值维持窗口聚合口径（与高亮模式
 *   在同一份数据上的表现完全一致）。
 *
 * 只依赖 FlowReport 的形状子集，mock 投影（report-mocks）复用同一套函数，
 * 保证演示模式与真实后端行为一致。
 */

/** flow-search 关心的最小图形状（FlowReport 的子集）。 */
export interface FlowGraphLike {
  nodes: readonly string[];
  node_meta: Readonly<Record<string, { label: string; stage: string }>>;
  links: ReadonlyArray<{ source: string; target: string }>;
}

/** label 大小写不敏感子串命中，按 data.nodes 的稳定顺序返回。 */
export function flowMatchNodes(data: FlowGraphLike, query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return data.nodes.filter((id) => (data.node_meta[id]?.label ?? "").toLowerCase().includes(needle));
}

/** 目标 + 祖先 + 后代闭包（单向双 BFS）。seeds 为空时闭包为空。 */
export function flowChainOf(data: FlowGraphLike, seeds: readonly string[]): Set<string> {
  if (seeds.length === 0) return new Set();
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const link of data.links) {
    const outs = out.get(link.source);
    if (outs) outs.push(link.target);
    else out.set(link.source, [link.target]);
    const ins = inn.get(link.target);
    if (ins) ins.push(link.source);
    else inn.set(link.target, [link.source]);
  }
  const closure = new Set<string>(seeds);
  let frontier = [...seeds];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of inn.get(id) ?? []) {
        if (!closure.has(neighbour)) {
          closure.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }
  frontier = [...seeds];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of out.get(id) ?? []) {
        if (!closure.has(neighbour)) {
          closure.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }
  return closure;
}

export interface FlowSearchView {
  /** 命中节点（查询的搜索目标）。 */
  matched: string[];
  /** 高亮/仅显示用的闭包集合。 */
  chainNodeIds: Set<string>;
  /** 闭包内的边（key = source + "\n" + target）。 */
  chainLinkKeys: Set<string>;
  /** 供 aria 文案使用的计数。 */
  matchedCount: number;
  chainNodeCount: number;
  chainLinkCount: number;
}

function linkKey(source: string, target: string): string {
  return source + "\n" + target;
}

/** 计算一次搜索的完整视图；空查询返回 null（全图、无高亮）。 */
export function flowSearchView(data: FlowGraphLike, query: string): FlowSearchView | null {
  const matched = flowMatchNodes(data, query);
  if (matched.length === 0 && query.trim() === "") return null;
  const chainNodeIds = flowChainOf(data, matched);
  const chainLinkKeys = new Set<string>();
  for (const link of data.links) {
    if (chainNodeIds.has(link.source) && chainNodeIds.has(link.target)) {
      chainLinkKeys.add(linkKey(link.source, link.target));
    }
  }
  return {
    matched,
    chainNodeIds,
    chainLinkKeys,
    matchedCount: matched.length,
    chainNodeCount: chainNodeIds.size,
    chainLinkCount: chainLinkKeys.size,
  };
}
