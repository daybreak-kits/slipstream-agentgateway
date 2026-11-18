import { useSearchParams } from "react-router-dom";

import { GuardrailsPage } from "@/pages/guardrails";
import { McpPage } from "@/pages/mcp";
import { PoliciesPage } from "@/pages/policies";
import { TabBar } from "@/components/ui/tabs";

/**
 * 网关策略（ADR-023）：策略 / 护栏 / MCP 合并为单页三 Tab，?tab=policies|guardrails|mcp。
 * 当前为 W2 骨架的临时壳：机械包裹三个既有页组件（一次只挂载当前 Tab），
 * 样式与「共用 validate→保存→apply→版本留档」在 F6 工位重做。
 */
const TAB_ITEMS: Array<{ key: TabKey; label: string }> = [
  { key: "policies", label: "流量策略" },
  { key: "guardrails", label: "护栏" },
  { key: "mcp", label: "MCP" },
];

type TabKey = "policies" | "guardrails" | "mcp";

function parseTab(raw: string | null): TabKey {
  return raw === "guardrails" || raw === "mcp" ? raw : "policies";
}

export function GatewayPoliciesPage() {
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"));

  return (
    <div className="space-y-3">
      <TabBar
        ariaLabel="网关策略分区"
        items={TAB_ITEMS}
        value={tab}
        onValueChange={(key) => setParams({ tab: key }, { replace: true })}
      />
      {tab === "policies" ? <PoliciesPage /> : tab === "guardrails" ? <GuardrailsPage /> : <McpPage />}
    </div>
  );
}
