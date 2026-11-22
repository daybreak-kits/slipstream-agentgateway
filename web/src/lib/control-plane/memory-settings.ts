import type { MySpendResponse, SpendDimension, SpendPoint, SpendSummary } from "@/types";

import type { SettingsSchemaPayload } from "@/components/governance/settings-schema";

import { ApiError } from "./errors";
import { clone } from "./memory-adapter";
import {
  mockPreferences,
  mockSession,
  mockUsers,
  overview,
  publicModels,
  settings,
  settingsSchema,
  setMockPreferences,
} from "./memory/fixtures";
import type { SettingsOperations } from "./operations/settings";

const SPEND_RANGE_DAYS = 30;

function spendSummary(requests: number, input: number, output: number, charge: number, cost: number): SpendSummary {
  return {
    requests,
    input_tokens: input,
    output_tokens: output,
    unpriced: 3,
    currency: "CNY",
    charge_micro: charge,
    cost_micro: cost,
    margin_micro: charge - cost,
    by_currency: { CNY: { charge_micro: charge, cost_micro: cost } },
    fx_missing: [],
  };
}

/** 内存设置域：偏好/系统参数/改密/我的花费都从 fixtures 派生，写入落回内存。 */
export function createMemorySettings(): SettingsOperations {
  return {
    connection: async () => {
      const row = settings.find((item) => item.key === "gateway_base_url");
      const base = row?.value ?? "";
      return {
        base_url: base,
        configured: base.trim().length > 0,
        default_port: 3600,
        endpoints: ["/v1/chat/completions", "/v1/models", "/v1/embeddings"],
        updated_at: base.trim().length > 0 ? row?.updated_at ?? "" : "",
        editable: mockSession.permissions.includes("settings:write"),
      };
    },
    preferences: async () => clone(mockPreferences),
    savePreferences: async (next) => {
      setMockPreferences({ ...mockPreferences, ...next });
      return clone(mockPreferences);
    },
    saveProfile: async (body) => {
      mockSession.name = body.name;
    },
    getSettings: async () => ({ items: clone(settings) }),
    saveSettings: async (values) => {
      for (const [key, value] of Object.entries(values)) {
        const row = settings.find((item) => item.key === key);
        if (row) row.value = value;
      }
      return { values: { ...values } };
    },
    getSettingsSchema: async () => clone(settingsSchema) as unknown as SettingsSchemaPayload,
    changePassword: async (body) => {
      if (body.old_password !== "admin12345" && body.old_password !== "admin123") {
        throw new ApiError(400, "invalid_password", "旧密码不正确");
      }
      if (body.new_password.length < 8) {
        throw new ApiError(422, "weak_password", "新密码至少 8 位");
      }
      return { ok: true, revoked_sessions: mockSession.role === "admin" ? 2 : 0 };
    },
    mySpend: async (query): Promise<MySpendResponse> => {
      const cost = overview.cost_micro;
      const charge = overview.charge_micro;
      const summary = spendSummary(overview.requests, overview.input_tokens, overview.output_tokens, charge, cost);
      const dayMs = 24 * 60 * 60 * 1000;
      const toMs = Date.parse("2026-11-18T00:00:00");
      const fromMs = toMs - SPEND_RANGE_DAYS * dayMs;
      const series: SpendPoint[] = Array.from({ length: SPEND_RANGE_DAYS }, (_, index) => {
        const weight = 0.6 + ((index * 7) % 9) / 10;
        const dayRequests = Math.round((summary.requests / SPEND_RANGE_DAYS) * weight);
        const dayCharge = Math.round((charge / SPEND_RANGE_DAYS) * weight);
        const dayCost = Math.round((cost / SPEND_RANGE_DAYS) * weight);
        const dayInput = Math.round((summary.input_tokens / SPEND_RANGE_DAYS) * weight);
        const dayOutput = Math.round((summary.output_tokens / SPEND_RANGE_DAYS) * weight);
        return {
          start_ms: fromMs + index * dayMs,
          label: new Date(fromMs + index * dayMs).toISOString().slice(0, 10),
          ...spendSummary(dayRequests, dayInput, dayOutput, dayCharge, dayCost),
        };
      });
      const byUser: SpendDimension[] = mockUsers.slice(0, 3).map((user, index) => ({
        id: user.id,
        name: user.name,
        ...spendSummary(
          Math.round(summary.requests / (index + 2)),
          Math.round(summary.input_tokens / (index + 2)),
          Math.round(summary.output_tokens / (index + 2)),
          Math.round(charge / (index + 2)),
          Math.round(cost / (index + 2)),
        ),
      }));
      const byModel: SpendDimension[] = publicModels.map((model, index) => ({
        id: model.id,
        name: model.name,
        ...spendSummary(
          Math.round(summary.requests / (index + 2)),
          Math.round(summary.input_tokens / (index + 2)),
          Math.round(summary.output_tokens / (index + 2)),
          Math.round(charge / (index + 2)),
          Math.round(cost / (index + 2)),
        ),
      }));
      return {
        range: query.range,
        bucket: "day",
        timezone: "Asia/Shanghai",
        from_ms: fromMs,
        to_ms: toMs,
        scope: query.scope,
        all_users: false,
        user: { id: mockSession.id, name: mockSession.name, role: mockSession.role },
        summary,
        series,
        by_user: byUser,
        by_model: byModel,
      };
    },
  };
}
