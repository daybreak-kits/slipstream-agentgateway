import type { McpConfig } from "@/generated/contract";

import { clone } from "./memory-adapter";
import {
  DEFAULT_GUARDRAIL_CONFIG,
  DEFAULT_POLICY_CONFIG,
  guardrailPayload,
  mcpPayload,
  policyPayload,
  setGuardrailConfig,
  setMcpConfig,
  setPolicyConfig,
} from "./memory/fixtures";
import type { GovernanceOperations } from "./operations/governance";

/** 内存网关策略域：三份文档读写内存 fixtures；文档级校验恒通过（页面级成对校验在前端）。 */
export function createMemoryGovernance(): GovernanceOperations {
  return {
    policies: async () => policyPayload(),
    savePolicies: async (config) => {
      setPolicyConfig(clone(config));
      return policyPayload();
    },
    resetPolicies: async () => {
      setPolicyConfig(clone(DEFAULT_POLICY_CONFIG));
      return policyPayload();
    },
    guardrails: async () => guardrailPayload(),
    saveGuardrails: async (config) => {
      setGuardrailConfig(clone(config));
      return guardrailPayload();
    },
    resetGuardrails: async () => {
      setGuardrailConfig(clone(DEFAULT_GUARDRAIL_CONFIG));
      return guardrailPayload();
    },
    mcpServers: async () => mcpPayload(),
    saveMcpServers: async (config: McpConfig) => {
      const servers = config.servers ?? [];
      const names = servers.map((server) => server.name);
      if (new Set(names).size !== names.length) throw new Error("MCP 服务器名称重复");
      setMcpConfig({
        servers: clone(servers) as never,
        port: config.port ?? null,
      });
      return mcpPayload();
    },
    validatePolicies: async () => ({ ok: true, errors: [], warnings: [] }),
    validateGuardrails: async () => ({ ok: true, errors: [], warnings: [] }),
    validateMcp: async () => ({ ok: true, errors: [], warnings: [] }),
  };
}
