import { describe, expect, it } from "vitest";

import { createHttpModels, type HttpRequest, type HttpRequester } from "./http-adapter";

function capture(payload: unknown = {}): { calls: HttpRequest[]; request: HttpRequester } {
  const calls: HttpRequest[] = [];
  const request: HttpRequester = async <T,>(req: HttpRequest) => {
    calls.push(req);
    return payload as T;
  };
  return { calls, request };
}

describe("模型域 HTTP adapter 的路径与载荷", () => {
  it("上游模型列表默认无 query，pageSize=200 时带 page_size", async () => {
    const bare = capture([{ id: "um_01" }]);
    await expect(createHttpModels(bare.request).listUpstreamModels()).resolves.toEqual([{ id: "um_01" }]);
    expect(bare.calls[0]).toMatchObject({ method: "GET", path: "/admin/upstream-models" });

    const paged = capture({ items: [{ id: "um_02" }], total: 1 });
    await expect(createHttpModels(paged.request).listUpstreamModels({ pageSize: 200 })).resolves.toEqual([
      { id: "um_02" },
    ]);
    expect(paged.calls[0]?.path).toBe("/admin/upstream-models?page_size=200");
  });

  it("上游模型 CRUD/批量/兑入路径", async () => {
    const { calls, request } = capture({ items: [] });
    const ops = createHttpModels(request);
    await ops.createUpstreamModel({ upstream_id: "up_01", name: "glm-new" });
    await ops.updateUpstreamModel("um_01", { enabled: false });
    await ops.removeUpstreamModel("um_01");
    await ops.bulkUpstreamModels({ ids: ["um_01"], action: "enable" });
    await ops.adoptModelsDev("um_01");
    await ops.adoptAllModelsDev();
    await ops.modelsDevStatus();
    expect(calls.map((call) => call.method + " " + call.path)).toEqual([
      "POST /admin/upstream-models",
      "PATCH /admin/upstream-models/um_01",
      "DELETE /admin/upstream-models/um_01",
      "PATCH /admin/upstream-models/batch",
      "POST /admin/upstream-models/um_01/adopt-modelsdev",
      "POST /admin/upstream-models/adopt-modelsdev",
      "GET /admin/upstream-models/modelsdev-status",
    ]);
  });

  it("公开模型 CRUD/批量路径", async () => {
    const { calls, request } = capture([{ id: "pm_01" }]);
    const ops = createHttpModels(request);
    await ops.listPublicModels();
    await ops.createPublicModel({ name: "glm-5.3" });
    await ops.updatePublicModel("pm_01", { enabled: false });
    await ops.removePublicModel("pm_01");
    await ops.bulkPublicModels({ ids: ["pm_01"], action: "delete" });
    expect(calls.map((call) => call.method + " " + call.path)).toEqual([
      "GET /admin/public-models",
      "POST /admin/public-models",
      "PATCH /admin/public-models/pm_01",
      "DELETE /admin/public-models/pm_01",
      "PATCH /admin/public-models/batch",
    ]);
  });

  it("可用性规则列表固定 page_size=200，增改删路径", async () => {
    const { calls, request } = capture([]);
    const ops = createHttpModels(request);
    await ops.listRules();
    await ops.createRule({ kind: "cooldown", scope: "upstream_model", scope_id: "um_01" });
    await ops.updateRule("rule_01", { note: "维护" });
    await ops.removeRule("rule_01");
    expect(calls.map((call) => call.method + " " + call.path)).toEqual([
      "GET /admin/availability-rules?page_size=200",
      "POST /admin/availability-rules",
      "PATCH /admin/availability-rules/rule_01",
      "DELETE /admin/availability-rules/rule_01",
    ]);
  });

  it("setAvailability 按 kind 命中不同单行端点", async () => {
    const { calls, request } = capture({ window_skip: { message: "仅跳过当前窗口" } });
    const ops = createHttpModels(request);
    await expect(ops.setAvailability("upstream", "um_01", { enabled: true })).resolves.toEqual({
      window_skip: { message: "仅跳过当前窗口" },
    });
    await ops.setAvailability("public", "pm_01", { cooldown_until_ms: 123 });
    expect(calls.map((call) => call.method + " " + call.path)).toEqual([
      "PATCH /admin/upstream-models/um_01",
      "PATCH /admin/public-models/pm_01",
    ]);
    expect(calls[1]?.body).toEqual({ cooldown_until_ms: 123 });
  });
});
