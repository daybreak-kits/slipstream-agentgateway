import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notify", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/notification-store", () => ({ pushErrorNotificationOnce: vi.fn() }));

import { createHttpAudits, createHttpClientKeys, createHttpConfig, createHttpGovernance, createHttpPlayground, createHttpPrices, createHttpReports, createHttpRoles, createHttpSettings, createHttpSystem, createHttpUsers } from "./http-adapter";
import type { HttpRequest, HttpRequester } from "./http-adapter";
import { createMemoryAudits } from "./memory-audits";
import { createMemoryPlayground } from "./memory-playground";
import { createMemorySystem } from "./memory-system";
import type { PolicyConfig } from "./operations/governance";

function capture() {
  const calls: HttpRequest[] = [];
  const request: HttpRequester = async <T,>(req: HttpRequest) => {
    calls.push(req);
    return {} as T;
  };
  return { calls, request };
}

describe("HTTP 适配器：管理域操作映射（URL/query 细节留在这一层）", () => {
  it("审计列表带 actor/action 子串与分页", async () => {
    const { calls, request } = capture();
    await createHttpAudits(request).list({ limit: 50, offset: 100, actor: "admin", action: "config." });
    const req = calls[0]!;
    expect(req.method).toBe("GET");
    const params = new URLSearchParams(req.path.split("?")[1]);
    expect(req.path.startsWith("/admin/audit-logs?")).toBe(true);
    expect(params.get("limit")).toBe("50");
    expect(params.get("offset")).toBe("100");
    expect(params.get("actor")).toBe("admin");
    expect(params.get("action")).toBe("config.");
  });

  it("用户/密钥/角色/连接/设置/配置/治理/价目/报表/Playground/系统状态路径", async () => {
    const { calls, request } = capture();
    await createHttpUsers(request).list();
    await createHttpUsers(request).tree();
    await createHttpClientKeys(request).list();
    await createHttpRoles(request).list();
    await createHttpSettings(request).connection();
    await createHttpSettings(request).getSettingsSchema();
    await createHttpConfig(request).revisions({ limit: 3 });
    await createHttpGovernance(request).policies();
    // 路径映射只关心动词与 URL，body 由调用方校验。
    await createHttpGovernance(request).validatePolicies({} as PolicyConfig);
    await createHttpPrices(request).upstreamPrices();
    await createHttpReports(request).overview({ kind: "custom", fromMs: 1, toMs: 2 });
    await createHttpPlayground(request).myModels();
    await createHttpSystem(request).status();
    expect(calls.map((req) => req.method + " " + req.path.split("?")[0])).toEqual([
      "GET /admin/users",
      "GET /admin/users/tree",
      "GET /admin/api-keys",
      "GET /admin/roles",
      "GET /admin/connection",
      "GET /admin/settings/schema",
      "GET /admin/config/revisions",
      "GET /admin/policies",
      "POST /admin/policies/validate",
      "GET /admin/prices/upstream",
      "GET /admin/reports/overview",
      "GET /admin/my/models",
      "GET /admin/system-status",
    ]);
    expect(calls[6]!.path).toContain("limit=3");
    // 概览只支持成对 from_ms/to_ms；预设窗由后端默认窗承接（旧 use-reports 同语义）。
    expect(calls[10]!.path).toContain("from_ms=1");
    const presets = capture();
    await createHttpReports(presets.request).overview({ kind: "range", value: "7d" });
    expect(presets.calls[0]!.path).toBe("/admin/reports/overview");
  });
});

describe("内存适配器：审计/Playground/系统状态离线行为", () => {
  it("审计按 actor/action 子串过滤并分页", async () => {
    const audits = createMemoryAudits();
    const page = await audits.list({ limit: 2, offset: 0 });
    expect(page.total).toBeGreaterThan(2);
    expect(page.items).toHaveLength(2);
    const adminRows = await audits.list({ limit: 200, offset: 0, actor: "admin" });
    expect(adminRows.items.every((row) => row.actor.includes("admin"))).toBe(true);
    const configRows = await audits.list({ limit: 200, offset: 0, action: "config." });
    expect(configRows.items.length).toBeGreaterThan(0);
    expect(configRows.items.every((row) => row.action.includes("config."))).toBe(true);
  });

  it("Playground 我的模型返回参数合集", async () => {
    const models = await createMemoryPlayground().myModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]!.parameters.max_input_tokens).toBeGreaterThan(0);
  });

  it("系统状态：离线演示无待推送提醒", async () => {
    const status = await createMemorySystem().status();
    expect(status.notices).toHaveLength(0);
    expect(status.backend_version.length).toBeGreaterThan(0);
  });
});
