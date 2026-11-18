import type { UserTreeNode } from "@/types";

export interface TreeRow {
  node: UserTreeNode;
  level: number;
}

/** 作用域内的森林按父子关系展开；跨分支的边不会出现（后端已过滤）。 */
export function buildTreeRows(nodes: UserTreeNode[], rootIds: string[]): TreeRow[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, UserTreeNode[]>();
  for (const node of nodes) {
    if (node.parent_user_id === null || !byId.has(node.parent_user_id)) continue;
    const bucket = children.get(node.parent_user_id) ?? [];
    bucket.push(node);
    children.set(node.parent_user_id, bucket);
  }
  for (const bucket of children.values()) {
    bucket.sort((a, b) => a.created_at_ms - b.created_at_ms || a.id.localeCompare(b.id));
  }
  const ordered: TreeRow[] = [];
  const visited = new Set<string>();
  const walk = (id: string, level: number) => {
    const node = byId.get(id);
    if (node === undefined || visited.has(id)) return;
    visited.add(id);
    ordered.push({ node, level });
    for (const child of children.get(id) ?? []) walk(child.id, level + 1);
  };
  for (const rootId of rootIds) walk(rootId, 0);
  for (const node of nodes) if (!visited.has(node.id)) walk(node.id, 0);
  return ordered;
}
