import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import type { CapabilityInfo } from "@/lib/policies";

/** 网关策略三 Tab 的共用小件（只放组件，保证 react-refresh 可用）。 */

export function CapabilityBadge({ capability }: { capability: CapabilityInfo }) {
  if (!capability.supported) return <Badge tone="neutral">数据面不支持</Badge>;
  return capability.verified ? <Badge tone="success">已验证</Badge> : <Badge tone="warning">未实测</Badge>;
}

/** MCP 总开关徽标（来自 GET /admin/mcp-servers 的 supported 字段）。 */
export function TransportBadgeNote({ supported }: { supported: boolean }) {
  return supported ? <Badge tone="success">MCP 已启用</Badge> : <Badge tone="warning">MCP 不支持</Badge>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-2xs text-body">{label}</Label>
      {children}
      {hint !== undefined && <p className="text-2xs text-faint">{hint}</p>}
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-2xs text-faint">{label}</div>
      <div className="text-2xs leading-relaxed text-body">{children}</div>
    </div>
  );
}

export function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-faint">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-2xs">
          {item}
        </span>
      ))}
    </div>
  );
}

/** Tab 顶部的未保存提示：N=0 时不渲染。 */
export function DirtyHint({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="text-2xs text-warning-text">本 Tab 修改 {count} 处未保存；保存请用页级动作条。</p>
  );
}
