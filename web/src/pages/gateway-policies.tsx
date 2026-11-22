import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "@/lib/notify";

import { describeError } from "@/components/governance/gateway-policies";
import { GuardrailsTab } from "@/components/governance/gateway-policies/guardrails-tab";
import { McpTab } from "@/components/governance/gateway-policies/mcp-tab";
import { PoliciesTab } from "@/components/governance/gateway-policies/policies-tab";
import {
  countDirtyGuardrails,
  countDirtyMcp,
  countDirtyPolicies,
  policyDraftProblem,
  type McpDraftDocument,
} from "@/components/governance/gateway-policies/helpers";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState, PageToolbar } from "@/components/governance/panel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TabBar } from "@/components/ui/tabs";
import { controlPlane } from "@/lib/control-plane";
import { ACTION_ICONS } from "@/lib/icons";
import { usePermissions } from "@/lib/permissions";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import type { GuardrailConfig, PolicyConfig } from "@/lib/policies";

/**
 * 网关策略（ADR-023 第 3 条）：流量策略 / 护栏 / MCP 单页三 Tab。
 *
 * 共用保存链：三个 Tab 的编辑都只写各自草稿（Tab 切换不丢）；
 * 页级动作条统一「试运行校验 → 保存并下发」——保存按分区顺序 PUT，
 * 全部成功后调用一次 POST /admin/config/apply，生成配置修订留档。
 * 任一分区失败即停止（不 apply），已落库分区在修复后重新保存。
 */

type TabKey = "policies" | "guardrails" | "mcp";

const TAB_ITEMS: Array<{ key: TabKey; label: string }> = [
  { key: "policies", label: "流量策略" },
  { key: "guardrails", label: "护栏" },
  { key: "mcp", label: "MCP" },
];

function parseTab(raw: string | null): TabKey {
  return raw === "guardrails" || raw === "mcp" ? raw : "policies";
}

export function GatewayPoliciesPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const { can } = usePermissions();
  const canWrite = can("policies:write");

  const policies = useQuery({
    queryKey: ["policies"],
    queryFn: () => controlPlane.governance.policies(),
  });
  const guardrails = useQuery({
    queryKey: ["guardrails"],
    queryFn: () => controlPlane.governance.guardrails(),
  });
  const mcpServers = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => controlPlane.governance.mcpServers(),
  });

  // 三份草稿：null = 该 Tab 无未保存修改；挂在页级，Tab 切换不丢。
  const [policyDraft, setPolicyDraft] = useState<PolicyConfig | null>(null);
  const [guardrailDraft, setGuardrailDraft] = useState<GuardrailConfig | null>(null);
  const [mcpDraft, setMcpDraft] = useState<McpDraftDocument | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // W4-G 确认校准：「保存并下发」先出影响摘要确认（写库 + 热加载数据面）。
  const [saveConfirm, setSaveConfirm] = useState(false);

  const dirtyPolicies =
    policies.data === undefined ? 0 : countDirtyPolicies(policies.data.config, policyDraft);
  const dirtyGuardrails =
    guardrails.data === undefined ? 0 : countDirtyGuardrails(guardrails.data.config, guardrailDraft);
  const dirtyMcp = mcpServers.data === undefined ? 0 : countDirtyMcp(
    { servers: mcpServers.data.servers, port: mcpServers.data.port },
    mcpDraft,
  );
  const dirtyTotal = dirtyPolicies + dirtyGuardrails + dirtyMcp;
  const busy = validating || saving;
  // ADR-024 成对规则的前端门禁：4xx codes + 不完整健康组时禁止校验/保存。
  const policyProblem = policyDraftProblem(policyDraft);
  // W4-G：三份草稿都挂页级，改了没保存就点侧栏离开 → 出确认框（hook 拦 <a> 与刷新）。
  const leaveGuard = useDirtyGuard(dirtyTotal > 0);

  const clearDrafts = () => {
    setPolicyDraft(null);
    setGuardrailDraft(null);
    setMcpDraft(null);
    setSaveError(null);
  };

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["policies"] });
    void queryClient.invalidateQueries({ queryKey: ["guardrails"] });
    void queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    void queryClient.invalidateQueries({ queryKey: ["config-status"] });
  };

  const validateAll = async () => {
    setValidating(true);
    const failures: string[] = [];
    const warnings: string[] = [];
    const checked: string[] = [];
    try {
      if (policyDraft !== null && policies.data !== undefined) {
        const result = await controlPlane.governance.validatePolicies(policyDraft);
        checked.push("流量策略");
        if (result.ok) warnings.push(...result.warnings.map((item) => "流量策略：" + item));
        else failures.push("流量策略：" + (result.errors.join("；") || "未通过校验"));
      }
      if (guardrailDraft !== null && guardrails.data !== undefined) {
        const result = await controlPlane.governance.validateGuardrails(guardrailDraft);
        checked.push("护栏");
        if (result.ok) warnings.push(...result.warnings.map((item) => "护栏：" + item));
        else failures.push("护栏：" + (result.errors.join("；") || "未通过校验"));
      }
      if (mcpDraft !== null && mcpServers.data !== undefined) {
        const result = await controlPlane.governance.validateMcp(mcpDraft);
        checked.push("MCP");
        if (result.ok) warnings.push(...result.warnings.map((item) => "MCP：" + item));
        else failures.push("MCP：" + (result.errors.join("；") || "未通过校验"));
      }
      if (checked.length === 0) return;
      if (failures.length === 0) {
        toast.success(checked.join("、") + " 通过数据面校验", {
          description: warnings.length > 0 ? warnings.join("；") : "可以保存并下发",
        });
      } else {
        toast.error("配置未通过校验", { description: failures.join("；") });
      }
    } catch (error) {
      toast.error("校验请求失败", { description: describeError(error) });
    } finally {
      setValidating(false);
    }
  };

  const saveAll = async () => {
    if (policyDraft !== null) {
      const problem = policyDraftProblem(policyDraft);
      if (problem !== null) {
        setSaveError(problem);
        toast.error("流量策略未通过前端成对校验", { description: problem });
        return;
      }
    }
    setSaving(true);
    setSaveError(null);
    const savedTabs: string[] = [];
    try {
      if (policyDraft !== null) {
        await controlPlane.governance.savePolicies(policyDraft);
        savedTabs.push("流量策略");
      }
      if (guardrailDraft !== null) {
        await controlPlane.governance.saveGuardrails(guardrailDraft);
        savedTabs.push("护栏");
      }
      if (mcpDraft !== null) {
        await controlPlane.governance.saveMcpServers(mcpDraft);
        savedTabs.push("MCP");
      }
      const revision = await controlPlane.config.apply("控制面网关策略编辑（" + savedTabs.join("、") + "）");
      toast.success("网关策略已保存并下发", {
        description: "配置修订 " + revision.id + " · " + savedTabs.join("、"),
      });
      clearDrafts();
      invalidateAll();
    } catch (error) {
      // 部分分区可能已写库但未 apply：如实提示，不静默回滚。
      setSaveError(
        describeError(error) +
          (savedTabs.length > 0
            ? "（" + savedTabs.join("、") + " 已写库但未下发；修复后重新保存即可）"
            : ""),
      );
    } finally {
      setSaving(false);
    }
  };

  const pending = policies.isPending || guardrails.isPending || mcpServers.isPending;
  const loadError = policies.isError
    ? { title: "策略配置加载失败", description: policies.error.message + "（GET /admin/policies）" }
    : guardrails.isError
      ? { title: "护栏配置加载失败", description: guardrails.error.message + "（GET /admin/guardrails）" }
      : mcpServers.isError
        ? { title: "MCP 配置加载失败", description: mcpServers.error.message + "（GET /admin/mcp-servers）" }
        : null;

  if (pending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  if (loadError !== null || policies.data === undefined || guardrails.data === undefined || mcpServers.data === undefined) {
    return (
      <ErrorState
        title={loadError?.title ?? "网关策略加载失败"}
        description={loadError?.description ?? "控制面返回了空响应。"}
        onRetry={() => {
          void policies.refetch();
          void guardrails.refetch();
          void mcpServers.refetch();
        }}
        retrying={policies.isFetching || guardrails.isFetching || mcpServers.isFetching}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="网关策略"
        description="默认关闭，保持现有行为；重试与健康驱逐只对显式开启的策略生效，保存后统一下发数据面。"
      />
      <PageToolbar>
        <span className="text-2sm text-faint">
          {dirtyTotal === 0
            ? "三个分区共用一条保存链：校验 → 保存 → apply → 配置版本留档。"
            : `待保存修改 ${dirtyTotal} 处：流量策略 ${dirtyPolicies} · 护栏 ${dirtyGuardrails} · MCP ${dirtyMcp}`}
        </span>
        {canWrite && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden text-2xs text-faint xl:inline">保存并下发 = 写库 + 热加载数据面</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void validateAll()}
              disabled={dirtyTotal === 0 || busy || policyProblem !== null}
            >
              <ACTION_ICONS.dryRun className="h-3.5 w-3.5" /> {validating ? "校验中…" : "试运行校验"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setSaveConfirm(true)}
              disabled={dirtyTotal === 0 || busy || policyProblem !== null}
            >
              <ACTION_ICONS.deploy className="h-3.5 w-3.5" /> {saving ? "保存并下发中…" : "保存并下发"}
            </Button>
          </div>
        )}
      </PageToolbar>

      {policyProblem !== null && (
        <div className="rounded-md border border-warning bg-warning-soft px-2.5 py-1.5 text-2xs text-warning-text">
          流量策略暂不能保存：{policyProblem}
        </div>
      )}

      {saveError !== null && (
        <div className="rounded-md border border-danger bg-danger-soft px-2.5 py-1.5 text-2xs text-danger-text">
          保存失败：{saveError}
        </div>
      )}

      <TabBar
        ariaLabel="网关策略分区"
        items={TAB_ITEMS}
        value={tab}
        onValueChange={(key) => setParams({ tab: key }, { replace: true })}
      />

      {/* 三个面板保持挂载（仅隐藏），Tab 切换不丢草稿与原始 JSON 编辑态。 */}
      <div hidden={tab !== "policies"}>
        <PoliciesTab
          data={policies.data}
          draft={policyDraft}
          onDraftChange={setPolicyDraft}
          canWrite={canWrite}
          dirtyCount={dirtyPolicies}
        />
      </div>
      <div hidden={tab !== "guardrails"}>
        <GuardrailsTab
          data={guardrails.data}
          draft={guardrailDraft}
          onDraftChange={setGuardrailDraft}
          canWrite={canWrite}
          dirtyCount={dirtyGuardrails}
        />
      </div>
      <div hidden={tab !== "mcp"}>
        <McpTab
          data={mcpServers.data}
          draft={mcpDraft}
          onDraftChange={setMcpDraft}
          canWrite={canWrite}
          dirtyCount={dirtyMcp}
        />
      </div>

      {leaveGuard}

      {/* 确认框按需挂载（见 upstream_detail 同款注释）；确认后才走保存链。 */}
      {saveConfirm ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setSaveConfirm(false); }}
          title="保存并下发？"
          description={
            `影响摘要：流量策略 ${dirtyPolicies} 处 · 护栏 ${dirtyGuardrails} 处 · MCP ${dirtyMcp} 处将被写入，` +
            "随后热加载数据面并生成配置修订留档；新配置立即对经网关的请求生效。"
          }
          confirmLabel="确认保存并下发"
          onConfirm={() => {
            setSaveConfirm(false);
            void saveAll();
          }}
        />
      ) : null}
    </div>
  );
}
